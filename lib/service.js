import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, mergeSelection, migrateConfig, modelKey, resolveSelection, validateConfig } from './domain.js';
import { canonical } from './official-state.js';
import { legacyImageOverrides, preserveLegacyImages, preserveUnknownConfig } from './legacy-image.js';
import { legacyAliasReliability, rejectAliasReliability } from './legacy-alias.js';
import { AliasHealthStore } from './alias-health.js';
/**
 * 宿主设置服务拒绝过期 revision 时抛出的冲突错误（`SettingsConflictError`，`code` 固定为 `SETTINGS_CONFLICT`）。
 * 按形状判定而不是 `instanceof`：本插件解析到的是自己那份 `@deepseek-ai/dsh-settings` 拷贝，
 * 与宿主抛出实例的构造函数不同源，`instanceof` 会漏判；错误消息是 `settings namespace "…" changed since it was read (expected …, now …)`。
 */
export function isSettingsConflict(error) {
    if (!error || typeof error !== 'object')
        return false;
    const candidate = error;
    if (candidate.code === 'SETTINGS_CONFLICT' || candidate.name === 'SettingsConflictError')
        return true;
    return /changed since it was read|SETTINGS_CONFLICT/i.test(String(candidate.message ?? error));
}
export class HostModelBridge {
    llm;
    settings;
    constructor(llm, settings) {
        this.llm = llm;
        this.settings = settings;
    }
    namespace(ns) { try {
        return this.settings.namespaceFor?.(ns) ?? ns;
    }
    catch {
        return ns;
    } }
    catalogCapabilities() {
        const namespaces = new Set(this.settings.describe({ redactSecrets: true }).map(item => item.ns));
        const configured = this.llm.listConfigurableProviders();
        return this.llm.listProviders().filter(p => p.id !== 'dsh-model-manager').map(provider => {
            const entry = configured.find(p => p.provider === provider.id);
            const ns = entry ? this.namespace(entry.settingsNs) : provider.id === 'deepseek-official' ? 'llm-deepseek' : undefined;
            const editable = this.settings.writable !== false && !!ns && namespaces.has(ns) && ['llm-deepseek', 'llm-pi-ai'].includes(ns);
            return { providerId: provider.id, canAdd: editable, canRename: editable, canRemove: editable, minimumModels: ns === 'llm-pi-ai' ? 1 : 0, ...(!editable ? { reason: '该 Provider 未公开已适配的可写目录契约' } : {}) };
        });
    }
    async catalog() {
        const settings = this.settings.describe({ redactSecrets: true });
        const providers = this.llm.listProviders().filter(p => p.id !== 'dsh-model-manager');
        const writable = new Set(this.llm.listConfigurableProviders().filter(p => ['llm-pi-ai', 'llm-deepseek'].includes(this.namespace(p.settingsNs))).map(p => p.provider));
        const configured = settings.find(d => d.ns === 'llm-pi-ai')?.value;
        const result = await Promise.all(providers.map(async (provider) => {
            const models = await this.llm.listModels(provider.id).catch(() => []);
            return Promise.all(models.map(async (model) => {
                const info = await this.llm.resolveModelInfo(provider.id, model.id).catch(() => model);
                const canWrite = writable.has(provider.id) && (provider.id === 'deepseek-official' || !configured?.providers?.[provider.id]?.models?.length || configured.providers[provider.id].models.some(item => item.id === model.id));
                const ns = provider.id === 'deepseek-official' ? 'llm-deepseek' : 'llm-pi-ai';
                const raw = settings.find(d => d.ns === ns)?.user;
                const profile = provider.id === 'deepseek-official' ? raw : raw?.providers?.[provider.id];
                const saved = profile?.models?.find((m) => m.id === model.id) ?? profile?.modelOverrides?.[model.id];
                return {
                    providerId: provider.id, modelId: model.id, name: model.name,
                    nativeImage: info.inputModalities ? info.inputModalities.includes('image') ? 'yes' : 'no' : 'unknown',
                    reasoningEfforts: 'reasoning' in info && info.reasoning ? info.reasoning.efforts.map(e => ({ id: e.id, name: e.name })) : [],
                    defaultReasoningEffort: 'reasoning' in info ? info.reasoning?.defaultEffort : undefined,
                    nativeDeclaration: canWrite && saved?.[provider.id === 'deepseek-official' ? 'inputModalities' : 'input'] !== undefined ? 'saved' : 'default',
                    contextWindow: 'context' in info ? info.context?.contextWindow : undefined,
                    defaultMaxTokens: 'defaultMaxTokens' in info ? info.defaultMaxTokens : undefined,
                    source: 'host', loaded: true,
                    nativeEditable: canWrite,
                    nativeRevision: canWrite ? settings.find(d => d.ns === ns)?.revision : undefined,
                    nativeClearable: canWrite && !configured?.providers?.[provider.id]?.models?.length,
                    nativeEditReason: canWrite ? undefined : writable.has(provider.id) ? '模型不在 Provider 的可编辑配置清单中' : '该 Provider 未公开可写模型字段',
                };
            }));
        }));
        return result.flat();
    }
    async applyNative(ref, fields, revision) {
        const entry = this.llm.listConfigurableProviders().find(p => p.provider === ref.providerId);
        if (entry && this.namespace(entry.settingsNs) === 'llm-deepseek') {
            const section = this.settings.get('llm-deepseek');
            if (!section?.models)
                throw Error('DeepSeek 模型清单不可编辑');
            const models = structuredClone(section.models), index = models.findIndex(m => m.id === ref.modelId);
            if (index < 0)
                throw Error('模型不在来源目录中');
            const input = Array.isArray(models[index].inputModalities) ? models[index].inputModalities : ['text'];
            models[index] = { ...models[index], ...(fields.image === undefined ? {} : { inputModalities: fields.image ? [...new Set([...input, 'image'])] : input.filter(i => i !== 'image') }), ...(fields.contextWindow === undefined ? {} : { contextWindow: fields.contextWindow }), ...(fields.maxTokens === undefined ? {} : { maxTokens: fields.maxTokens }) };
            await this.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: models }], revision);
            return;
        }
        if (!entry || this.namespace(entry.settingsNs) !== 'llm-pi-ai')
            throw new Error('该 Provider 未公开可写模型字段');
        const fieldPath = ['providers', ref.providerId, 'modelOverrides', ref.modelId];
        const input = this.modelInput(ref) ?? ['text'];
        const values = { ...(fields.image !== undefined ? { input: fields.image ? [...new Set([...input, 'image'])] : input.filter(i => i !== 'image') } : {}),
            ...(fields.contextWindow !== undefined ? { contextWindow: fields.contextWindow } : {}),
            ...(fields.maxTokens !== undefined ? { maxTokens: fields.maxTokens } : {}) };
        // 每次尝试都重读分节重建 ops：显式模型清单是整表替换，用旧快照重试会覆盖并发写入的兄弟模型字段。
        const build = () => {
            const section = this.settings.get('llm-pi-ai');
            const profile = section?.providers?.[ref.providerId];
            const ops = [];
            if (profile?.models?.length) {
                const index = profile.models.findIndex(m => m.id === ref.modelId);
                if (index < 0)
                    throw new Error('模型不在该 Provider 的配置清单中');
                const models = structuredClone(profile.models);
                models[index] = { ...models[index], ...values };
                ops.push({ op: 'set', path: ['providers', ref.providerId, 'models'], value: models });
            }
            else {
                for (const [field, value] of Object.entries(values))
                    ops.push({ op: 'set', path: [...fieldPath, field], value });
            }
            return ops;
        };
        // 先构建一次：保持「模型不在该 Provider 的配置清单中」等前置错误在写入前抛出，也让空字段集不发请求。
        if (build().length)
            await this.mutate(build, revision);
    }
    async clearNative(ref, fields, revision) {
        const entry = this.llm.listConfigurableProviders().find(p => p.provider === ref.providerId);
        if (!entry || this.namespace(entry.settingsNs) !== 'llm-pi-ai')
            throw new Error('该 Provider 未公开可写模型字段');
        const section = this.settings.get('llm-pi-ai');
        if (section?.providers?.[ref.providerId]?.models?.length)
            throw new Error('此 Provider 使用显式模型清单，无法安全地清除字段覆盖');
        const names = { image: 'input', contextWindow: 'contextWindow', maxTokens: 'maxTokens' };
        await this.mutate(() => fields.map(field => ({ op: 'unset', path: ['providers', ref.providerId, 'modelOverrides', ref.modelId, names[field]] })), revision);
    }
    /** 读取模型当前生效的 input 模态声明：显式清单优先，其次 modelOverrides；undefined 表示未显式声明。 */
    modelInput(ref) {
        if (ref.providerId === 'deepseek-official')
            return this.settings.get('llm-deepseek')?.models?.find(m => m.id === ref.modelId)?.inputModalities;
        const section = this.settings.get('llm-pi-ai');
        const profile = section?.providers?.[ref.providerId];
        if (profile?.models?.length)
            return profile.models.find(item => item.id === ref.modelId)?.input;
        return profile?.modelOverrides?.[ref.modelId]?.input;
    }
    /** 精确设置或删除 input 模态声明；恢复探测前的原值时使用。宿主 revision 可能被提权/还原等并发写入推进，冲突交给 `mutate` 重试。 */
    async setInput(ref, input, revision) {
        const entry = this.llm.listConfigurableProviders().find(p => p.provider === ref.providerId);
        if (entry && this.namespace(entry.settingsNs) === 'llm-deepseek') {
            const section = this.settings.get('llm-deepseek');
            if (!section?.models)
                throw Error('DeepSeek 模型目录不可编辑');
            const models = structuredClone(section.models), model = models.find(m => m.id === ref.modelId);
            if (!model)
                throw Error('模型不在来源目录中');
            if (input === undefined)
                delete model.inputModalities;
            else
                model.inputModalities = [...input];
            await this.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: models }], revision);
            return;
        }
        if (!entry || this.namespace(entry.settingsNs) !== 'llm-pi-ai')
            throw new Error('该 Provider 未公开可写模型字段');
        const build = () => {
            const section = this.settings.get('llm-pi-ai');
            const profile = section?.providers?.[ref.providerId];
            if (profile?.models?.length) {
                const index = profile.models.findIndex(item => item.id === ref.modelId);
                if (index < 0)
                    throw new Error('模型不在该 Provider 的配置清单中');
                const models = structuredClone(profile.models);
                if (input === undefined)
                    delete models[index].input;
                else
                    models[index] = { ...models[index], input: [...input] };
                return [{ op: 'set', path: ['providers', ref.providerId, 'models'], value: models }];
            }
            return input === undefined
                ? [{ op: 'unset', path: ['providers', ref.providerId, 'modelOverrides', ref.modelId, 'input'] }]
                : [{ op: 'set', path: ['providers', ref.providerId, 'modelOverrides', ref.modelId, 'input'], value: [...input] }];
        };
        await this.mutate(build, revision);
    }
    /**
     * 写入 `llm-pi-ai` 的唯一入口：宿主 namespace 的 revision 会被并发写入推进
     * （探测提权 → 实测 → 还原就把 revision 推两次），调用方读取的 token 很容易已经过期。
     * 首次仍按调用方 revision 做 CAS；只因冲突失败时改用最新 revision 重试有限次，其他错误立即上抛。
     * 每次尝试都重新执行 `build()`，保证 ops 反映写入时刻的分节（显式模型清单的整表替换尤其如此）。
     */
    async mutate(build, revision, attempts = 3) {
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const expected = attempt === 0 ? revision : this.currentRevision();
            if (expected === undefined)
                throw new Error('无法读取宿主设置版本');
            try {
                await this.settings.mutate('llm-pi-ai', build(), expected);
                return;
            }
            catch (error) {
                lastError = error;
                if (!isSettingsConflict(error))
                    throw error;
            }
        }
        throw lastError;
    }
    currentRevision(ref) {
        return this.settings.describe({ redactSecrets: true }).find(d => d.ns === (ref?.providerId === 'deepseek-official' ? 'llm-deepseek' : 'llm-pi-ai'))?.revision;
    }
}
export function resolveDataDir(profile) {
    const flag = process.argv.findIndex(arg => arg === '--profile');
    const fromArgv = flag >= 0 ? process.argv[flag + 1] : process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length);
    profile ??= process.env.DSH_PROFILE || fromArgv || 'desktop';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile))
        throw new Error('无效的 DSH profile 名称');
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    return join(home, 'profiles', profile, 'data', 'dsh-model-manager');
}
async function readJsonWithBackup(path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch {
        try {
            const backup = `${path}.bak`;
            const value = JSON.parse(await readFile(backup, 'utf8'));
            await copyFile(backup, `${path}.tmp`);
            await rename(`${path}.tmp`, path);
            return value;
        }
        catch {
            return undefined;
        }
    }
}
export class ModelManagerService {
    bridge;
    dataDir;
    settings;
    health;
    candidateSignature = async () => undefined;
    tokenEstimate;
    aliasTurns = new Map();
    actualModels = new Map();
    latestActualModel(session) { return this.actualModels.get(session); }
    recordActualModel(session, ref) { this.actualModels.set(session, structuredClone(ref)); }
    async refreshAliasHealth() {
        const { config } = this.snapshot(), valid = new Set();
        for (const [alias, value] of Object.entries(config.aliases))
            for (const ref of value.candidates) {
                valid.add(`${alias}:${modelKey(ref)}`);
                const signature = createHash('sha256').update(canonical([value, config.models[modelKey(ref)], await this.candidateSignature(ref)])).digest('hex');
                await this.health.eligible(alias, ref, signature);
            }
        await this.health.retain(valid);
        return this.health.snapshot();
    }
    config = structuredClone(DEFAULT_CONFIG);
    revision = 0;
    models = [];
    writeQueue = Promise.resolve();
    async flush() { await this.writeQueue; }
    logMaintainedAt = 0;
    verification = new Map();
    visionCache = new Map();
    overrides = new Map();
    autoDecisions = new Map();
    delegatedSessions = new Set();
    initialization;
    catalogBackupId;
    catalogBackupWritesPlugin;
    parameterBackupId;
    sourceBackupId;
    constructor(bridge, dataDir, settings) {
        this.bridge = bridge;
        this.dataDir = dataDir;
        this.settings = settings;
        this.health = new AliasHealthStore(dataDir);
    }
    async aliasCandidateAvailable(alias, ref, config) {
        const signature = createHash('sha256').update(canonical([config.aliases[alias], config.models[modelKey(ref)], await this.candidateSignature(ref)])).digest('hex');
        return (await this.health.eligible(alias, ref, signature)).allowed;
    }
    aliasLifecycle(alias, candidates, config, session, turn) {
        const key = `${session}:${turn}:${alias}`, identity = canonical(candidates);
        const tokens = new Map();
        const cursor = turn === undefined ? undefined : this.aliasTurns.get(key);
        let position = cursor?.candidates === identity ? cursor.cursor : 0;
        return {
            admit: async (ref) => {
                const index = candidates.findIndex(c => modelKey(c) === modelKey(ref));
                if (index < position)
                    return '本轮已切换到后续候选';
                const signature = createHash('sha256').update(canonical([config.aliases[alias], config.models[modelKey(ref)], await this.candidateSignature(ref)])).digest('hex');
                const eligible = await this.health.eligible(alias, ref, signature);
                if (!eligible.allowed)
                    return eligible.reason ?? '候选正在恢复';
                const token = this.health.claimRecovery(alias, ref);
                if (!token)
                    return '另一个会话正在恢复该候选';
                tokens.set(modelKey(ref), { ref, token, signature });
            },
            settled: async (ref, failure) => {
                const ticket = tokens.get(modelKey(ref));
                if (!ticket)
                    return;
                const index = candidates.findIndex(c => modelKey(c) === modelKey(ref));
                position = failure ? index + 1 : index;
                if (turn !== undefined)
                    this.aliasTurns.set(key, { cursor: position, candidates: identity });
                if (failure)
                    await this.health.recordFailure(alias, ref, ticket.signature, failure, config.aliases[alias]?.recovery ?? {}, ticket.token);
                else {
                    this.recordActualModel(session, ref);
                    await this.health.recordSuccess(alias, ref, ticket.signature, ticket.token);
                }
                tokens.delete(modelKey(ref));
            },
            release: () => { for (const t of tokens.values())
                this.health.release(alias, t.ref, t.token); tokens.clear(); },
        };
    }
    init() { return this.initialization ??= this.initialize(); }
    async initialize() {
        await mkdir(this.dataDir, { recursive: true });
        await this.health.init();
        const stored = this.settings?.get('dsh-model-manager');
        if (stored) {
            const migrated = migrateConfig(stored);
            validateConfig(migrated);
            this.config = structuredClone(migrated);
        }
        this.revision = this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? 0;
        this.models = this.decorateModels(await this.bridge.catalog());
        const records = await readJsonWithBackup(join(this.dataDir, 'verification.json'));
        if (Array.isArray(records))
            for (const record of records)
                this.verification.set(this.verificationKey(record.model, record.kind), record);
        const savedOverrides = await readJsonWithBackup(join(this.dataDir, 'overrides.json'));
        if (savedOverrides)
            for (const [session, value] of Object.entries(savedOverrides))
                this.overrides.set(session, value);
        const savedCache = await readJsonWithBackup(join(this.dataDir, 'vision-cache.json'));
        if (savedCache)
            for (const [key, value] of Object.entries(savedCache))
                if (value.at > Date.now() - 7 * 86400000)
                    this.visionCache.set(key, value);
        const latest = await readJsonWithBackup(join(this.dataDir, 'catalog-backups', 'latest.json'));
        if (latest?.source && /^[0-9a-f-]{36}$/.test(latest.source)) {
            const backup = await readJsonWithBackup(join(this.dataDir, 'catalog-backups', `${latest.source}.json`));
            if (backup?.status === 'applied')
                this.sourceBackupId = latest.source;
        }
        if (latest?.parameter && /^[0-9a-f-]{36}$/.test(latest.parameter)) {
            const backup = await readJsonWithBackup(join(this.dataDir, 'catalog-backups', `${latest.parameter}.json`));
            if (backup?.status === 'applied')
                this.parameterBackupId = latest.parameter;
        }
        if (latest?.manual && /^[0-9a-f-]{36}$/.test(latest.manual)) {
            const backup = await readJsonWithBackup(join(this.dataDir, 'catalog-backups', `${latest.manual}.json`));
            if (backup?.status === 'applied') {
                this.catalogBackupId = latest.manual;
                this.catalogBackupWritesPlugin = backup.writes.some(w => w.ns === 'dsh-model-manager');
            }
        }
    }
    onCatalogBackup(id, origin, status, writesPlugin) {
        if (origin === 'source' && status === 'applied')
            this.sourceBackupId = id;
        if (id === this.sourceBackupId && status === 'restored')
            this.sourceBackupId = undefined;
        if (origin === 'parameter' && status === 'applied')
            this.parameterBackupId = id;
        if (id === this.parameterBackupId && status === 'restored')
            this.parameterBackupId = undefined;
        if (origin === 'manual' && status === 'applied') {
            this.catalogBackupId = id;
            this.catalogBackupWritesPlugin = writesPlugin;
        }
        else if (id === this.catalogBackupId && status === 'restored') {
            this.catalogBackupId = undefined;
            this.catalogBackupWritesPlugin = undefined;
        }
    }
    snapshot() {
        const live = this.settings?.describe().find(d => d.ns === 'dsh-model-manager');
        if (live && live.revision !== this.revision)
            this.onSettingsChanged(live.value);
        return { revision: this.revision, config: structuredClone(this.config), models: structuredClone(this.models), hostDefault: this.hostDefault(),
            catalogCapabilities: this.bridge.catalogCapabilities?.() ?? [], catalogBackupId: this.catalogBackupId, catalogBackupWritesPlugin: this.catalogBackupWritesPlugin,
            parameterBackupId: this.parameterBackupId, sourceBackupId: this.sourceBackupId, legacyImageOverrideCount: legacyImageOverrides(this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.user).length,
            legacyAliasReliabilityCount: legacyAliasReliability(this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.user).length,
            verifications: [...this.verification.values()].map(value => ({ ...structuredClone(value), stale: value.signature !== this.signature(value.model, value.kind) })) };
    }
    async refresh() {
        await this.initialization;
        this.models = this.decorateModels(await this.bridge.catalog());
        return structuredClone(this.models);
    }
    decorateModels(models) {
        return models.map(model => ({ ...model,
            catalogOrigin: this.config.catalogMetadata?.[modelKey(model)]?.origin ?? 'unknown', customName: this.config.catalogMetadata?.[modelKey(model)]?.customName ?? false,
            capabilitySource: this.config.catalogMetadata?.[modelKey(model)]?.origin === 'source' ? '来源目录资料（经预览采用）' : model.providerId === 'deepseek-official' && this.config.official ? this.config.official.sourceUrl ?? this.config.official.sources?.models ?? 'DSH 已加载模型目录' : 'DSH 已加载模型目录',
            capabilityCheckedAt: typeof this.config.catalogMetadata?.[modelKey(model)]?.checkedAt === 'string' ? this.config.catalogMetadata[modelKey(model)].checkedAt : model.providerId === 'deepseek-official' ? this.config.official?.checkedAt : undefined }));
    }
    async update(next, revision) {
        rejectAliasReliability(next);
        validateConfig(next);
        if (revision !== this.revision)
            throw new Error('SETTINGS_CONFLICT');
        if (this.settings) {
            const raw = this.settings.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.user;
            const stored = preserveUnknownConfig(this.config, next, raw);
            preserveLegacyImages(stored, raw);
            await this.settings.replace('dsh-model-manager', stored, revision);
            this.revision = this.settings.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? revision + 1;
        }
        else
            this.revision++;
        this.config = structuredClone(next);
        return this.revision;
    }
    onSettingsChanged(next) {
        const migrated = migrateConfig(next);
        validateConfig(migrated);
        this.config = structuredClone(migrated);
        this.revision = this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? this.revision + 1;
    }
    model(ref) { return this.models.find(m => m.providerId === ref.providerId && m.modelId === ref.modelId); }
    /**
     * 宿主默认模型（`agent-default-model` 设置）。选择器里的 AUTO 条目在没有配置
     * 旧固定主模型未配置时回退到宿主默认，避免 AUTO 落到「没有任何候选」。
     */
    hostDefault() {
        const value = this.settings?.get('agent-default-model');
        if (typeof value?.provider !== 'string' || typeof value?.model !== 'string' || !value.provider || !value.model)
            return undefined;
        return { providerId: value.provider, modelId: value.model };
    }
    getOverride(session) {
        const value = this.overrides.get(session);
        return { session: value?.session && structuredClone(value.session), nextTurn: value?.nextTurn && structuredClone(value.nextTurn) };
    }
    async setOverride(session, scope, selection) {
        if (!/^[a-zA-Z0-9:_-]{1,150}$/.test(session))
            throw new Error('无效会话 ID');
        if (selection?.target) {
            resolveSelection(this.config, selection.target);
        }
        await this.withFutureOverrides(undefined, async (save) => {
            const next = this.futureOverrides();
            const value = next[session] ?? {};
            const preview = { ...value, [scope]: selection };
            // v2：非 AUTO 的原生请求没有全局配置行，覆盖只叠加在空基线上。
            const effective = mergeSelection(mergeSelection({}, preview.session), preview.nextTurn);
            if (effective.thinking === 'off' && effective.tier && !['auto', 'inherit'].includes(effective.tier))
                throw new Error('关闭思考不能同时选择非关闭推理档位');
            if (effective.maxOutputTokens !== undefined && (!Number.isInteger(effective.maxOutputTokens) || effective.maxOutputTokens < 1))
                throw new Error('输出上限必须为正整数');
            if (selection)
                value[scope] = structuredClone(selection);
            else
                delete value[scope];
            next[session] = value;
            await save(next);
        });
    }
    futureOverrides() {
        return Object.fromEntries([...this.overrides.entries()].filter(([, value]) => value.session || value.nextTurn).map(([key, value]) => [key, structuredClone({ ...(value.session ? { session: value.session } : {}), ...(value.nextTurn ? { nextTurn: value.nextTurn } : {}) })]));
    }
    futureOverridesFingerprint() { return createHash('sha256').update(canonical(this.futureOverrides())).digest('hex'); }
    /** 整个官方写集持有同一覆盖队列；setOverride 和 nextTurn 消耗不能插入其间。 */
    async withFutureOverrides(expected, action) {
        const operation = this.writeQueue.catch(() => { }).then(async () => {
            await this.initialization;
            if (expected !== undefined && expected !== this.futureOverridesFingerprint())
                throw new Error('SETTINGS_CONFLICT：会话覆盖已变化');
            let fingerprint = this.futureOverridesFingerprint();
            const save = async (next) => {
                if (fingerprint !== this.futureOverridesFingerprint())
                    throw new Error('SETTINGS_CONFLICT：下一轮覆盖已消耗');
                const target = join(this.dataDir, 'overrides.json');
                await writeFile(`${target}.tmp`, JSON.stringify(next), 'utf8');
                try {
                    await copyFile(target, `${target}.bak`);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                await rename(`${target}.tmp`, target);
                // endTurn 必须即时消费选择；磁盘等待期间也不能将已消费的覆盖重新放回内存。
                if (fingerprint !== this.futureOverridesFingerprint()) {
                    await writeFile(`${target}.tmp`, JSON.stringify(this.futureOverrides()), 'utf8');
                    await rename(`${target}.tmp`, target);
                    throw new Error('SETTINGS_CONFLICT：下一轮覆盖已消耗');
                }
                // 保留 active 请求快照，未来覆盖才迁移或恢复。
                for (const [key, value] of this.overrides) {
                    delete value.session;
                    delete value.nextTurn;
                    if (next[key])
                        Object.assign(value, structuredClone(next[key]));
                }
                for (const [key, value] of Object.entries(next))
                    if (!this.overrides.has(key))
                        this.overrides.set(key, structuredClone(value));
                fingerprint = this.futureOverridesFingerprint();
            };
            return action(save);
        });
        this.writeQueue = operation.then(() => { }, () => { });
        return operation;
    }
    effectiveSelection(session, turn) {
        const value = this.overrides.get(session) ?? {};
        if (!value.active || value.active.turn !== turn) {
            value.active = { turn, selection: mergeSelection(value.session ?? {}, value.nextTurn) };
            this.overrides.set(session, value);
        }
        const global = {};
        return structuredClone(mergeSelection(global, value.active.selection));
    }
    activeSelection(session) { return this.overrides.get(session)?.active?.selection && structuredClone(this.overrides.get(session).active.selection); }
    activeTurn(session) { return this.overrides.get(session)?.active?.turn; }
    autoDecision(session, turn) { const entry = this.autoDecisions.get(session); return entry?.turn === turn ? structuredClone(entry.value) : undefined; }
    saveAutoDecision(session, turn, value) { this.autoDecisions.set(session, { turn, value: structuredClone(value) }); }
    latestAutoDecision(session) { const entry = this.autoDecisions.get(session); return entry && structuredClone(entry.value); }
    markDelegatedSession(session) { this.delegatedSessions.add(session); }
    isDelegatedSession(session) { return this.delegatedSessions.has(session); }
    endTurn(session, turn) {
        for (const key of this.aliasTurns.keys())
            if (key.startsWith(`${session}:${turn}:`))
                this.aliasTurns.delete(key);
        const value = this.overrides.get(session);
        if (value?.active?.turn !== turn)
            return;
        delete value.active;
        if (value.nextTurn) {
            delete value.nextTurn;
            void this.setOverride(session, 'nextTurn').catch(() => { });
        }
    }
    signature(ref, kind) {
        const model = this.model(ref);
        const { nativeRevision: _revision, ...stableModel } = model ?? {};
        const settings = this.config.models[modelKey(ref)];
        const reasoningSelection = kind === 'reasoning' ? this.config.auto.main : undefined;
        return createHash('sha256').update(JSON.stringify({ model: stableModel, settings, reasoningSelection, providerAdapterVersion: 1 })).digest('hex');
    }
    verificationKey(ref, kind) { return `${modelKey(ref)}:${kind}`; }
    getVerification(ref, kind) {
        const evidence = this.verification.get(this.verificationKey(ref, kind));
        return evidence && { ...evidence, stale: evidence.signature !== this.signature(ref, kind) };
    }
    getVisionCache(key) { return this.visionCache.get(key)?.answer; }
    async putVisionCache(key, answer) {
        this.visionCache.set(key, { answer, at: Date.now() });
        const target = join(this.dataDir, 'vision-cache.json');
        this.writeQueue = this.writeQueue.catch(() => { }).then(async () => {
            const current = [...this.visionCache.entries()].filter(([, value]) => value.at > Date.now() - 7 * 86400000).slice(-1000);
            this.visionCache = new Map(current);
            await writeFile(`${target}.tmp`, JSON.stringify(Object.fromEntries(current)), 'utf8');
            try {
                await copyFile(target, `${target}.bak`);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            await rename(`${target}.tmp`, target);
        });
        await this.writeQueue;
    }
    async saveVerification(result) {
        this.verification.set(this.verificationKey(result.model, result.kind), result);
        const target = join(this.dataDir, 'verification.json');
        const temporary = `${target}.tmp`;
        const backup = `${target}.bak`;
        this.writeQueue = this.writeQueue.catch(() => { }).then(async () => {
            await writeFile(temporary, JSON.stringify([...this.verification.values()], null, 2), 'utf8');
            try {
                await copyFile(target, backup);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            await rename(temporary, target);
        });
        await this.writeQueue;
    }
    async log(event) {
        const safe = Object.fromEntries(Object.entries(event).filter(([key]) => !/key|secret|prompt|image|credential|bytes/i.test(key)));
        this.writeQueue = this.writeQueue.catch(() => { }).then(async () => {
            const path = join(this.dataDir, 'calls.jsonl');
            const age = Date.now() - 7 * 86400000;
            const line = JSON.stringify({ time: new Date().toISOString(), ...safe }) + '\n';
            const maxBytes = 50 * 1024 * 1024;
            let size = 0;
            try {
                size = (await stat(path)).size;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (size + Buffer.byteLength(line) > maxBytes || Date.now() - this.logMaintainedAt > 86400000) {
                let existing = '';
                try {
                    existing = await readFile(path, 'utf8');
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                const rows = [...existing.split('\n').filter(Boolean), line.trimEnd()].filter(row => {
                    try {
                        return Date.parse(JSON.parse(row).time) >= age;
                    }
                    catch {
                        return false;
                    }
                });
                const kept = [];
                let used = 0;
                for (const row of rows.reverse()) {
                    const bytes = Buffer.byteLength(row) + 1;
                    if (used + bytes > maxBytes)
                        break;
                    kept.push(row);
                    used += bytes;
                }
                await writeFile(`${path}.tmp`, kept.reverse().map(row => `${row}\n`).join(''), 'utf8');
                await rename(`${path}.tmp`, path);
                await rm(join(this.dataDir, 'calls.previous.jsonl'), { force: true });
                this.logMaintainedAt = Date.now();
            }
            else
                await appendFile(path, line, 'utf8');
        });
        await this.writeQueue;
    }
    async logs(limit = 200) {
        try {
            return (await readFile(join(this.dataDir, 'calls.jsonl'), 'utf8')).trim().split('\n').slice(-limit).map(line => JSON.parse(line));
        }
        catch {
            return [];
        }
    }
}
