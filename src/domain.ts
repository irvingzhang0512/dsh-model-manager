export type Support = 'yes' | 'no' | 'unknown'
export type Tier = 'auto' | 'fast' | 'balanced' | 'deep' | 'max'
export type VisionPolicy = 'native-first' | 'sidecar-first' | 'native-only' | 'sidecar-only'
export type Role = 'main' | 'search' | 'coding' | 'review' | 'strong' | 'vision'

export interface ModelRef { providerId: string; modelId: string }
export interface CapabilityOverride {
  image?: Support
  tools?: Support
  thinking?: Support
  contextWindow?: number
  maxOutputTokens?: number
  source?: string
}
export interface ModelSettings {
  capability?: CapabilityOverride
  tiers?: Partial<Record<Exclude<Tier, 'auto'>, string>>
}
export interface Selection {
  target?: ModelRef | string
  thinking?: 'inherit' | 'auto' | 'off'
  tier?: Tier | 'inherit'
  maxOutputTokens?: number
}
export interface RoleSettings extends Selection { enabled: boolean }
export interface ManagerConfig {
  version: 1
  aliases: Record<string, ModelRef[]>
  models: Record<string, ModelSettings>
  mode: 'manual' | 'auto'
  manual: Selection
  auto: Selection
  roles: Record<Role, RoleSettings>
  vision: { enabled: boolean; policy: VisionPolicy; target?: ModelRef | string }
  reliability: { maxAttempts: number; retryTransient: boolean; parameterDowngrade: boolean; longContextCandidates?: ModelRef[] }
}
export interface ModelRecord extends ModelRef {
  name: string
  nativeImage: Support
  nativeTools: Support
  reasoningEfforts: { id: string; name: string }[]
  contextWindow?: number
  defaultMaxTokens?: number
  source: 'host' | 'user'
  loaded: boolean
  nativeEditable?: boolean
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

export const DEFAULT_CONFIG: ManagerConfig = {
  version: 1, aliases: {}, models: {}, mode: 'manual', manual: {}, auto: {},
  roles: {
    main: { enabled: false, tier: 'balanced' },
    search: { enabled: false, target: '@fast', tier: 'fast' },
    coding: { enabled: false, target: '@coding', tier: 'balanced' },
    review: { enabled: false, target: '@strong', tier: 'deep' },
    strong: { enabled: false, target: '@strong', tier: 'deep' },
    vision: { enabled: false, target: '@vision', tier: 'auto' },
  },
  vision: { enabled: false, policy: 'native-first' },
  reliability: { maxAttempts: 3, retryTransient: true, parameterDowngrade: false, longContextCandidates: [] },
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

export function resolveSelection(config: ManagerConfig, target?: ModelRef | string): ModelRef[] {
  if (!target) return []
  if (typeof target !== 'string') return [target]
  if (!/^@[a-z][a-z0-9_-]*$/.test(target)) throw new Error(`无效别名：${target}`)
  const candidates = config.aliases[target.slice(1)]
  if (!candidates?.length) throw new Error(`别名未绑定：${target}`)
  return candidates.map(ref => ({ ...ref }))
}

export function mapEffort(record: ModelRecord, settings: ModelSettings | undefined, tier: Tier | 'inherit' | undefined): string | undefined {
  if (!tier || tier === 'inherit' || tier === 'auto') return undefined
  const mapped = settings?.tiers?.[tier]
  if (!mapped) throw new Error(`${record.name} 未配置 ${tier} 档位`)
  if (!record.reasoningEfforts.some(e => e.id === mapped)) throw new Error(`${record.name} 不支持推理档位 ${mapped}`)
  return mapped
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

export function validateConfig(config: ManagerConfig): void {
  if (config.version !== 1) throw new Error('不支持的配置版本')
  if (!['manual', 'auto'].includes(config.mode)) throw new Error('无效模式')
  if (!Number.isInteger(config.reliability.maxAttempts) || config.reliability.maxAttempts < 1 || config.reliability.maxAttempts > 3) throw new Error('尝试次数必须为 1–3')
  if (config.reliability.longContextCandidates !== undefined && (!Array.isArray(config.reliability.longContextCandidates) || config.reliability.longContextCandidates.some(ref => !ref || typeof ref.providerId !== 'string' || typeof ref.modelId !== 'string' || !ref.providerId || !ref.modelId))) throw new Error('长上下文候选只能填写具体模型')
  for (const [name, refs] of Object.entries(config.aliases)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || !Array.isArray(refs) || !refs.length) throw new Error(`无效别名：${name}`)
    for (const ref of refs) if (!ref || typeof ref.providerId !== 'string' || typeof ref.modelId !== 'string' || !ref.providerId || !ref.modelId) throw new Error(`别名 ${name} 只能引用具体模型`)
  }
  for (const selection of [config.manual, config.auto, ...Object.values(config.roles).filter(role => role.enabled)]) {
    if (selection.target) resolveSelection(config, selection.target)
    if (selection.maxOutputTokens !== undefined && (!Number.isInteger(selection.maxOutputTokens) || selection.maxOutputTokens < 1)) throw new Error('输出上限必须为正整数')
    if (selection.thinking === 'off' && selection.tier && !['inherit', 'auto'].includes(selection.tier)) throw new Error('关闭思考不能同时选择非关闭推理档位')
  }
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
