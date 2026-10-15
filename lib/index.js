import { trusted } from "./http-trust.js";
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DesktopSettings, unpack } from './desktop-settings.js';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_CONFIG, fromManagedId, managedId, migrateConfig, modelKey, probeSuggestions, resolveSelection, validateConfig } from './domain.js';
import { genericProviderAdapter } from './provider-adapter.js';
import { HostModelBridge, ModelManagerService, isSettingsConflict } from './service.js';
import { ManagedAdapter, MANAGED_PROVIDER, VisionRegistry } from './adapter.js';
import { registerManagerTools } from './tools.js';
import { probePng } from './probe-image.js';
import { registerOfficialSync } from './official-host.js';
import { recommendAuto } from './recommend-auto.js';
import { analyzeImage, imageRefs, visionNotice } from './vision-analysis.js';
export const name = 'dsh-model-manager';
export const inject = ['llm', 'settings', 'tools', 'attachments', 'webServer', 'systemPrompt', 'credentials', 'configEditor', 'tokenMeter'];
export const Config = z.transform(z.any(), raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('模型管理配置须为对象');
    const value = migrateConfig({ ...structuredClone(DEFAULT_CONFIG), ...raw });
    validateConfig(value);
    return value;
}).volatile();
function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
}
async function body(req) {
    let text = '';
    for await (const chunk of req) {
        text += chunk.toString();
        if (text.length > 1024 * 1024)
            throw new Error('请求体过大');
    }
    return JSON.parse(text);
}
function error(res, failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    // 冲突可能是配置版本（service.update 抛字面量）或宿主 settings 的 SETTINGS_CONFLICT：两者都要走 409，否则前端只能用消息文本猜。
    json(res, /CONFLICT/.test(message) || isSettingsConflict(failure) ? 409 : 400, { error: message });
}
export async function verify(llm, attachments, service, ref, kind, signal) {
    const model = service.model(ref);
    if (!model)
        throw new Error('模型未加载');
    const messages = [{ id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: kind === 'image' ? '图片是什么颜色？只回答颜色。' : kind === 'tools' ? '调用提供的工具。' : '只回答 OK。' }] }];
    const config = service.snapshot().config;
    const effort = kind === 'reasoning' ? genericProviderAdapter.reasoningEffort(model, config.models[modelKey(ref)], config.auto.main) : undefined;
    const tools = kind === 'tools' ? [{ name: 'model_manager_probe', description: '测试工具，请调用', parameters: { type: 'object', properties: {} } }] : undefined;
    let output = '';
    let usedTool = false;
    let requestCount = 0;
    let thrown;
    let finish;
    try {
        await llm.resolveModelInfo(ref.providerId, ref.modelId, signal);
        if (kind === 'image') {
            const attachment = await attachments.saveImage({ data: probePng(), mediaType: 'image/png' });
            messages[0] = { ...messages[0], content: [...messages[0].content, { type: 'image', attachment }] };
        }
        requestCount = 1;
        for await (const chunk of llm.stream({ provider: ref.providerId, model: ref.modelId, messages, tools, reasoningEffort: effort, signal })) {
            if (chunk.type === 'text-delta')
                output += chunk.text;
            if (chunk.type === 'tool-call-delta' || chunk.type === 'block-end' && chunk.block.type === 'tool-call')
                usedTool = true;
            if (chunk.type === 'finish')
                finish = chunk;
        }
    }
    catch (error) {
        thrown = error;
    }
    if (!finish && !thrown)
        thrown = new Error('模型流未返回结束状态');
    const failed = finish?.reason.kind === 'error' || finish?.reason.kind === 'aborted';
    const result = {
        model: { providerId: ref.providerId, modelId: ref.modelId }, kind, status: signal.aborted ? 'cancelled' : thrown ? 'network-error' : failed ? 'rejected' : 'accepted',
        checkedAt: new Date().toISOString(), signature: service.signature(ref, kind), requestCount,
        behavior: kind === 'tools' ? usedTool ? 'observed' : 'not-observed' : kind === 'reasoning' ? 'unknown' : kind === 'image' ? /红|red/i.test(output) ? 'observed' : 'not-observed' : output ? 'observed' : 'not-observed',
        detail: thrown ? String(thrown).slice(0, 160) : failed ? finish?.reason.kind : kind === 'image' && !/红|red/i.test(output) ? `图像核对未通过：${output.slice(0, 120) || '无文字输出'}` : undefined,
    };
    await service.saveVerification(result);
    return result;
}
/**
 * 对一个模型执行图片能力探测。宿主在发出请求前会按模型声明把图片投影成文字占位，
 * 因此声明为「不支持」的模型必须先把宿主 input 声明临时提为支持再实测，否则探测永远得出「未观察到」。
 * 提权无论成败都会恢复原声明；提权失败时跳过探测并记录说明，避免把「图片未送达」误判成模型能力。
 */
