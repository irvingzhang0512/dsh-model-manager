export type Support = 'yes' | 'no' | 'unknown'
export type Tier = 'auto' | 'off' | 'low' | 'high' | 'max' | 'fast' | 'balanced' | 'deep'
export type TaskGrade = 'simple' | 'normal' | 'complex'
export type VisionPolicy = 'native-first' | 'sidecar-first' | 'native-only' | 'sidecar-only'
export type Role = 'search' | 'coding' | 'review' | 'strong' | 'vision'

export interface ModelRef { providerId: string; modelId: string }
export interface CapabilityOverride {
  image?: Support
  thinking?: Support
  contextWindow?: number
  maxOutputTokens?: number
  source?: string
}
export interface ModelSettings {
  capability?: CapabilityOverride
  /** 档位映射：low/high/max 取值为该模型支持的实际档位 id；缺省或 'auto' 表示按模型公开档位自动推断；off 直接使用模型的关闭思考档位。 */
  tiers?: Partial<Record<'low' | 'high' | 'max', string>>
  /** 从旧版保留，确保原 fast/balanced/deep 选择的实际档位不丢失。 */
  legacyTiers?: Partial<Record<'fast' | 'balanced' | 'deep', string>>
}
export interface Selection {
  target?: ModelRef | string
  /** v1/v2 迁移兼容；新设置只使用 reasoningEffort。 */
  thinking?: 'inherit' | 'auto' | 'off'
  tier?: Tier | 'inherit'
  reasoningEffort?: string
  maxOutputTokens?: number
}
/** 子 Agent 角色绑定：是否可委派由「角色是否绑定了有效模型」决定，这里只负责绑模型与推理参数。 */
export interface RoleSettings extends Selection { }
/** 别名级兜底覆盖：未填写的字段使用全局默认兜底策略。 */
export interface AliasReliability { maxAttempts?: number; retryTransient?: boolean; parameterDowngrade?: boolean }
/** 别名 = 一串按顺序兜底的具体模型候选 + 可选的兜底策略覆盖。 */
export interface AliasConfig { candidates: ModelRef[]; efforts?: Record<string, string>; reliability?: AliasReliability }
export interface ManagerConfig {
  version: 3
  aliases: Record<string, AliasConfig>
  models: Record<string, ModelSettings>
  official?: { checkedAt: string; sources: Record<string, string> }
  /** main/roles 仅供旧配置迁移和已有会话读取。 */
  auto: { enabled: boolean; evaluator?: ModelRef; simple: Selection; normal: Selection; complex: Selection; preferences: Record<string, Selection>; main: Selection; roles: Record<Role, RoleSettings> }
  vision: { enabled: boolean; policy: VisionPolicy; target?: ModelRef | string }
  /** 全局默认兜底策略；别名可用 reliability 覆盖个别字段。 */
  reliability: { maxAttempts: number; retryTransient: boolean; parameterDowngrade: boolean }
}
export interface ModelRecord extends ModelRef {
  name: string
  nativeImage: Support
  reasoningEfforts: { id: string; name: string }[]
  contextWindow?: number
  defaultMaxTokens?: number
  source: 'host' | 'user'
  loaded: boolean
  nativeEditable?: boolean
  nativeClearable?: boolean
  nativeEditReason?: string
  capabilitySource?: string
  capabilityCheckedAt?: string
}
export interface Verification {
  model: ModelRef
  kind: 'text' | 'image' | 'tools' | 'reasoning'
  status: 'accepted' | 'rejected' | 'network-error' | 'cancelled'
  checkedAt: string
  signature: string
  requestCount: number
  behavior?: 'observed' | 'not-observed' | 'unknown'
  detail?: string
}

/** 上下文溢出兜底使用的内置保留别名。 */
export const LONG_CONTEXT_ALIAS = 'long-context'

/** 探测可写入的配置位置：宿主声明（写 llm-pi-ai）或插件声明（写本插件配置）。 */
export type ProbeField = 'hostImage' | 'pluginImage'

export interface ProbeSuggestion {
  field: ProbeField
  value: Support
  confidence: 'high' | 'low'
  reason: string
}

/**
 * 把探测得到的验证证据映射成可预览的配置建议。
 * 只依据行为证据：识别出探测图颜色才算高置信；
 * 网络错误、取消、请求被拒一律不给建议，避免把偶发故障写成模型能力。
 */
