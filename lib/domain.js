/** 上下文溢出兜底使用的内置保留别名。 */
export const LONG_CONTEXT_ALIAS = 'long-context';
/**
 * 把探测得到的验证证据映射成可预览的配置建议。
 * 只依据行为证据：识别出探测图颜色才算高置信；
 * 网络错误、取消、请求被拒一律不给建议，避免把偶发故障写成模型能力。
 */
export function probeSuggestions(verifications) {
    const suggestions = [];
    for (const item of verifications) {
        if (item.kind !== 'image')
            continue;
        if (item.status === 'accepted' && item.behavior === 'observed') {
            const reason = '图片探测通过：模型正确识别了探测图的颜色';
            suggestions.push({ field: 'hostImage', value: 'yes', confidence: 'high', reason });
        }
    }
    return suggestions;
}
export const DEFAULT_CONFIG = {
    version: 4, aliases: {}, models: {},
    auto: {
        enabled: false, simple: {}, normal: {}, complex: {},
        main: {},
        roles: {
            search: { tier: 'low' },
            coding: { tier: 'high' },
            review: { tier: 'high' },
            strong: { tier: 'max' },
            vision: { tier: 'auto' },
        },
    },
    vision: { enabled: false, policy: 'native-first' },
    reliability: { maxAttempts: 3, retryTransient: true, parameterDowngrade: false },
};
export function modelKey(ref) {
    return JSON.stringify([ref.providerId, ref.modelId]);
}
export function managedId(ref) {
    return `${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.modelId)}`;
}
export function fromManagedId(id) {
    try {
        let raw;
        if (id.includes('/')) {
            const parts = id.split('/');
            if (parts.length !== 2 || parts.some(part => !part))
                throw new Error();
            raw = parts.map(part => decodeURIComponent(part));
        }
        else {
            // 旧会话保留原标识；只解码，不改写宿主选择或历史记录。
            if (!/^[A-Za-z0-9_-]+$/.test(id))
                throw new Error();
            const binary = atob(id.replace(/-/g, '+').replace(/_/g, '/'));
            if (btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== id)
                throw new Error();
            const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
            raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        }
        if (!Array.isArray(raw) || raw.length !== 2 || raw.some(v => typeof v !== 'string' || !v))
            throw new Error();
        return { providerId: raw[0], modelId: raw[1] };
    }
    catch {
        throw new Error('无效的受管理模型 ID');
    }
}
export function aliasCandidates(config, name) {
    return config.aliases[name]?.candidates ?? [];
}
export function resolveSelection(config, target) {
    if (!target)
        return [];
    if (typeof target !== 'string')
        return [target];
    if (!/^@[a-z][a-z0-9_-]*$/.test(target))
        throw new Error(`无效别名：${target}`);
    const candidates = aliasCandidates(config, target.slice(1));
    if (!candidates.length)
        throw new Error(`别名未绑定：${target}`);
    return candidates.map(ref => ({ ...ref }));
}
const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/**
 * 按模型公开的实际档位推断 low/high/max 的默认映射：
 * low → 最弱档、max → 最强档、high → 次强档（档位不足三个时与 max 重合）。
 * off 不推断：直接使用模型的关闭思考档位。零配置默认值；推断错时用户仍可逐模型显式覆盖。
 */
