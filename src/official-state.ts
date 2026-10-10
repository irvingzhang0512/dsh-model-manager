import { modelKey, type ManagerConfig, type ModelRef, type Selection } from './domain.js'
import { OFFICIAL_PROVIDER, type OfficialAnalysis, type OfficialDiff, type OfficialModel } from './official-types.js'

export type FutureOverrides = Record<string, { session?: Selection; nextTurn?: Selection }>
export type HostModel = { id: string; name?: string; contextWindow?: number; inputModalities?: string[]; [key: string]: unknown }
export interface OfficialState {
  models: HostModel[]; config: ManagerConfig; defaultModel?: Record<string, unknown>
  subagents?: { allowedModels?: { provider: string; model: string; [key: string]: unknown }[]; [key: string]: unknown }
  overrides: FutureOverrides
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function merge(a: unknown, b: unknown, path: string, conflicts: string[]): unknown {
  if (a === undefined) return structuredClone(b)
  if (b === undefined || same(a, b)) return structuredClone(a)
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>
    return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map(key => [key, merge(left[key], right[key], `${path}.${key}`, conflicts)]))
  }
  conflicts.push(`配置冲突：${path}`); return structuredClone(a)
}
function dedupe<T extends object>(items: T[], key: (item: T) => string, path: string, conflicts: string[]): T[] {
  const positions = new Map<string, number>(), result: T[] = []
  for (const item of items) {
    const id = key(item), position = positions.get(id)
    if (position === undefined) { positions.set(id, result.length); result.push(item) }
    else result[position] = merge(result[position], item, `${path}[${position}]`, conflicts) as T
  }
  return result
}
function traverseRefs(state: OfficialState, visit: (ref: ModelRef, path: string) => void): void {
  const selection = (value: Selection | undefined, path: string) => { if (value?.target && typeof value.target !== 'string') visit(value.target, `${path}.target`) }
  for (const [name, alias] of Object.entries(state.config.aliases)) alias.candidates.forEach((ref, index) => visit(ref, `aliases.${name}.candidates[${index}]`))
  if (state.config.auto.evaluator) visit(state.config.auto.evaluator, 'auto.evaluator')
  if (state.config.official?.analyzer) visit(state.config.official.analyzer, 'official.analyzer')
  for (const field of ['main', 'simple', 'normal', 'complex'] as const) selection(state.config.auto[field], `auto.${field}`)
  for (const [key, value] of Object.entries(state.config.auto.roles)) selection(value, `auto.roles.${key}`)
  if (state.config.vision.target && typeof state.config.vision.target !== 'string') visit(state.config.vision.target, 'vision.target')
  for (const [session, value] of Object.entries(state.overrides)) {
    selection(value.session, `overrides.${session}.session`); selection(value.nextTurn, `overrides.${session}.nextTurn`)
  }
}
export function officialReferences(state: OfficialState, id: string): string[] {
  const paths: string[] = [], key = modelKey({ providerId: OFFICIAL_PROVIDER, modelId: id })
  traverseRefs(state, (ref, path) => { if (ref.providerId === OFFICIAL_PROVIDER && ref.modelId === id) paths.push(path) })
  if (Object.hasOwn(state.config.models, key)) paths.push(`models.${key}`)
  for (const [name, alias] of Object.entries(state.config.aliases)) if (Object.hasOwn(alias.efforts ?? {}, key)) paths.push(`aliases.${name}.efforts.${key}`)
  if (state.defaultModel?.provider === OFFICIAL_PROVIDER && state.defaultModel.model === id) paths.push('agent-default-model.model')
  state.subagents?.allowedModels?.forEach((ref, index) => { if (ref.provider === OFFICIAL_PROVIDER && ref.model === id) paths.push(`subagent-model-selection.allowedModels[${index}]`) })
  return paths
}
function declarations(official: OfficialModel): Record<string, unknown> {
  return { ...(official.name !== undefined ? { name: official.name } : {}), ...(official.image !== undefined ? { inputModalities: official.image ? ['text', 'image'] : ['text'] } : {}), ...(official.contextWindow !== undefined ? { contextWindow: official.contextWindow } : {}) }
}
function migrate(state: OfficialState, oldIds: string[], target: OfficialModel): string[] {
  const conflicts: string[] = [], old = new Set(oldIds)
  const existing = state.models.find(model => model.id === target.id)
  let merged: HostModel = existing ? structuredClone(existing) : { id: target.id }
  const declared = declarations(target)
  for (const id of oldIds) {
    const model = state.models.find(model => model.id === id)
    if (model) {
      const source: Record<string, unknown> = { ...model }, dest: Record<string, unknown> = { ...merged }
      delete source.id; delete dest.id
      // ID、展示名和官方明确声明是本操作的预览字段；其他设置只能无冲突合并。
      delete source.name; delete dest.name
      for (const field of Object.keys(declared)) { delete source[field]; delete dest[field] }
      merged = { ...(merge(dest, source, `llm-deepseek.models.${target.id}`, conflicts) as Record<string, unknown>), id: target.id, ...(merged.name ? { name: merged.name } : {}) }
    }
  }
  merged = { ...merged, ...declared, id: target.id }
  const position = state.models.findIndex(model => model.id === target.id || old.has(model.id))
  state.models = state.models.filter(model => model.id !== target.id && !old.has(model.id))
  state.models.splice(position < 0 ? state.models.length : Math.min(position, state.models.length), 0, merged)
  traverseRefs(state, ref => { if (ref.providerId === OFFICIAL_PROVIDER && old.has(ref.modelId)) ref.modelId = target.id })
  if (state.defaultModel?.provider === OFFICIAL_PROVIDER && old.has(String(state.defaultModel.model))) state.defaultModel.model = target.id
  if (state.subagents?.allowedModels) {
    for (const ref of state.subagents.allowedModels) if (ref.provider === OFFICIAL_PROVIDER && old.has(ref.model)) ref.model = target.id
    state.subagents.allowedModels = dedupe(state.subagents.allowedModels, ref => JSON.stringify([ref.provider, ref.model]), 'subagent-model-selection.allowedModels', conflicts)
  }
  const newKey = modelKey({ providerId: OFFICIAL_PROVIDER, modelId: target.id })
  const moveKeys = (record: Record<string, unknown>, path: string) => {
    for (const id of oldIds) {
      const oldKey = modelKey({ providerId: OFFICIAL_PROVIDER, modelId: id })
      if (!Object.hasOwn(record, oldKey)) continue
      Object.defineProperty(record, newKey, { value: merge(record[newKey], record[oldKey], `${path}.${newKey}`, conflicts), enumerable: true, configurable: true, writable: true })
      delete record[oldKey]
    }
  }
  moveKeys(state.config.models, 'models')
  for (const [name, alias] of Object.entries(state.config.aliases)) {
    if (alias.efforts) moveKeys(alias.efforts, `aliases.${name}.efforts`)
    alias.candidates = dedupe(alias.candidates, modelKey, `aliases.${name}.candidates`, conflicts)
  }
  return conflicts
}
export function officialDiffs(state: OfficialState, analysis: OfficialAnalysis): OfficialDiff[] {
  const diffs: OfficialDiff[] = [], handled = new Set<string>()
  const add = (diff: Omit<OfficialDiff, 'id'>) => diffs.push({ ...diff, id: JSON.stringify([diff.modelId, diff.field]) })
  for (const model of analysis.models) {
    const oldIds = analysis.replacements.filter(ref => ref.newId === model.id && (state.models.some(item => item.id === ref.oldId) || officialReferences(state, ref.oldId).length)).map(ref => ref.oldId)
    if (oldIds.length) {
      oldIds.forEach(id => handled.add(id)); handled.add(model.id)
      const refs = oldIds.flatMap(id => officialReferences(state, id))
      const probe = structuredClone(state), conflicts = migrate(probe, oldIds, model)
      add({ modelId: model.id, field: 'migrateModel', before: oldIds, after: { oldIds, target: model }, evidence: analysis.replacements.filter(ref => oldIds.includes(ref.oldId)).flatMap(ref => ref.evidence), reason: '官方明确替代：合并目标模型、迁移全部配置引用并移除旧入口', references: refs, blockedReasons: conflicts })
      continue
    }
    const current = state.models.find(item => item.id === model.id)
    if (!current) { add({ modelId: model.id, field: 'addModel', before: null, after: model, evidence: model.evidence, reason: '当前官方清单中的新增模型', references: [], blockedReasons: [] }); continue }
    for (const [field, after] of Object.entries(declarations(model))) {
      if (!same(current[field], after)) add({ modelId: model.id, field: field as OfficialDiff['field'], before: current[field] ?? null, after, evidence: model.propertyEvidence?.[field === 'inputModalities' ? 'image' : field as 'name' | 'contextWindow'] ?? model.evidence, reason: '有原文证据的官方模型声明变化', references: [], blockedReasons: [] })
    }
  }
  for (const current of state.models) {
    if (handled.has(current.id) || analysis.models.some(item => item.id === current.id)) continue
    const references = officialReferences(state, current.id)
    add({ modelId: current.id, field: 'removeModel', before: current, after: null, evidence: analysis.completenessEvidence, reason: '当前完整清单未列出此模型，且没有明确替代关系', references, blockedReasons: references.map(path => `仍被引用：${path}`) })
  }
  return diffs
}
export function applyOfficialDiffs(state: OfficialState, diffs: OfficialDiff[]): OfficialState {
  const next = structuredClone(state)
  for (const diff of diffs) {
    if (diff.blockedReasons.length) throw new Error(diff.blockedReasons.join('；'))
    if (diff.field === 'migrateModel') {
      const { oldIds, target } = diff.after as { oldIds: string[]; target: OfficialModel }
      const conflicts = migrate(next, oldIds, target)
      if (conflicts.length) throw new Error(conflicts.join('；'))
    } else if (diff.field === 'addModel') {
      if (next.models.some(model => model.id === diff.modelId)) throw new Error('模型清单已变化')
      next.models.push({ id: diff.modelId, ...declarations(diff.after as OfficialModel) })
    } else if (diff.field === 'removeModel') {
      if (officialReferences(next, diff.modelId).length) throw new Error('移除模型仍有引用')
      next.models = next.models.filter(model => model.id !== diff.modelId)
    } else {
      const model = next.models.find(model => model.id === diff.modelId)
      if (!model) throw new Error('模型清单已变化')
      ;(model as Record<string, unknown>)[diff.field] = structuredClone(diff.after)
    }
  }
  return next
}