export function probeSuggestions(verifications: Verification[]): ProbeSuggestion[] {
  const suggestions: ProbeSuggestion[] = []
  for (const item of verifications) {
    if (item.kind !== 'image') continue
    if (item.status === 'accepted' && item.behavior === 'observed') {
      const reason = '图片探测通过：模型正确识别了探测图的颜色'
      suggestions.push({ field: 'hostImage', value: 'yes', confidence: 'high', reason })
      suggestions.push({ field: 'pluginImage', value: 'yes', confidence: 'high', reason })
    } else if (item.status === 'accepted' && item.behavior === 'not-observed') {
      suggestions.push({ field: 'pluginImage', value: 'no', confidence: 'low', reason: `图片探测未通过：${item.detail ?? '模型未识别出探测图颜色'}` })
    } else if (item.status === 'rejected') {
      suggestions.push({ field: 'pluginImage', value: 'no', confidence: 'low', reason: `图片请求被拒绝：${item.detail ?? '宿主或模型拒绝了图片参数'}` })
    }
  }
  return suggestions
}

export const DEFAULT_CONFIG: ManagerConfig = {
  version: 3, aliases: {}, models: {},
  auto: {
    enabled: false, simple: {}, normal: {}, complex: {}, preferences: {},
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
}

export function modelKey(ref: ModelRef): string {
  return JSON.stringify([ref.providerId, ref.modelId])
}

export function managedId(ref: ModelRef): string {
  return Buffer.from(modelKey(ref), 'utf8').toString('base64url')
}

export function fromManagedId(id: string): ModelRef {
  const raw: unknown = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'))
  if (!Array.isArray(raw) || raw.length !== 2 || raw.some(v => typeof v !== 'string' || !v)) throw new Error('无效的受管理模型 ID')
  return { providerId: raw[0], modelId: raw[1] }
}

export function aliasCandidates(config: ManagerConfig, name: string): ModelRef[] {
  return config.aliases[name]?.candidates ?? []
}

export function resolveSelection(config: ManagerConfig, target?: ModelRef | string): ModelRef[] {
  if (!target) return []
  if (typeof target !== 'string') return [target]
  if (!/^@[a-z][a-z0-9_-]*$/.test(target)) throw new Error(`无效别名：${target}`)
  const candidates = aliasCandidates(config, target.slice(1))
  if (!candidates.length) throw new Error(`别名未绑定：${target}`)
  return candidates.map(ref => ({ ...ref }))
}

const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 按模型公开的实际档位推断 low/high/max 的默认映射：
 * low → 最弱档、max → 最强档、high → 次强档（档位不足三个时与 max 重合）。
 * off 不推断：直接使用模型的关闭思考档位。零配置默认值；推断错时用户仍可逐模型显式覆盖。
 */
export function inferTierMapping(record: ModelRecord): Partial<Record<'low' | 'high' | 'max', string>> {
  const efforts = [...record.reasoningEfforts.filter(e => e.id !== 'off')]
    .sort((a, b) => {
      const ia = EFFORT_ORDER.indexOf(a.id); const ib = EFFORT_ORDER.indexOf(b.id)
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a.id.localeCompare(b.id)
    })
  const n = efforts.length
  if (!n) return {}
  return {
    low: efforts[0].id,
    high: n >= 3 ? efforts[n - 2].id : efforts[n - 1].id,
    max: efforts[n - 1].id,
  }
}

export function mapEffort(record: ModelRecord, settings: ModelSettings | undefined, tier: Tier | 'inherit' | undefined): string | undefined {
  if (!tier || tier === 'inherit' || tier === 'auto') return undefined
  if (tier === 'off') {
    const off = record.reasoningEfforts.find(e => e.id === 'off')
    if (!off) throw new Error(`${record.name} 不支持关闭思考（未公开 off 档位）`)
    return off.id
  }
  const legacy = tier === 'fast' || tier === 'balanced' || tier === 'deep' ? settings?.legacyTiers?.[tier] : undefined
  if (legacy) {
    if (!record.reasoningEfforts.some(e => e.id === legacy)) throw new Error(`${record.name} 不支持推理档位 ${legacy}`)
    return legacy
  }
  const old = tier === 'fast' ? 'low' : tier === 'balanced' || tier === 'deep' ? 'high' : tier
  const mapped = settings?.tiers?.[old]
  const inferred = inferTierMapping(record)[old]
  const effective = mapped && mapped !== 'auto' ? mapped : inferred
  if (!effective) throw new Error(`${record.name} 未配置 ${tier} 档位`)
  if (!record.reasoningEfforts.some(e => e.id === effective)) throw new Error(`${record.name} 不支持推理档位 ${effective}`)
  return effective
}

/** 兼容旧调用点：off 语义已并入 tier，这里只按 tier 解析。 */
export function mapSelectionEffort(record: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined {
  if (selection.reasoningEffort) {
    if (!record.reasoningEfforts.some(e => e.id === selection.reasoningEffort)) throw new Error(`${record.name} 不支持推理档位 ${selection.reasoningEffort}`)
    return selection.reasoningEffort
  }
  if (selection.thinking === 'off') return mapEffort(record, settings, 'off')
  return mapEffort(record, settings, selection.tier)
}

export function mergeSelection(base: Selection, overlay?: Selection): Selection {
  if (!overlay) return { ...base }
  return {
    ...base,
    ...(overlay.target !== undefined ? { target: overlay.target } : {}),
    ...(overlay.thinking && overlay.thinking !== 'inherit' ? { thinking: overlay.thinking } : {}),
    ...(overlay.tier && overlay.tier !== 'inherit' ? { tier: overlay.tier } : {}),
    ...(overlay.reasoningEffort !== undefined ? { reasoningEffort: overlay.reasoningEffort } : {}),
    ...(overlay.maxOutputTokens !== undefined ? { maxOutputTokens: overlay.maxOutputTokens } : {}),
  }
}

/** 保留旧选择值，供运行时按迁移后的逐模型映射还原真实档位。 */
function migrateTierValue(value: unknown): string | undefined {
  switch (value) {
    case 'fast':
    case 'balanced':
    case 'deep':
    case 'max':
    case 'low':
    case 'high':
    case 'off':
    case 'auto':
    case 'inherit': return value as string
    default: return undefined
  }
}

/** 把旧版档位名与新版对齐：Selection 里的 tier、旧 thinking:'off' 并入 tier，模型 tiers 映射键名同步替换。 */
function migrateSelectionTiers(selection: Selection | undefined): Selection {
  if (!selection || typeof selection !== 'object') return selection ?? {}
  const next: Selection = { ...selection }
  if (next.thinking === 'off') next.tier = 'off'
  delete next.thinking
  if (next.tier !== undefined) next.tier = migrateTierValue(next.tier) as Selection['tier']
  return next
}

function migrateModelTiers(settings: ModelSettings | undefined): ModelSettings {
  if (!settings?.tiers) return settings ?? {}
  const tiers: Partial<Record<'low' | 'high' | 'max', string>> = {}
  const legacyTiers = { ...settings.legacyTiers }
  for (const key of ['fast', 'balanced', 'deep'] as const) {
    const value = (settings.tiers as Record<string, string | undefined>)[key]
    if (value !== undefined) legacyTiers[key] = value
  }
  for (const key of ['low', 'high', 'max'] as const) {
    const value = settings.tiers[key]
    if (value !== undefined) tiers[key] = value
  }
  if (!tiers.low && legacyTiers.fast) tiers.low = legacyTiers.fast
  if (!tiers.high && legacyTiers.balanced) tiers.high = legacyTiers.balanced
  if (!tiers.max && legacyTiers.deep) tiers.max = legacyTiers.deep
  return { ...settings, tiers, ...(Object.keys(legacyTiers).length ? { legacyTiers } : {}) }
}

/** 把 v1 配置迁移成 v2：别名数组包成 AliasConfig，长上下文候选转成内置别名，丢弃 mode/manual 行；新旧档位名统一对齐（幂等）。 */
export function migrateConfig(input: unknown): ManagerConfig {
  const raw = input as { version?: number; aliases?: Record<string, ModelRef[] | AliasConfig>; models?: Record<string, ModelSettings>; official?: ManagerConfig['official']; auto?: Selection | { main?: Selection; roles?: Record<string, RoleSettings>; enabled?: boolean; evaluator?: ModelRef; simple?: Selection; normal?: Selection; complex?: Selection; preferences?: Record<string, Selection> }; roles?: Record<string, RoleSettings>; vision?: ManagerConfig['vision']; reliability?: { maxAttempts?: number; retryTransient?: boolean; parameterDowngrade?: boolean; longContextCandidates?: ModelRef[] } }
  if (![1, 2, 3].includes(raw?.version ?? 0)) throw new Error('不支持的配置版本')
  const current = raw.auto && 'main' in raw.auto ? raw.auto : undefined
  const legacyMain = current?.main ?? (raw.version === 1 ? raw.auto as Selection : undefined) ?? {}
  const legacyRoles = current?.roles ?? raw.roles ?? {}
  const aliases: Record<string, AliasConfig> = {}
  for (const [name, value] of Object.entries(raw.aliases ?? {})) {
    if (Array.isArray(value)) aliases[name] = { candidates: value }
    else if (value && Array.isArray((value as AliasConfig).candidates)) aliases[name] = value as AliasConfig
  }
  const reliability = { maxAttempts: raw.reliability?.maxAttempts ?? 3, retryTransient: raw.reliability?.retryTransient ?? true, parameterDowngrade: raw.reliability?.parameterDowngrade ?? false }
  const longContext = raw.reliability?.longContextCandidates ?? []
  if (longContext.length && !aliases[LONG_CONTEXT_ALIAS]) aliases[LONG_CONTEXT_ALIAS] = { candidates: structuredClone(longContext) }
  const models: Record<string, ModelSettings> = {}
  for (const [key, settings] of Object.entries(raw.models ?? {})) models[key] = migrateModelTiers(settings)
  const roles: Record<Role, RoleSettings> = { ...structuredClone(DEFAULT_CONFIG.auto.roles) }
  for (const role of Object.keys(roles) as Role[]) if (legacyRoles[role]) roles[role] = migrateSelectionTiers(structuredClone(legacyRoles[role])) as RoleSettings
  const preferences = current?.preferences ?? Object.fromEntries(Object.entries(roles).filter(([, value]) => value.target).map(([role, value]) => [role, value]))
  return {
    version: 3, aliases, models, official: raw.official,
    auto: { enabled: current?.enabled ?? false, evaluator: current?.evaluator,
      simple: migrateSelectionTiers(current?.simple), normal: migrateSelectionTiers(current?.normal ?? legacyMain), complex: migrateSelectionTiers(current?.complex ?? legacyMain),
      preferences: structuredClone(preferences), main: migrateSelectionTiers(legacyMain), roles },
    vision: raw.vision ?? { enabled: false, policy: 'native-first' },
    reliability,
  }
}

function isValidRef(ref: unknown): ref is ModelRef {
  return !!ref && typeof (ref as ModelRef).providerId === 'string' && typeof (ref as ModelRef).modelId === 'string' && !!(ref as ModelRef).providerId && !!(ref as ModelRef).modelId
}

export function validateConfig(config: ManagerConfig): void {
  if (config.version !== 3) throw new Error('不支持的配置版本')
  if (!Number.isInteger(config.reliability.maxAttempts) || config.reliability.maxAttempts < 1 || config.reliability.maxAttempts > 3) throw new Error('尝试次数必须为 1–3')
  for (const [name, alias] of Object.entries(config.aliases ?? {})) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || !alias || !Array.isArray(alias.candidates) || !alias.candidates.length) throw new Error(`无效别名：${name}`)
    for (const ref of alias.candidates) if (!isValidRef(ref)) throw new Error(`别名 ${name} 只能引用具体模型`)
    if (alias.efforts && Object.values(alias.efforts).some(value => typeof value !== 'string' || !value)) throw new Error(`别名 ${name} 的推理档位无效`)
    const override = alias.reliability
    if (override !== undefined && (typeof override !== 'object' || override === null)) throw new Error(`别名 ${name} 的兜底覆盖无效`)
    if (override?.maxAttempts !== undefined && (!Number.isInteger(override.maxAttempts) || override.maxAttempts < 1 || override.maxAttempts > 3)) throw new Error(`别名 ${name} 的尝试次数必须为 1–3`)
  }
  if (config.auto?.main?.target) resolveSelection(config, config.auto.main.target)
  if (config.auto.enabled) {
    if (!config.auto.evaluator || !isValidRef(config.auto.evaluator)) throw new Error('AUTO 需要配置评估模型')
    for (const grade of ['simple', 'normal', 'complex'] as const) if (!config.auto[grade].target) throw new Error(`AUTO ${grade} 档尚未绑定模型`)
  }
  for (const selection of [config.auto?.main, ...Object.values(config.auto?.roles ?? {}), config.auto.simple, config.auto.normal, config.auto.complex]) {
    if (!selection) continue
    if (selection.maxOutputTokens !== undefined && (!Number.isInteger(selection.maxOutputTokens) || selection.maxOutputTokens < 1)) throw new Error('输出上限必须为正整数')
  }
  // 角色目标在使用时校验（未绑定的别名按「角色不可用」处理，而不是拒绝整份配置）。
  if (config.vision.enabled && config.vision.target) resolveSelection(config, config.vision.target)
}

export function visionRoute(policy: VisionPolicy, nativeImage: Support, hasSidecar: boolean): 'native' | 'sidecar' | 'error' {
  if (policy === 'native-only') return nativeImage === 'yes' ? 'native' : 'error'
  if (policy === 'sidecar-only') return hasSidecar ? 'sidecar' : 'error'
  if (policy === 'sidecar-first' && hasSidecar) return 'sidecar'
  if (nativeImage === 'yes') return 'native'
  return hasSidecar ? 'sidecar' : 'error'
}

export function classifyFailure(status?: number, code?: string): 'retry' | 'cooldown' | 'auth' | 'context' | 'parameter' | 'terminal' {
  if (status === 429) return 'cooldown'
  if (status === 401 || status === 403) return 'auth'
  if (status === 400 && /context|length|token/i.test(code ?? '')) return 'context'
  if (status === 400) return 'parameter'
  if (!status || status >= 500 || status === 408) return 'retry'
  return 'terminal'
}