export function inferTierMapping(record) {
    const efforts = [...record.reasoningEfforts.filter(e => e.id !== 'off')]
        .sort((a, b) => {
        const ia = EFFORT_ORDER.indexOf(a.id);
        const ib = EFFORT_ORDER.indexOf(b.id);
        if (ia >= 0 && ib >= 0)
            return ia - ib;
        if (ia >= 0)
            return -1;
        if (ib >= 0)
            return 1;
        return a.id.localeCompare(b.id);
    });
    const n = efforts.length;
    if (!n)
        return {};
    return {
        low: efforts[0].id,
        high: n >= 3 ? efforts[n - 2].id : efforts[n - 1].id,
        max: efforts[n - 1].id,
    };
}
export function mapEffort(record, settings, tier) {
    if (!tier || tier === 'inherit' || tier === 'auto')
        return undefined;
    if (tier === 'off') {
        const off = record.reasoningEfforts.find(e => e.id === 'off');
        if (!off)
            throw new Error(`${record.name} 不支持关闭思考（未公开 off 档位）`);
        return off.id;
    }
    const legacy = tier === 'fast' || tier === 'balanced' || tier === 'deep' ? settings?.legacyTiers?.[tier] : undefined;
    if (legacy) {
        if (!record.reasoningEfforts.some(e => e.id === legacy))
            throw new Error(`${record.name} 不支持推理档位 ${legacy}`);
        return legacy;
    }
    const old = tier === 'fast' ? 'low' : tier === 'balanced' || tier === 'deep' ? 'high' : tier;
    const mapped = settings?.tiers?.[old];
    const inferred = inferTierMapping(record)[old];
    const effective = mapped && mapped !== 'auto' ? mapped : inferred;
    if (!effective)
        throw new Error(`${record.name} 未配置 ${tier} 档位`);
    if (!record.reasoningEfforts.some(e => e.id === effective))
        throw new Error(`${record.name} 不支持推理档位 ${effective}`);
    return effective;
}
/** 兼容旧调用点：off 语义已并入 tier，这里只按 tier 解析。 */
export function mapSelectionEffort(record, settings, selection) {
    if (selection.reasoningEffort) {
        if (!record.reasoningEfforts.some(e => e.id === selection.reasoningEffort))
            throw new Error(`${record.name} 不支持推理档位 ${selection.reasoningEffort}`);
        return selection.reasoningEffort;
    }
    if (selection.thinking === 'off')
        return mapEffort(record, settings, 'off');
    return mapEffort(record, settings, selection.tier);
}
export function mergeSelection(base, overlay) {
    if (!overlay)
        return { ...base };
    return {
        ...base,
        ...(overlay.target !== undefined ? { target: overlay.target } : {}),
        ...(overlay.thinking && overlay.thinking !== 'inherit' ? { thinking: overlay.thinking } : {}),
        ...(overlay.tier && overlay.tier !== 'inherit' ? { tier: overlay.tier } : {}),
        ...(overlay.reasoningEffort !== undefined ? { reasoningEffort: overlay.reasoningEffort } : {}),
        ...(overlay.maxOutputTokens !== undefined ? { maxOutputTokens: overlay.maxOutputTokens } : {}),
    };
}
/** 保留旧选择值，供运行时按迁移后的逐模型映射还原真实档位。 */
function migrateTierValue(value) {
    switch (value) {
        case 'fast':
        case 'balanced':
        case 'deep':
        case 'max':
        case 'low':
        case 'high':
        case 'off':
        case 'auto':
        case 'inherit': return value;
        default: return undefined;
    }
}
/** 把旧版档位名与新版对齐：Selection 里的 tier、旧 thinking:'off' 并入 tier，模型 tiers 映射键名同步替换。 */
function migrateSelectionTiers(selection) {
    if (!selection || typeof selection !== 'object')
        return selection ?? {};
    const next = { ...selection };
    if (next.thinking === 'off')
        next.tier = 'off';
    delete next.thinking;
    if (next.tier !== undefined)
        next.tier = migrateTierValue(next.tier);
    return next;
}
function migrateModelTiers(settings) {
    settings = structuredClone(settings ?? {});
    if (settings.capability && typeof settings.capability === 'object')
        delete settings.capability.image;
    if (!settings?.tiers)
        return settings ?? {};
    const tiers = { ...settings.tiers };
    for (const key of ['fast', 'balanced', 'deep'])
        delete tiers[key];
    const legacyTiers = { ...settings.legacyTiers };
    for (const key of ['fast', 'balanced', 'deep']) {
        const value = settings.tiers[key];
        if (value !== undefined)
            legacyTiers[key] = value;
    }
    for (const key of ['low', 'high', 'max']) {
        const value = settings.tiers[key];
        if (value !== undefined)
            tiers[key] = value;
    }
    if (!tiers.low && legacyTiers.fast)
        tiers.low = legacyTiers.fast;
    if (!tiers.high && legacyTiers.balanced)
        tiers.high = legacyTiers.balanced;
    if (!tiers.max && legacyTiers.deep)
        tiers.max = legacyTiers.deep;
    return { ...settings, tiers, ...(Object.keys(legacyTiers).length ? { legacyTiers } : {}) };
}
/** 把 v1 配置迁移成 v2：别名数组包成 AliasConfig，长上下文候选转成内置别名，丢弃 mode/manual 行；新旧档位名统一对齐（幂等）。 */
export function migrateConfig(input) {
    const raw = input;
    if (![1, 2, 3, 4].includes(raw?.version ?? 0))
        throw new Error('不支持的配置版本');
    const current = raw.auto && typeof raw.auto === 'object' && (raw.version !== 1 || 'main' in raw.auto) ? raw.auto : undefined;
    const legacyMain = current?.main ?? (raw.version === 1 ? raw.auto : undefined) ?? {};
    const legacyRoles = current?.roles ?? raw.roles ?? {};
    const aliases = {};
    for (const [name, value] of Object.entries(raw.aliases ?? {})) {
        if (Array.isArray(value))
            aliases[name] = { candidates: value };
        else if (value && Array.isArray(value.candidates)) {
            const { reliability: _legacy, ...alias } = structuredClone(value);
            aliases[name] = alias;
        }
    }
    const { longContextCandidates: _retired, ...reliabilityFields } = structuredClone(raw.reliability ?? {});
    const reliability = { ...reliabilityFields, maxAttempts: raw.reliability?.maxAttempts ?? 3, retryTransient: raw.reliability?.retryTransient ?? true, parameterDowngrade: raw.reliability?.parameterDowngrade ?? false };
    const longContext = raw.reliability?.longContextCandidates ?? [];
    if (longContext.length && !aliases[LONG_CONTEXT_ALIAS])
        aliases[LONG_CONTEXT_ALIAS] = { candidates: structuredClone(longContext) };
    const models = {};
    for (const [key, settings] of Object.entries(raw.models ?? {}))
        models[key] = migrateModelTiers(settings);
    const roles = { ...structuredClone(DEFAULT_CONFIG.auto.roles), ...structuredClone(legacyRoles) };
    for (const role of Object.keys(roles))
        if (legacyRoles[role])
            roles[role] = migrateSelectionTiers(structuredClone(legacyRoles[role]));
    return {
        ...structuredClone(input), version: 4, aliases, models, official: raw.official,
        ...(input?.parameterCompletion !== undefined ? { parameterCompletion: structuredClone(input.parameterCompletion) } : {}),
        ...(input?.catalogMetadata ? { catalogMetadata: structuredClone(input.catalogMetadata) } : {}),
        auto: { ...structuredClone(current), enabled: current?.enabled ?? false, evaluator: current?.evaluator,
            simple: migrateSelectionTiers(current?.simple), normal: migrateSelectionTiers(current?.normal ?? legacyMain), complex: migrateSelectionTiers(current?.complex ?? legacyMain),
            ...(current && Object.hasOwn(current, 'preferences') ? { preferences: structuredClone(current.preferences) } : {}), main: migrateSelectionTiers(legacyMain), roles },
        vision: structuredClone(raw.vision ?? { enabled: false, policy: 'native-first' }),
        reliability,
    };
}
function isValidRef(ref) {
    return !!ref && typeof ref.providerId === 'string' && typeof ref.modelId === 'string' && !!ref.providerId && !!ref.modelId;
}
export function validateConfig(config) {
    if (config.version !== 4)
        throw new Error('不支持的配置版本');
    for (const source of Object.values(config.sources ?? {})) {
        if (!source || !['deepseek', 'ark-agent-plan', 'opencode-go'].includes(source.kind) || !source.providerId || source.arkProfile !== undefined && (source.kind !== 'ark-agent-plan' || !source.arkProfile.trim()))
            throw new Error('模型来源关联无效');
    }
    const rules = config.auto.rules ?? [];
    if (!Array.isArray(rules) || new Set(rules.map(r => r.id)).size !== rules.length)
        throw new Error('AUTO 规则 ID 重复或格式无效');
    for (const rule of rules) {
        if (!rule.id || !rule.name?.trim() || typeof rule.enabled !== 'boolean' || !Array.isArray(rule.taskTypes) || !rule.taskTypes.length || rule.taskTypes.some(t => !['coding', 'writing', 'research', 'analysis', 'general'].includes(t)) || rule.grades !== undefined && (!rule.grades.length || rule.grades.some(g => !['simple', 'normal', 'complex'].includes(g))))
            throw new Error('AUTO 任务规则无效');
        if (rule.enabled) {
            if (!rule.selection?.target)
                throw new Error('启用的 AUTO 规则尚未绑定模型');
            resolveSelection(config, rule.selection.target);
        }
    }
    if (config.vision.automatic !== undefined && typeof config.vision.automatic !== 'boolean')
        throw new Error('自动图片设置无效');
    if (config.parameterCompletion !== undefined && (!config.parameterCompletion || typeof config.parameterCompletion !== 'object' || Array.isArray(config.parameterCompletion)))
        throw new Error('搜索凭据配置无效');
    if (config.parameterCompletion?.searchCredentialName !== undefined && (typeof config.parameterCompletion.searchCredentialName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.parameterCompletion.searchCredentialName)))
        throw new Error('搜索凭据引用名无效');
    for (const settings of Object.values(config.models))
        if (settings?.capability && Object.hasOwn(settings.capability, 'image'))
            throw new Error('插件图片声明已停用，不能创建或修改');
    if (config.catalogMetadata !== undefined) {
        if (!config.catalogMetadata || typeof config.catalogMetadata !== 'object' || Array.isArray(config.catalogMetadata))
            throw new Error('模型来源元数据无效');
        for (const value of Object.values(config.catalogMetadata))
            if (!value || typeof value !== 'object' || Array.isArray(value) || value.origin !== undefined && !['manual', 'official', 'source'].includes(value.origin) || value.customName !== undefined && typeof value.customName !== 'boolean')
                throw new Error('模型来源元数据无效');
    }
    if (config.official?.sourceUrl !== undefined) {
        const url = new URL(config.official.sourceUrl);
        if (url.protocol !== 'https:' || url.username || url.password)
            throw new Error('官方资料入口必须是无凭据的 HTTPS 网址');
    }
    if (config.official?.analyzer && (!isValidRef(config.official.analyzer) || config.official.analyzer.providerId === 'dsh-model-manager'))
        throw new Error('分析模型必须是具体已加载的真实模型');
    if (!Number.isInteger(config.reliability.maxAttempts) || config.reliability.maxAttempts < 1 || config.reliability.maxAttempts > 3)
        throw new Error('尝试次数必须为 1–3');
    for (const [name, alias] of Object.entries(config.aliases ?? {})) {
        if (!/^[a-z][a-z0-9_-]*$/.test(name) || !alias || !Array.isArray(alias.candidates) || !alias.candidates.length)
            throw new Error(`无效别名：${name}`);
        for (const ref of alias.candidates)
            if (!isValidRef(ref))
                throw new Error(`别名 ${name} 只能引用具体模型`);
        if (alias.efforts && Object.values(alias.efforts).some(value => typeof value !== 'string' || !value))
            throw new Error(`别名 ${name} 的推理档位无效`);
        for (const seconds of Object.values(alias.recovery ?? {}))
            if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800)
                throw new Error(`别名 ${name} 的冷却时间必须是 1–604800 秒`);
        // 旧别名策略仅在原始层等待独立清理，不参与有效配置校验。
    }
    if (config.auto?.main?.target)
        resolveSelection(config, config.auto.main.target);
    if (config.auto.enabled) {
        if (!config.auto.evaluator || !isValidRef(config.auto.evaluator))
            throw new Error('AUTO 需要配置评估模型');
        for (const grade of ['simple', 'normal', 'complex'])
            if (!config.auto[grade].target)
                throw new Error(`AUTO ${grade} 档尚未绑定模型`);
    }
    for (const selection of [config.auto?.main, ...Object.values(config.auto?.roles ?? {}), config.auto.simple, config.auto.normal, config.auto.complex, ...(config.auto.rules ?? []).map(r => r.selection)]) {
        if (!selection)
            continue;
        if (selection.maxOutputTokens !== undefined && (!Number.isInteger(selection.maxOutputTokens) || selection.maxOutputTokens < 1))
            throw new Error('输出上限必须为正整数');
    }
    // 角色目标在使用时校验（未绑定的别名按「角色不可用」处理，而不是拒绝整份配置）。
    if (config.vision.enabled && config.vision.target)
        resolveSelection(config, config.vision.target);
}
export function visionRoute(policy, nativeImage, hasSidecar) {
    if (policy === 'native-only')
        return nativeImage === 'yes' ? 'native' : 'error';
    if (policy === 'sidecar-only')
        return hasSidecar ? 'sidecar' : 'error';
    if (policy === 'sidecar-first' && hasSidecar)
        return 'sidecar';
    if (nativeImage === 'yes')
        return 'native';
    return hasSidecar ? 'sidecar' : 'error';
}
export function classifyFailure(status, code) {
    if (status === 429)
        return 'cooldown';
    if (status === 401 || status === 403)
        return 'auth';
    if (status === 400 && /context|length|token/i.test(code ?? ''))
        return 'context';
    if (status === 400)
        return 'parameter';
    if (!status || status >= 500 || status === 408)
        return 'retry';
    return 'terminal';
}
