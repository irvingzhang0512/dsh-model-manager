import { LlmError } from '@deepseek-ai/dsh-llm';
import { modelKey } from './domain.js';
import { abortableStream } from './official-sync.js';
export const ALIAS_BUFFER_BYTES = 32 * 1024 * 1024;
export function abortable(promise, signal) {
    if (signal.aborted) {
        void promise.catch(() => { });
        return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
function delay(ms, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}
export function safeFailureMessage(message) {
    return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/((?:api[_-]?key|secret|token|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').replace(/https?:\/\/\S+/gi, '[endpoint]').slice(0, 600);
}
export function caughtFailure(error) {
    // LlmError 的数据契约可跨包副本传递；不把已结构化的拒绝抹成 NETWORK。
    const value = error;
    if (value?.failure && typeof value.failure.code === 'string' && value.failure.code === value.code && typeof value.failure.message === 'string')
        return { ...value.failure };
    if (typeof value?.code === 'string')
        return { code: value.code, message: typeof value.message === 'string' ? value.message : '模型请求失败' };
    return { code: 'NETWORK', message: error instanceof Error ? error.message : String(error) };
}
function transient(failure) {
    if (failure.status !== undefined && failure.status >= 400 && failure.status < 500 && failure.status !== 408)
        return false;
    if (['RATE_LIMIT', 'QUOTA', 'AUTH', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'BUFFER_LIMIT', 'INVALID_STREAM', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'NO_ADAPTER'].includes(failure.code))
        return false;
    return ['NETWORK', 'TRANSPORT', 'TIMEOUT', 'SERVER', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(failure.code) || failure.status === 408 || (failure.status ?? 0) >= 500;
}
const aborted = () => ({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '用户已停止模型请求' } } });
/** 每次尝试完整成功后才提交，失败的块与工具调用不会进入宿主。 */
export async function* aliasStream(llm, candidates, signal, prepare, log, lifecycle) {
    const queue = [...new Map(candidates.map(ref => [modelKey(ref), ref])).values()];
    const failures = [];
    let attempt = 0;
    try {
        for (const [index, candidate] of queue.entries()) {
            signal.throwIfAborted();
            const candidateIndex = index + 1;
            let unavailable;
            try {
                unavailable = await lifecycle?.admit(candidate);
            }
            catch (error) {
                signal.throwIfAborted();
                const failure = caughtFailure(error);
                unavailable = `来源准备失败（${failure.code}）：${safeFailureMessage(failure.message)}`;
            }
            if (unavailable) {
                failures.push(`${candidate.providerId}/${candidate.modelId}：${unavailable}`);
                continue;
            }
            let prepared;
            const preparationStarted = Date.now();
            try {
                prepared = await abortable(prepare(candidate, signal), signal);
            }
            catch (error) {
                signal.throwIfAborted();
                const failure = caughtFailure(error);
                await lifecycle?.settled(candidate, failure);
                const message = safeFailureMessage(failure.message);
                failures.push(`${candidate.providerId}/${candidate.modelId}（0 次调用，${failure.code}）：${message}`);
                await abortable(log({ action: 'alias-candidate-preparation', provider: candidate.providerId, model: candidate.modelId, candidateIndex, candidateAttempt: 0, attempt, status: 'error', durationMs: Date.now() - preparationStarted, failureCode: failure.code, failureMessage: message }), signal);
                continue;
            }
            for (let candidateAttempt = 1; candidateAttempt <= 5; candidateAttempt++) {
                signal.throwIfAborted();
                attempt++;
                const controller = new AbortController();
                const stop = () => controller.abort(signal.reason);
                signal.addEventListener('abort', stop, { once: true });
                const chunks = [];
                let bytes = 0, success = false, wasAborted = false;
                let failure = { code: 'TRANSPORT', message: '模型流在正常结束标记之前中断' };
                let usage;
                const started = Date.now();
                try {
                    for await (const raw of abortableStream((prepared.stream ?? (request => llm.stream(request)))({ ...prepared.request, messages: structuredClone(prepared.request.messages), tools: prepared.request.tools && structuredClone(prepared.request.tools), signal: controller.signal }), controller.signal)) {
                        signal.throwIfAborted();
                        if (raw.type === 'usage')
                            usage = raw.usage;
                        if (raw.type === 'finish' && (raw.reason.kind === 'error' || raw.reason.kind === 'aborted')) {
                            failure = raw.reason.failure;
                            if (raw.reason.kind === 'aborted') {
                                wasAborted = true;
                                controller.abort(new Error('模型调用已取消'));
                            }
                            break;
                        }
                        const chunk = prepared.restore(raw);
                        let size;
                        try {
                            size = Buffer.byteLength(JSON.stringify(chunk), 'utf8');
                        }
                        catch {
                            failure = { code: 'INVALID_STREAM', message: '模型输出不能序列化' };
                            break;
                        }
                        if (bytes + size > ALIAS_BUFFER_BYTES) {
                            failure = { code: 'BUFFER_LIMIT', message: '本次回答暂存超过 32 MiB' };
                            break;
                        }
                        chunks.push(structuredClone(chunk));
                        bytes += size;
                        if (chunk.type === 'finish') {
                            success = ['stop', 'tool-calls', 'max-tokens'].includes(chunk.reason.kind);
                            break;
                        }
                    }
                }
                catch (error) {
                    failure = caughtFailure(error);
                    wasAborted = failure.code === 'ABORTED';
                }
                finally {
                    signal.removeEventListener('abort', stop);
                    if (!success)
                        controller.abort();
                }
                if (signal.aborted) {
                    void log({ provider: candidate.providerId, model: candidate.modelId, candidateIndex, candidateAttempt, attempt, route: prepared.route, durationMs: Date.now() - started, status: 'aborted', failureCode: 'ABORTED', usage }).catch(() => { });
                    yield aborted();
                    return;
                }
                await abortable(log({ provider: candidate.providerId, model: candidate.modelId, candidateIndex, candidateAttempt, attempt, route: prepared.route, effort: prepared.request.reasoningEffort,
                    durationMs: Date.now() - started, status: success ? 'success' : wasAborted ? 'aborted' : 'error', failureCode: success ? undefined : failure.code,
                    failureMessage: success ? undefined : safeFailureMessage(failure.message), httpStatus: success ? undefined : failure.status, requestId: success ? undefined : failure.requestId, usage }), signal);
                if (wasAborted) {
                    yield aborted();
                    return;
                }
                if (success) {
                    await lifecycle?.settled(candidate);
                    for (const chunk of chunks) {
                        if (signal.aborted) {
                            yield aborted();
                            return;
                        }
                        ;
                        yield chunk;
                    }
                    return;
                }
                chunks.length = 0;
                if (candidateAttempt < 5 && transient(failure)) {
                    await delay(500 * 2 ** (candidateAttempt - 1), signal);
                    continue;
                }
                failures.push(`${candidate.providerId}/${candidate.modelId}（${candidateAttempt} 次调用，${failure.code}）：${safeFailureMessage(failure.message)}`);
                await lifecycle?.settled(candidate, failure);
                break;
            }
        }
        signal.throwIfAborted();
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'ALL_CANDIDATES_FAILED', message: `全部别名候选失败：${failures.join('；')}` } } };
    }
    catch (error) {
        if (signal.aborted) {
            yield aborted();
            return;
        }
        throw error;
    }
    finally {
        lifecycle?.release();
    }
}
export async function aliasMetadata(llm, candidates, signal) {
    const failures = [];
    const resolved = [];
    for (const candidate of candidates) {
        signal?.throwIfAborted();
        try {
            const result = llm.resolveModelInfo(candidate.providerId, candidate.modelId, signal);
            resolved.push(await (signal ? abortable(result, signal) : result));
        }
        catch (error) {
            signal?.throwIfAborted();
            const failure = caughtFailure(error);
            failures.push(`${candidate.providerId}/${candidate.modelId}：${failure.code} ${safeFailureMessage(failure.message)}`);
        }
    }
    if (resolved.length) {
        const first = resolved[0];
        const efforts = failures.length ? [] : first.reasoning?.efforts.filter(e => resolved.every(m => m.reasoning?.efforts.some(other => other.id === e.id))) ?? [];
        const windows = resolved.flatMap(m => m.context?.contextWindow ? [m.context.contextWindow] : []);
        return { ...first, reasoning: efforts.length ? { efforts } : undefined, defaultMaxTokens: undefined,
            context: windows.length ? { ...first.context, contextWindow: Math.max(...windows) } : first.context,
            systemPromptUpdate: resolved.every(m => m.systemPromptUpdate === first.systemPromptUpdate) ? first.systemPromptUpdate : undefined,
            toolUpdate: resolved.every(m => m.toolUpdate === first.toolUpdate) ? first.toolUpdate : undefined };
    }
    throw new LlmError(`全部别名候选准备失败：${failures.join('；')}`, 'ALL_CANDIDATES_FAILED');
}
