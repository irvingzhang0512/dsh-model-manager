import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { modelKey } from './domain.js';
import { canonical } from './official-state.js';
export async function findArkCli() {
    const binary = process.platform === 'win32' ? 'arkcli.exe' : 'arkcli';
    const paths = [...(process.env.PATH ?? '').split(delimiter).map(dir => join(dir, binary)), ...(process.platform === 'win32' && process.env.APPDATA ? [join(process.env.APPDATA, 'npm/node_modules/@volcengine/ark-cli/bin/arkcli-windows-amd64.exe')] : [])];
    for (const path of paths) {
        try {
            await access(path);
            return path;
        }
        catch { }
    }
}
export async function runArk(args, signal) {
    const file = await findArkCli();
    if (!file)
        throw Error('未找到本机 ArkCLI；请先安装官方 CLI，或使用现有目录');
    try {
        const { stdout } = await promisify(execFile)(file, [...args, '--format', 'json'], { shell: false, windowsHide: true, signal, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ARKCLI_NO_UPDATE_NOTIFIER: '1', ARKCLI_CALLER_TYPE: 'ai_agent', ARKCLI_CALLER_NAME: 'dsh-model-manager', ARKCLI_SKILL_NAME: 'arkcli-resources' } });
        // Official commands can print a human preamble before the JSON payload.
        for (let i = 0; i < stdout.length; i++)
            if (stdout[i] === '{' || stdout[i] === '[') {
                try {
                    return JSON.parse(stdout.slice(i));
                }
                catch { }
            }
        throw Error('invalid-json');
    }
    catch {
        signal.throwIfAborted();
        throw Error('ArkCLI 查询失败或超时；请检查登录状态、所选 Profile 与 CLI 版本');
    }
}
export function safeArkStatus(raw) {
    const rows = Array.isArray(raw?.profiles_summary) ? raw.profiles_summary : [];
    return { loggedIn: raw?.logged_in === true, profiles: rows.filter((r) => r && typeof r.name === 'string' && typeof r.type === 'string').map((r) => ({ name: r.name, type: r.type })), activeProfile: typeof raw?.active_profile?.name === 'string' ? raw.active_profile.name : undefined };
}
export async function arkStatus(deps, signal) { return safeArkStatus(await (deps.ark ?? runArk)(['auth', 'status'], signal)); }
function owner(deps, kind) { return kind === 'deepseek' ? 'llm-deepseek' : kind === 'ark-agent-plan' ? 'llm-pi-ai' : 'opencode-go'; }
function profile(deps, kind, provider) { const value = deps.settings.get(owner(deps, kind) ?? ''); return kind === 'ark-agent-plan' ? value?.providers?.[provider] : value; }
export async function describeSources(deps) {
    const associations = Object.entries(deps.config().sources ?? {}).map(([sourceId, s]) => ({ sourceId, ...s }));
    const providers = deps.llm.listProviders();
    if (!associations.some(s => s.kind === 'deepseek'))
        associations.push({ sourceId: 'deepseek', kind: 'deepseek', providerId: 'deepseek-official' });
    if (!associations.some(s => s.kind === 'opencode-go'))
        associations.push({ sourceId: 'opencode-go', kind: 'opencode-go', providerId: 'opencode-go' });
    const pi = deps.settings.get('llm-pi-ai');
    for (const [id, p] of Object.entries(pi?.providers ?? {}))
        if (typeof p.baseURL === 'string' && /^https:\/\/ark\.[^/]+\/api\/plan\//.test(p.baseURL) && !associations.some(s => s.providerId === id))
            associations.push({ sourceId: `ark:${id}`, kind: 'ark-agent-plan', providerId: id });
    if (!associations.some(s => s.kind === 'ark-agent-plan'))
        associations.push({ sourceId: 'ark-agent-plan', kind: 'ark-agent-plan', providerId: 'ark-agent-plan' });
    return Promise.all(associations.map(async (source) => {
        const ns = owner(deps, source.kind), value = profile(deps, source.kind, source.providerId);
        const ref = typeof value?.apiKeyEnv === 'string' ? value.apiKeyEnv : undefined;
        const credential = ref ? { ref, ...await deps.credentials.describe(credentialRef(ref)) } : { configured: false, writable: source.kind !== 'opencode-go' };
        let ownerEntryIds = [];
        try {
            ownerEntryIds = [deps.settings.row(ns ?? 'opencode-go').entry.options.id];
        }
        catch { }
        const loaded = providers.some(p => p.id === source.providerId);
        return { ...source, ownerEntryIds, credential: { ref, configured: credential.configured, writable: source.kind === 'opencode-go' ? false : credential.writable }, loaded, modelCount: loaded ? (await deps.llm.listModels(source.providerId).catch(() => [])).length : 0, ...(!ownerEntryIds.length ? { reason: '来源插件未安装或所有者不唯一' } : {}) };
    }));
}
const positive = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function sourceModel(raw, kind) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 500)
        return;
    const result = { id: raw.id };
    if (typeof raw.name === 'string' && raw.name.trim())
        result.name = raw.name;
    if (positive(raw.context_window ?? raw.context_length ?? raw.contextWindow))
        result.contextWindow = raw.context_window ?? raw.context_length ?? raw.contextWindow;
    if (positive(raw.max_output_tokens ?? raw.max_tokens))
        result.maxTokens = raw.max_output_tokens ?? raw.max_tokens;
    const input = raw.input_modalities ?? raw.inputModalities ?? raw.input;
    if (Array.isArray(input) && input.length && input.every(v => typeof v === 'string'))
        result[kind === 'deepseek' ? 'inputModalities' : 'input'] = [...new Set(input)];
    if (kind === 'ark-agent-plan' && raw.reasoningEfforts !== undefined)
        result.reasoningEfforts = raw.reasoningEfforts;
    return result;
}
export async function prepareSource(input, signal, deps) {
    if (!input || !['deepseek', 'ark-agent-plan', 'opencode-go'].includes(input.kind))
        throw Error('来源类型无效');
    if (input.kind === 'opencode-go')
        throw Error('OpenCode Go 请使用原插件同步目录；管理器自动读取同步结果');
    const kind = input.kind, providerId = input.providerId ?? (kind === 'deepseek' ? 'deepseek-official' : 'ark-agent-plan');
    if (!/^[a-z][a-z0-9_-]*$/.test(providerId) || kind === 'deepseek' && providerId !== 'deepseek-official')
        throw Error('Provider 标识无效');
    if (input.sourceId !== undefined) {
        const known = (await describeSources(deps)).find(source => source.sourceId === input.sourceId);
        if (!known || known.kind !== kind || known.providerId !== providerId)
            throw Error('来源关联已变化，请刷新后重新选择');
    }
    const ns = owner(deps, kind), path = kind === 'deepseek' ? [] : ['providers', providerId];
    deps.settings.row(ns);
    const before = profile(deps, kind, providerId) ?? {}, connection = { ...before }, changes = [], notes = [];
    const allowed = kind === 'deepseek' ? ['baseURL'] : ['api', 'baseURL', 'displayName', 'defaultContextWindow', 'defaultMaxTokens'];
    for (const key of Object.keys(input.connection ?? {}))
        if (!allowed.includes(key))
            throw Error(`来源未公开该高级字段：${key}`);
    const desired = { ...(kind === 'ark-agent-plan' && !Object.keys(before).length ? { api: 'openai-completions', baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3', displayName: '火山 Agent Plan', defaultContextWindow: 262144, defaultMaxTokens: 32768 } : {}), ...input.connection };
    const protocols = kind === 'ark-agent-plan' ? (await import('@deepseek-ai/dsh-llm-pi-ai')).supportedProtocols() : [];
    if (input.credentialRef !== undefined) {
        if (!/^DMM_(DEEPSEEK|ARK_AGENT_PLAN)_[A-F0-9]{32}$/.test(input.credentialRef) || !input.credentialRef.startsWith(kind === 'deepseek' ? 'DMM_DEEPSEEK_' : 'DMM_ARK_AGENT_PLAN_'))
            throw Error('只能选择本次为该来源新保存的凭据引用');
        if (!(await deps.credentials.describe(credentialRef(input.credentialRef))).configured)
            throw Error('新凭据尚未保存');
        desired.apiKeyEnv = input.credentialRef;
    }
    for (const [key, value] of Object.entries(desired)) {
        if (['defaultContextWindow', 'defaultMaxTokens'].includes(key) ? !positive(value) : typeof value !== 'string' || !value.trim())
            throw Error('来源高级参数格式无效');
        if (key === 'baseURL') {
            const url = new URL(String(value));
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
                throw Error('端点须为无凭据的 HTTPS 地址');
        }
        if (key === 'api' && !protocols.includes(String(value)))
            throw Error('当前宿主未提供该协议');
        connection[key] = value;
        if (canonical(value) !== canonical(before[key]))
            changes.push({ fieldId: key, label: { apiKeyEnv: '调用凭据引用', baseURL: '调用地址', api: '接口协议', displayName: '来源名称', defaultContextWindow: '未知模型的上下文默认值', defaultMaxTokens: '未知模型的输出默认值' }[key] ?? key, before: before[key], after: value, selected: true });
    }
    let raw = [];
    if (kind === 'deepseek') {
        const ref = credentialRef(connection.apiKeyEnv ?? 'DEEPSEEK_API_KEY'), key = await deps.credentials.resolve(ref);
        if (!key)
            throw Error('DeepSeek 凭据尚未配置');
        const url = new URL('models', `${String(connection.baseURL ?? 'https://api.deepseek.com').replace(/\/+$/, '')}/`);
        const response = await (deps.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${key.value}` }, signal, redirect: 'error' });
        if (!response.ok)
            throw Error(`DeepSeek 模型目录读取失败（HTTP ${response.status}）`);
        const text = await response.text();
        if (text.length > 4 * 1024 * 1024)
            throw Error('模型目录过大');
        const value = JSON.parse(text);
        if (!Array.isArray(value.data))
            throw Error('DeepSeek 模型目录格式无效');
        raw = value.data;
    }
    else {
        if (!input.arkProfile || !/^[A-Za-z0-9_.-]{1,160}$/.test(input.arkProfile))
            throw Error('请明确选择用于查询的 ArkCLI Profile');
        const status = await arkStatus(deps, signal), selected = status.profiles.find((p) => p.name === input.arkProfile);
        if (!status.loggedIn || !selected || !['plan', 'agent-plan', 'team', 'agent_plan'].includes(selected.type))
            throw Error('所选 Profile 未登录或不是 Agent Plan Profile');
        const value = await (deps.ark ?? runArk)(['resources', 'list', '--modality', 'text', '--profile', input.arkProfile], signal);
        if (value.profile !== input.arkProfile || !Array.isArray(value.items))
            throw Error('ArkCLI 返回的 Profile 或目录无效');
        raw = value.items.filter((m) => m.invocable === true && (!m.required_overrides || Array.isArray(m.required_overrides) && !m.required_overrides.length) && m.data_plane !== 'platform');
        notes.push('账户可见且兼容的模型不代表当前调用 Key 有权限或额度；账户凭据与调用 Key 分开管理。');
        if (!before.api)
            notes.push('未知容量使用宿主默认值；这些数值不是平台官方能力声明。');
    }
    if (raw.length > 2000)
        throw Error('模型目录超过安全上限');
    const models = [...new Map(raw.map(m => sourceModel(m, kind)).filter((m) => !!m).map(m => [m.id, m])).values()];
    if (!models.length)
        throw Error('没有获得可导入模型；原配置未改变');
    const sourceId = input.sourceId ?? Object.entries(deps.config().sources ?? {}).find(([, s]) => s.providerId === providerId && s.kind === kind)?.[0] ?? randomUUID();
    if (typeof sourceId !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(sourceId) || ['__proto__', 'constructor', 'prototype'].includes(sourceId))
        throw Error('来源标识无效');
    return { sourceId, kind, providerId, arkProfile: input.arkProfile, fetchedAt: new Date().toISOString(), connectionChanges: changes, models: models.map(m => {
            const effort = raw.find(r => r?.id === m.id)?.effort;
            const info = effort && Array.isArray(effort.supported_levels) && effort.supported_levels.every((v) => typeof v === 'string') ? `推理资料（只读核对）：${effort.supported_levels.join('、')}${typeof effort.default_level === 'string' ? `；默认 ${effort.default_level}` : ''}；执行仍使用宿主真实公开档位` : undefined;
            return { model: { providerId, modelId: m.id }, fields: m, evidence: [kind === 'deepseek' ? 'DeepSeek /models' : 'ArkCLI resources list', ...(info ? [info] : [])] };
        }), notes, ns, path, connection, intents: [], selected: [] };
}
export async function previewSource(input, signal, deps) {
    const draft = await prepareSource(input, signal, deps);
    if (!deps.publish)
        throw Error('来源目录预览编排不可用');
    const catalog = await deps.publish(draft, signal);
    return { sourceId: draft.sourceId, kind: draft.kind, providerId: draft.providerId, fetchedAt: draft.fetchedAt, connectionChanges: draft.connectionChanges, models: draft.models, catalog, notes: draft.notes };
}
/** Field operations preserve all other model fields; differing existing values start unselected. */
export function sourceIntents(draft, state) {
    const profile = state.profiles.find(p => p.providerId === draft.providerId);
    for (const item of draft.models) {
        const old = profile.models.find(m => m.id === item.model.modelId), fields = item.fields;
        if (!old) {
            const { maxTokens: _cap, ...value } = fields;
            const id = `source:${modelKey(item.model)}:add`;
            draft.intents.push({ id, kind: 'add', model: item.model, value: value });
            draft.selected.push(id);
            if (fields.maxTokens !== undefined)
                draft.intents.push({ id: `source:${modelKey(item.model)}:maxTokens`, kind: 'update', model: item.model, value: { id: item.model.modelId, maxTokens: fields.maxTokens } });
        }
        else
            for (const [field, value] of Object.entries(fields))
                if (field !== 'id' && canonical(value) !== canonical(old[field])) {
                    const id = `source:${modelKey(item.model)}:${field}`;
                    draft.intents.push({ id, kind: 'update', model: item.model, value: { id: old.id, [field]: value }, protectedName: field === 'name' });
                    if (old[field] === undefined && field !== 'maxTokens')
                        draft.selected.push(id);
                }
    }
    return draft;
}
