export type Support = 'yes' | 'no' | 'unknown'
export type Tier = 'auto' | 'fast' | 'balanced' | 'deep' | 'max'
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
  /** 档位映射：取值为该模型支持的实际档位 id；缺省或 'auto' 表示按模型公开档位自动推断。 */
  tiers?: Partial<Record<Exclude<Tier, 'auto'>, string>>
}
export interface Selection {
  target?: ModelRef | string
  thinking?: 'inherit' | 'auto' | 'off'
  tier?: Tier | 'inherit'
  maxOutputTokens?: number
}
/** 子 Agent 角色绑定：是否可委派由「角色是否绑定了有效模型」决定，这里只负责绑模型与推理参数。 */
export interface RoleSettings extends Selection { }
/** 别名级兜底覆盖：未填写的字段使用全局默认兜底策略。 */
export interface AliasReliability { maxAttempts?: number; retryTransient?: boolean; parameterDowngrade?: boolean }
/** 别名 = 一串按顺序兜底的具体模型候选 + 可选的兜底策略覆盖。 */
export interface AliasConfig { candidates: ModelRef[]; reliability?: AliasReliability }
export interface ManagerConfig {
  version: 2
  aliases: Record<string, AliasConfig>
  models: Record<string, ModelSettings>
  /** AUTO（托管）配置：主 Agent 目标与子 Agent 角色分工。非 AUTO 的选择就是固定模型，无需配置。 */
  auto: { main: Selection; roles: Record<Role, RoleSettings> }
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
  version: 2, aliases: {}, models: {},
  auto: {
    main: {},
    roles: {
      search: { tier: 'fast' },
      coding: { tier: 'balanced' },
      review: { tier: 'deep' },
      strong: { tier: 'deep' },
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
 * 按模型公开的实际档位推断 fast/balanced/deep/max 的默认映射：
 * fast → 最弱档、max → 最强档、deep → 次强档、balanced → 中间档。
 * 只能作为零配置默认值；推断错时用户仍可逐模型显式覆盖。
 */
export function inferTierMapping(record: ModelRecord): Partial<Record<Exclude<Tier, 'auto'>, string>> {
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
    fast: efforts[0].id,
    balanced: efforts[Math.floor((n - 1) / 2)].id,
    deep: n >= 3 ? efforts[n - 2].id : efforts[n - 1].id,
    max: efforts[n - 1].id,
  }
}

export function mapEffort(record: ModelRecord, settings: ModelSettings | undefined, tier: Tier | 'inherit' | undefined): string | undefined {
  if (!tier || tier === 'inherit' || tier === 'auto') return undefined
  const mapped = settings?.tiers?.[tier]
  const inferred = inferTierMapping(record)[tier]
  const effective = mapped && mapped !== 'auto' ? mapped : inferred
  if (!effective) throw new Error(`${record.name} 未配置 ${tier} 档位`)
  if (!record.reasoningEfforts.some(e => e.id === effective)) throw new Error(`${record.name} 不支持推理档位 ${effective}`)
  return effective
}

export function mapSelectionEffort(record: ModelRecord, settings: ModelSettings | undefined, selection: Selection): string | undefined {
  if (selection.thinking === 'off') {
    if (selection.tier && !['inherit', 'auto'].includes(selection.tier)) throw new Error('关闭思考不能同时选择非关闭推理档位')
    const off = record.reasoningEfforts.find(e => e.id === 'off')
    if (!off) throw new Error(`${record.name} 未公开关闭思考档位`)
    return off.id
  }
  return mapEffort(record, settings, selection.tier)
}

export function mergeSelection(base: Selection, overlay?: Selection): Selection {
  if (!overlay) return { ...base }
  return {
    ...base,
    ...(overlay.target !== undefined ? { target: overlay.target } : {}),
    ...(overlay.thinking && overlay.thinking !== 'inherit' ? { thinking: overlay.thinking } : {}),
    ...(overlay.tier && overlay.tier !== 'inherit' ? { tier: overlay.tier } : {}),
    ...(overlay.maxOutputTokens !== undefined ? { maxOutputTokens: overlay.maxOutputTokens } : {}),
  }
}

/** 把 v1 配置迁移成 v2：别名数组包成 AliasConfig，长上下文候选转成内置别名，丢弃 mode/manual 行。 */
export function migrateConfig(input: unknown): ManagerConfig {
  const raw = input as { version?: number; aliases?: Record<string, ModelRef[] | AliasConfig>; models?: Record<string, ModelSettings>; mode?: unknown; manual?: Selection; auto?: Selection; roles?: Record<string, RoleSettings>; vision?: ManagerConfig['vision']; reliability?: { maxAttempts?: number; retryTransient?: boolean; parameterDowngrade?: boolean; longContextCandidates?: ModelRef[] } }
  if (raw?.version === 2) return raw as unknown as ManagerConfig
  if (raw?.version !== 1) throw new Error('不支持的配置版本')
  const aliases: Record<string, AliasConfig> = {}
  for (const [name, value] of Object.entries(raw.aliases ?? {})) {
    if (Array.isArray(value)) aliases[name] = { candidates: value }
    else if (value && Array.isArray((value as AliasConfig).candidates)) aliases[name] = value as AliasConfig
  }
  const reliability = { maxAttempts: raw.reliability?.maxAttempts ?? 3, retryTransient: raw.reliability?.retryTransient ?? true, parameterDowngrade: raw.reliability?.parameterDowngrade ?? false }
  const longContext = raw.reliability?.longContextCandidates ?? []
  if (longContext.length && !aliases[LONG_CONTEXT_ALIAS]) aliases[LONG_CONTEXT_ALIAS] = { candidates: structuredClone(longContext) }
  const roles: Record<Role, RoleSettings> = { ...structuredClone(DEFAULT_CONFIG.auto.roles) }
  for (const role of Object.keys(roles) as Role[]) if (raw.roles?.[role]) roles[role] = structuredClone(raw.roles[role])
  return {
    version: 2, aliases, models: raw.models ?? {},
    auto: { main: raw.auto ?? {}, roles },
    vision: raw.vision ?? { enabled: false, policy: 'native-first' },
    reliability,
  }
}

function isValidRef(ref: unknown): ref is ModelRef {
  return !!ref && typeof (ref as ModelRef).providerId === 'string' && typeof (ref as ModelRef).modelId === 'string' && !!(ref as ModelRef).providerId && !!(ref as ModelRef).modelId
}

export function validateConfig(config: ManagerConfig): void {
  if (config.version !== 2) throw new Error('不支持的配置版本')
  if (!Number.isInteger(config.reliability.maxAttempts) || config.reliability.maxAttempts < 1 || config.reliability.maxAttempts > 3) throw new Error('尝试次数必须为 1–3')
  for (const [name, alias] of Object.entries(config.aliases ?? {})) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || !alias || !Array.isArray(alias.candidates) || !alias.candidates.length) throw new Error(`无效别名：${name}`)
    for (const ref of alias.candidates) if (!isValidRef(ref)) throw new Error(`别名 ${name} 只能引用具体模型`)
    const override = alias.reliability
    if (override !== undefined && (typeof override !== 'object' || override === null)) throw new Error(`别名 ${name} 的兜底覆盖无效`)
    if (override?.maxAttempts !== undefined && (!Number.isInteger(override.maxAttempts) || override.maxAttempts < 1 || override.maxAttempts > 3)) throw new Error(`别名 ${name} 的尝试次数必须为 1–3`)
  }
  if (config.auto?.main?.target) resolveSelection(config, config.auto.main.target)
  for (const selection of [config.auto?.main, ...Object.values(config.auto?.roles ?? {})]) {
    if (!selection) continue
    if (selection.maxOutputTokens !== undefined && (!Number.isInteger(selection.maxOutputTokens) || selection.maxOutputTokens < 1)) throw new Error('输出上限必须为正整数')
    if (selection.thinking === 'off' && selection.tier && !['inherit', 'auto'].includes(selection.tier)) throw new Error('关闭思考不能同时选择非关闭推理档位')
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