export async function probeModel(llm, attachments, service, inputBridge, ref, nativeImage, signal) {
    const verifications = [];
    const notes = [];
    let elevated = false;
    let restoreFailed = false;
    const needsElevation = nativeImage === 'no';
    let original;
    if (needsElevation) {
        original = inputBridge.modelInput(ref);
        const revision = inputBridge.currentRevision(ref);
        if (revision === undefined)
            notes.push('无法读取宿主设置版本，图片探测被跳过。');
        else {
            try {
                await inputBridge.setInput(ref, ['text', 'image'], revision);
                elevated = true;
            }
            catch (error) {
                notes.push(`临时提权宿主声明失败（${String(error)}），图片探测被跳过。`);
            }
        }
    }
    try {
        if (!signal.aborted && !(needsElevation && !elevated))
            verifications.push(await verify(llm, attachments, service, ref, 'image', signal));
    }
    finally {
        if (elevated) {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const revision = inputBridge.currentRevision(ref);
                    if (revision === undefined)
                        throw new Error('无法读取宿主设置版本');
                    await inputBridge.setInput(ref, original, revision);
                    restoreFailed = false;
                    break;
                }
                catch (error) {
                    restoreFailed = true;
                    if (attempt === 0)
                        await new Promise(resolve => setTimeout(resolve, 50));
                    else
                        notes.push(`恢复宿主声明失败（${String(error)}），请到模型卡片核对「宿主原生图片」。`);
                }
            }
            await service.refresh().catch(() => { });
        }
    }
    return { verifications, suggestions: probeSuggestions(verifications), cancelled: signal.aborted, elevated, restoreFailed, notes, nativeRevision: inputBridge.currentRevision(ref) };
}
export function apply(ctx, entryConfig = {}) {
    const baseConfig = migrateConfig({ ...structuredClone(DEFAULT_CONFIG), ...unpack(entryConfig) });
    validateConfig(baseConfig);
    const settings = new DesktopSettings(ctx.configEditor, ctx.settings);
    settings.isBusy = () => ctx.get('agents')?.list().some(agent => agent.status === 'running') ?? false;
    const bridge = new HostModelBridge(ctx.llm, settings);
    const service = new ModelManagerService(bridge, join(dirname(ctx.configEditor.documentPath), 'data', name), settings);
    service.tokenEstimate = (ref, options) => {
        const agent = options.sessionId ? ctx.get('agents')?.get(options.sessionId) : undefined;
        return agent ? ctx.tokenMeter.measure(agent.session, { config: { provider: ref.providerId, model: ref.modelId, ...(options.reasoningEffort !== undefined ? { reasoningEffort: options.reasoningEffort } : {}), ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}) }, ...(options.tools ? { tools: options.tools } : {}) }).totalTokens : undefined;
    };
    service.candidateSignature = async (ref) => {
        if (ref.providerId === 'opencode-go') {
            const value = settings.get('opencode-go');
            const refs = [...new Set([value?.apiKeyEnv, ...(Array.isArray(value?.accounts) ? value.accounts.map((a) => a.apiKeyEnv) : [])].filter((name) => typeof name === 'string'))];
            const keys = await Promise.all(refs.map(async (name) => { const found = await ctx.credentials.resolve(credentialRef(name)); return [name, found ? createHash('sha256').update(found.value).digest('hex') : null]; }));
            return [value, keys];
        }
        const entry = ctx.llm.listConfigurableProviders().find(p => p.provider === ref.providerId);
        if (!entry)
            return [service.signature(ref)];
        let ns = entry.settingsNs;
        try {
            ns = settings.namespaceFor(ns);
        }
        catch { }
        let value = settings.get(ns);
        for (const key of entry.settingsPath ?? [])
            value = value?.[key];
        const key = typeof value?.apiKeyEnv === 'string' ? await ctx.credentials.resolve(credentialRef(value.apiKeyEnv)) : undefined;
        return [value, key ? createHash('sha256').update(key.value).digest('hex') : null];
    };
    const vision = new VisionRegistry();
    const adapter = new ManagedAdapter(ctx.llm, service, vision);
    ctx.effect(() => () => { adapter.dispose(); service.health.dispose(); }, 'dsh-model-manager: cancel active calls');
    let ready = false;
    void service.init().then(() => { ready = true; }).catch(err => ctx.logger?.error?.(`[dsh-model-manager] 初始化失败: ${String(err)}`));
    ctx.effect(() => ctx.llm.registerAdapter([MANAGED_PROVIDER], adapter), 'dsh-model-manager: adapter');
    ctx.effect(() => registerManagerTools({ tools: ctx.tools, llm: ctx.llm, attachments: ctx.attachments, service, vision, adapter }), 'dsh-model-manager: tools');
    ctx.effect(() => ctx.systemPrompt.section({ name: 'dsh-model-manager', order: 350,
        text: () => {
            const config = service.snapshot().config;
            return [
                config.vision.enabled ? '当消息中出现 [图片附件 ID] 时，使用 model_manager_inspect_image 针对具体问题查看原图；不要根据占位文字猜测图片内容。' : ''
            ].filter(Boolean).join('\n');
        },
    }), 'dsh-model-manager: prompt');
    ctx.effect(() => ctx.on('llm/adapters-updated', () => { if (ready)
        void service.refresh().catch(() => { }); }), 'dsh-model-manager: directory');
    const assembled = new Map();
    const observed = new Map();
    ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const value = await next();
        if (context.agent && value.variables.provider && value.variables.model)
            assembled.set(String(context.agent.session.id), { providerId: value.variables.provider, modelId: value.variables.model });
        return value;
    }, { global: true }), 'dsh-model-manager: assembled model');
    ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (!ready || decision.kind !== 'enter')
            return decision;
        const session = String(payload.agent.session.id);
        const delegated = payload.agent.session.header.origin === 'subagent' || !!payload.agent.session.header.parentSession;
        if (delegated)
            service.markDelegatedSession(session);
        const active = service.effectiveSelection(session, payload.turn);
        const selection = delegated ? {} : active;
        const { config } = service.snapshot();
        const history = payload.agent.session.deriveMessages();
        const images = imageRefs([...history, ...decision.messages]);
        vision.add(session, imageRefs(history), payload.step === 1 ? payload.turn - 1 : payload.turn);
        vision.add(session, imageRefs(decision.messages), payload.turn, true);
        if (!images.length || !config.vision.enabled || config.vision.automatic === false || config.vision.policy === 'native-only')
            return decision;
        const header = payload.agent.session.requestHeader()?.config;
        const current = assembled.get(session) ?? (header ? { providerId: header.provider, modelId: header.model } : payload.agent.options.provider && payload.agent.options.model ? { providerId: payload.agent.options.provider, modelId: payload.agent.options.model } : service.hostDefault());
        let candidates = selection.target ? resolveSelection(config, selection.target) : current ? current.providerId === MANAGED_PROVIDER ? current.modelId === 'auto' && config.auto.enabled ? [...['simple', 'normal', 'complex'].flatMap(g => resolveSelection(config, config.auto[g].target)), ...(config.auto.rules ?? []).filter(r => r.enabled).flatMap(r => resolveSelection(config, r.selection.target))] : current.modelId.startsWith('alias:') ? resolveSelection(config, `@${current.modelId.slice(6)}`) : current.modelId === 'auto' ? resolveSelection(config, config.auto.main.target ?? service.hostDefault()) : [] : [current] : [];
        if (!candidates.length && current?.providerId === MANAGED_PROVIDER && current.modelId !== 'auto' && !current.modelId.startsWith('alias:')) {
            try {
                candidates = [fromManagedId(current.modelId)];
            }
            catch { }
        }
        if (config.vision.policy === 'native-first' && candidates.length && candidates.every(ref => service.model(ref)?.nativeImage === 'yes'))
            return decision;
        const latest = [...history, ...decision.messages].reverse().find(m => m.role === 'user' && m.source.kind === 'user');
        const question = latest?.content.filter(b => b.type === 'text').map(b => b.text).join('\n') || '描述图片中与当前任务有关的可见内容、文字和细节；不确定时明确说明。';
        let state = observed.get(session);
        if (state?.turn !== payload.turn) {
            state = { turn: payload.turn, keys: new Set() };
            observed.set(session, state);
        }
        const additions = [];
        for (const image of images) {
            const key = JSON.stringify([image.attachmentId, question, config.vision]);
            if (state.keys.has(key))
                continue;
            const result = await analyzeImage(session, image, question, undefined, payload.signal, { llm: ctx.llm, attachments: ctx.attachments, service, adapter });
            additions.push(visionNotice(image, result));
            state.keys.add(key);
        }
        payload.signal.throwIfAborted();
        return { ...decision, messages: [...decision.messages, ...additions] };
    }, { global: true }), 'dsh-model-manager: automatic vision');
    ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
        const current = await next();
        if (!ready)
            return current;
        const session = payload.agent.session.id;
        if (payload.agent.session.header.origin === 'subagent' || payload.agent.session.header.parentSession) {
            if (current.provider === MANAGED_PROVIDER) {
                service.markDelegatedSession(session);
                if (current.model === 'auto' || current.model.startsWith('alias:')) {
                    const parentId = String(payload.agent.session.header.parentSession);
                    const historical = [...payload.agent.session.deriveMessages?.() ?? []].reverse().find(m => m.role === 'assistant');
                    const replay = historical?.role === 'assistant' ? historical.source.replayState : undefined;
                    const recorded = replay?.response?.$dmm === 1 && typeof replay.response.provider === 'string' && typeof replay.response.model === 'string' ? { providerId: replay.response.provider, modelId: replay.response.model } : undefined;
                    const selected = service.latestActualModel(parentId) ?? recorded;
                    if (selected)
                        return { ...current, model: managedId(selected) };
                }
            }
            return current;
        }
        const selection = service.effectiveSelection(session, payload.turn);
        if (current.provider === MANAGED_PROVIDER)
            return current;
        const config = service.snapshot().config;
        const candidates = selection.target ? resolveSelection(config, selection.target) : [{ providerId: current.provider, modelId: current.model }];
        const first = candidates[0];
        if (!first)
            return current;
        const record = service.model(first);
        const effort = record ? genericProviderAdapter.reasoningEffort(record, config.models[modelKey(first)], selection) : undefined;
        if ((selection.thinking === 'off' || selection.tier && !['auto', 'inherit'].includes(selection.tier)) && !record)
            throw new Error('所选模型尚未由宿主加载');
        if (!selection.target && !config.vision.enabled && !effort && selection.maxOutputTokens === undefined)
            return current;
        return { ...current, provider: MANAGED_PROVIDER,
            model: typeof selection.target === 'string' ? `alias:${selection.target.slice(1)}` : managedId(first),
            ...(effort ? { reasoningEffort: effort } : {}),
            ...(selection.maxOutputTokens ? { maxTokens: selection.maxOutputTokens } : {}) };
    }, { global: true }), 'dsh-model-manager: selection');
    ctx.effect(() => ctx.on('session/event', (session, event) => { if (event.type === 'turn/end')
        service.endTurn(session.id, event.data.turn); }, { global: true }), 'dsh-model-manager: turn cleanup');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager', handler: async (req, res) => {
            if (!ready) {
                json(res, 503, { error: '模型管理初始化中' });
                return;
            }
            if (req.method === 'GET') {
                json(res, 200, { ...service.snapshot(), nativeRevision: settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision });
                return;
            }
            if (req.method !== 'PUT') {
                res.setHeader('Allow', 'GET, PUT');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            try {
                const input = await body(req);
                await service.update(input.config, input.revision);
                // 必须返回完整快照（含 verifications）：客户端保存后会用该响应整体替换渲染状态，缺字段会导致渲染崩溃白屏。
                json(res, 200, { ...service.snapshot(), nativeRevision: settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision });
            }
            catch (err) {
                error(res, err);
            }
        } }), 'dsh-model-manager: config route');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/verify', handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            const abort = new AbortController();
            res.on('close', () => { if (!res.writableEnded)
                abort.abort(); });
            try {
                const input = await body(req);
                if (!['text', 'image', 'tools', 'reasoning'].includes(input.kind))
                    throw new Error('无效验证项目');
                const verification = await verify(ctx.llm, ctx.attachments, service, input, input.kind, abort.signal);
                json(res, 200, { verification });
            }
            catch (err) {
                if (!res.writableEnded)
                    error(res, err);
            }
        } }), 'dsh-model-manager: verify route');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/probe', handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            const abort = new AbortController();
            res.on('close', () => { if (!res.writableEnded)
                abort.abort(); });
            try {
                const input = await body(req);
                const ref = { providerId: input.providerId, modelId: input.modelId };
                const record = service.model(ref);
                if (!record)
                    throw new Error('模型未加载');
                const result = await probeModel(ctx.llm, ctx.attachments, service, bridge, ref, record.nativeImage, abort.signal);
                json(res, 200, result);
            }
            catch (err) {
                if (!res.writableEnded)
                    error(res, err);
            }
        } }), 'dsh-model-manager: probe route');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/refresh', handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            try {
                await service.refresh();
                json(res, 200, { ...service.snapshot(), nativeRevision: settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision });
            }
            catch (err) {
                error(res, err);
            }
        } }), 'dsh-model-manager: refresh route');
    registerOfficialSync({ llm: ctx.llm, settings, credentials: ctx.credentials, webServer: ctx.webServer, effect: ctx.effect.bind(ctx) }, service, { llm: ctx.llm, settings, credentials: ctx.credentials, config: () => service.snapshot().config });
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/alias-health', handler: async (req, res) => {
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            if (!ready) {
                json(res, 503, { error: '模型管理初始化中' });
                return;
            }
            if (req.method === 'GET') {
                try {
                    json(res, 200, await service.refreshAliasHealth());
                }
                catch (err) {
                    error(res, err);
                }
                return;
            }
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'GET, POST');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            try {
                const input = await body(req);
                if (typeof input.alias !== 'string' || !service.snapshot().config.aliases[input.alias] || typeof input.expectedRevisionToken !== 'string')
                    throw Error('别名或状态版本无效');
                json(res, 200, await service.health.reset(input.alias, input.expectedRevisionToken));
            }
            catch (err) {
                error(res, err);
            }
        } }), 'dsh-model-manager: alias health');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/native', handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            try {
                const input = await body(req);
                if (!service.model(input))
                    throw new Error('模型未加载');
                if (input.clear && (!Array.isArray(input.clear) || !input.clear.length || input.clear.some(field => !['image', 'contextWindow', 'maxTokens'].includes(field))))
                    throw new Error('无效的清除字段');
                if (input.clear && (input.image !== undefined || input.contextWindow !== undefined || input.maxTokens !== undefined))
                    throw new Error('清除与设置不能在同一次操作中混用');
                if (input.contextWindow !== undefined && (!Number.isInteger(input.contextWindow) || input.contextWindow < 1))
                    throw new Error('上下文容量必须为正整数');
                if (input.maxTokens !== undefined && (!Number.isInteger(input.maxTokens) || input.maxTokens < 1))
                    throw new Error('最大输出能力必须为正整数');
                if (input.image === false || input.clear?.includes('image')) {
                    const { config } = service.snapshot(), visual = config.vision.target ?? config.auto.roles.vision.target;
                    if (config.vision.enabled && resolveSelection(config, visual).some(ref => modelKey(ref) === modelKey(input)))
                        throw Error('该模型仍被启用的视觉辅助引用，请先更换视觉目标或关闭辅助');
                }
                if (input.clear)
                    await bridge.clearNative(input, input.clear, input.revision);
                else
                    await bridge.applyNative(input, input, input.revision);
                await service.refresh();
                const revision = bridge.currentRevision(input);
                json(res, 200, { revision });
            }
            catch (err) {
                error(res, err);
            }
        } }), 'dsh-model-manager: native route');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/logs', handler: async (req, res) => {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            json(res, 200, { events: await service.logs() });
        } }), 'dsh-model-manager: logs route');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/recommend', handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            const abort = new AbortController();
            res.on('close', () => { if (!res.writableEnded)
                abort.abort(); });
            try {
                const input = await body(req);
                const suggestion = await recommendAuto(ctx.llm, service, input.evaluator, abort.signal);
                json(res, 200, suggestion);
            }
            catch (err) {
                if (!res.writableEnded)
                    error(res, err);
            }
        } }), 'dsh-model-manager: recommend route');
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/overrides', handler: async (req, res) => {
            if (req.method === 'GET') {
                const sessionId = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('sessionId');
                if (!sessionId) {
                    json(res, 400, { error: '缺少会话 ID' });
                    return;
                }
                json(res, 200, service.getOverride(sessionId));
                return;
            }
            if (req.method !== 'PUT') {
                res.setHeader('Allow', 'GET, PUT');
                json(res, 405, { error: '方法不允许' });
                return;
            }
            if (!trusted(req)) {
                json(res, 403, { error: '跨站请求被拒绝' });
                return;
            }
            try {
                const input = await body(req);
                if (input.scope !== 'session' && input.scope !== 'nextTurn')
                    throw new Error('无效覆盖范围');
                await service.setOverride(input.sessionId, input.scope, input.selection);
                json(res, 200, service.getOverride(input.sessionId));
            }
            catch (err) {
                error(res, err);
            }
        } }), 'dsh-model-manager: overrides route');
}
