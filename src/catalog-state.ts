import { fromManagedId, managedId, mapSelectionEffort, modelKey, resolveSelection, validateConfig, type ModelRef, type Selection } from './domain.js'
import { canonical, officialReferences, type HostModel } from './official-state.js'
import { OFFICIAL_PROVIDER, type OfficialAnalysis, type OfficialDiff } from './official-types.js'
import type { CatalogChoice, CatalogDiff, CatalogIntent, ModelCatalogIntent, CatalogOperation, CatalogProfile, CatalogReference, CatalogResolution, CatalogState } from './catalog-types.js'
import { planAliasRemoval } from './alias-removal.js'
import { validateParameterModel, object } from './model-parameters.js'

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const isRef = (value: unknown): value is ModelRef => !!value && typeof (value as ModelRef).providerId === 'string' && typeof (value as ModelRef).modelId === 'string'
const validText = (value: unknown) => typeof value === 'string' && !!value && value === value.trim()
export function manualIntents(input: unknown, state: CatalogState): CatalogIntent[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('请输入 1–100 项目录操作')
  const seen = new Set<string>()
  return input.map((item: CatalogOperation) => {
    if (item?.kind === 'clearLegacyImageOverrides') {
      if (input.length !== 1 || Object.keys(item).some(key => key !== 'kind')) throw new Error('旧图片声明清理须单独提交')
      if (!state.legacyImages?.length) throw new Error('无需清理旧图片声明')
      return { id: 'clearLegacyImageOverrides', kind: item.kind, path: 'models.*.capability.image' }
    }
    if (item?.kind === 'clearLegacyPreferences') {
      if (input.length !== 1 || Object.keys(item).some(key => key !== 'kind')) throw new Error('旧分工偏好清理须单独提交且不能包含其他字段')
      if (!Object.hasOwn(state.config.auto, 'preferences')) throw new Error('无需清理旧分工偏好')
      return { id: 'clearLegacyPreferences', kind: item.kind, path: 'auto.preferences' }
    }
    if (item?.kind === 'removeAlias') {
      if (typeof item.name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(item.name) || !Object.hasOwn(state.config.aliases, item.name) || Object.keys(item).some(key => !['kind', 'name'].includes(key))) throw new Error('别名删除操作无效或别名不存在')
      const model = { providerId: 'dsh-model-manager', modelId: `alias:${item.name}` }, key = modelKey(model)
      if (seen.has(key)) throw new Error('同一别名不能重复提交操作')
      seen.add(key)
      return { id: JSON.stringify(['removeAlias', item.name]), kind: item.kind, model }
    }
    if (!item || !['add', 'rename', 'remove'].includes(item.kind) || !isRef(item.model) || !validText(item.model.providerId) || !validText(item.model.modelId)) throw new Error('目录操作或 API ID 无效')
    const key = modelKey(item.model)
    if (seen.has(key)) throw new Error('同一模型不能重复提交操作')
    seen.add(key)
    const profile = state.profiles.find(p => p.providerId === item.model.providerId)
    if (!profile) throw new Error('该 Provider 未公开可写目录契约')
    const existing = profile.models.find(m => m.id === item.model.modelId)
    if (item.kind === 'add' && existing) throw Object.assign(new Error('API ID 已存在，请编辑已有模型'), { existingModel: item.model })
    if (item.kind !== 'add' && !existing) throw new Error('模型目录已变化，请重新预览')
    if ('name' in item && !validText(item.name) || item.kind === 'rename' && !validText(item.name)) throw new Error('显示名称须非空且无首尾空白')
    for (const key of ['contextWindow', 'maxTokens'] as const) if (key in item && (!Number.isSafeInteger((item as any)[key]) || (item as any)[key] <= 0)) throw new Error(`${key} 须为正整数`)
    if ('image' in item && typeof item.image !== 'boolean') throw new Error('图片能力无效')
    const allowed = item.kind === 'add' ? ['kind', 'model', 'name', 'image', 'contextWindow', 'maxTokens'] : item.kind === 'rename' ? ['kind', 'model', 'name'] : ['kind', 'model']
    if (Object.keys(item).some(key => !allowed.includes(key))) throw new Error('目录操作包含未知字段')
    const value: HostModel = { id: item.model.modelId }
    if ('name' in item) value.name = item.name
    if (item.kind === 'add') {
      if (item.image !== undefined) value[profile.ns === 'llm-deepseek' ? 'inputModalities' : 'input'] = item.image ? ['text', 'image'] : ['text']
      if (item.contextWindow !== undefined) value.contextWindow = item.contextWindow
      if (item.maxTokens !== undefined) value.maxTokens = item.maxTokens
    }
    return { id: JSON.stringify([item.kind, item.model.providerId, item.model.modelId]), kind: item.kind, model: item.model, value }
  })
}

function visitRefs(state: CatalogState, callback: (ref: ModelRef, path: string, selection?: Selection) => void): void {
  const visit = (ref: ModelRef, path: string, selection?: Selection) => {
    if (ref.providerId !== 'dsh-model-manager') { callback(ref, path, selection); return }
    // 宿主默认及子 Agent 范围可能保存受管理具体入口；AUTO / 别名的逻辑 ID 保持不变。
    let real: ModelRef
    try { real = fromManagedId(ref.modelId) } catch { return }
    const original = modelKey(real); callback(real, path, selection)
    if (modelKey(real) !== original) ref.modelId = managedId(real)
  }
  const selection = (value: Selection | undefined, path: string) => { if (isRef(value?.target)) visit(value.target, `${path}.target`, value) }
  for (const [name, alias] of Object.entries(state.config.aliases)) alias.candidates.forEach((ref, index) => visit(ref, `aliases.${name}.candidates[${index}]`))
  if (state.config.auto.evaluator) visit(state.config.auto.evaluator, 'auto.evaluator')
  if (state.config.official?.analyzer) visit(state.config.official.analyzer, 'official.analyzer')
  for (const field of ['main', 'simple', 'normal', 'complex'] as const) selection(state.config.auto[field], `auto.${field}`)
  for (const [key, value] of Object.entries(state.config.auto.roles)) selection(value, `auto.roles.${key}`)
  if (isRef(state.config.vision.target)) visit(state.config.vision.target, 'vision.target')
  for (const [id, override] of Object.entries(state.overrides)) { selection(override.session, `overrides.${id}.session`); selection(override.nextTurn, `overrides.${id}.nextTurn`) }
  if (state.defaultModel && typeof state.defaultModel.provider === 'string' && typeof state.defaultModel.model === 'string') {
    const ref = { providerId: state.defaultModel.provider, modelId: state.defaultModel.model }; visit(ref, 'agent-default-model.model')
    state.defaultModel.provider = ref.providerId; state.defaultModel.model = ref.modelId
  }
  state.subagents?.allowedModels?.forEach((item, index) => {
    const ref = { providerId: item.provider, modelId: item.model }; visit(ref, `subagent-model-selection.allowedModels[${index}]`)
    item.provider = ref.providerId; item.model = ref.modelId
  })
}
function visualSelections(state: CatalogState): { value?: ModelRef | string; path: string; clear: () => void; replace: (ref: ModelRef) => void }[] {
  return [
    { get value() { return state.config.vision.target }, path: 'vision.target', clear: () => { delete state.config.vision.target }, replace: ref => { state.config.vision.target = structuredClone(ref) } },
    { get value() { return state.config.auto.roles.vision.target }, path: 'auto.roles.vision.target', clear: () => { delete state.config.auto.roles.vision.target }, replace: ref => { state.config.auto.roles.vision.target = structuredClone(ref) } },
  ]
}
function visualRefs(state: CatalogState, value?: ModelRef | string): ModelRef[] {
  if (!value) return []
  try { return resolveSelection(state.config, value).flatMap(ref => {
    if (ref.providerId !== 'dsh-model-manager') return [ref]
    try { return [fromManagedId(ref.modelId)] } catch { return [] }
  }) } catch { return [] }
}
function selections(state: CatalogState): { value: Selection; path: string }[] {
  return [
    ...(['main', 'simple', 'normal', 'complex'] as const).map(key => ({ value: state.config.auto[key], path: `auto.${key}` })),
    ...Object.entries(state.config.auto.roles).map(([key, value]) => ({ value, path: `auto.roles.${key}` })),
    ...Object.entries(state.overrides).flatMap(([key, value]) => ['session', 'nextTurn'].flatMap(field => (value as any)[field] ? [{ value: (value as any)[field] as Selection, path: `overrides.${key}.${field}` }] : [])),
  ]
}
export function catalogReferences(state: CatalogState, models: ModelRef[]): CatalogReference[] {
  const keys = new Set(models.map(modelKey)), result: CatalogReference[] = []
  visitRefs(structuredClone(state), (ref, path) => { if (keys.has(modelKey(ref))) result.push({ path, type: 'usage' }) })
  for (const visual of visualSelections(state)) if (typeof visual.value === 'string') {
    visualRefs(state, visual.value).forEach((ref, index) => { if (keys.has(modelKey(ref))) result.push({ path: visual.path, type: 'usage', chain: [visual.value as string, `aliases.${(visual.value as string).slice(1)}.candidates[${index}]`, modelKey(ref)] }) })
  }
  for (const ref of models) {
    const key = modelKey(ref)
    if (Object.hasOwn(state.config.models, key)) result.push({ path: `models.${key}`, type: 'attached' })
    for (const [name, alias] of Object.entries(state.config.aliases)) if (Object.hasOwn(alias.efforts ?? {}, key)) result.push({ path: `aliases.${name}.efforts.${key}`, type: 'attached' })
  }
  return result
}
export function officialIntents(state: CatalogState, analysis: OfficialAnalysis): ModelCatalogIntent[] {
  const result: ModelCatalogIntent[] = [], handled = new Set<string>(), profile = state.profiles.find(p => p.providerId === OFFICIAL_PROVIDER)
  if (!profile) throw new Error('DSH 未加载可写 DeepSeek 官方目录')
  const add = (modelId: string, field: OfficialDiff['field'], value: HostModel | undefined, oldIds: string[] = [], evidence = analysis.completenessEvidence) => {
    const current = profile.models.find(m => m.id === modelId)
    const model = { providerId: OFFICIAL_PROVIDER, modelId }
    const protectedName = current?.name !== undefined && (profile.userFields === undefined || profile.userFields[modelId]?.includes('name')) && (state.config.catalogMetadata?.[modelKey(model)]?.origin !== 'official' || state.config.catalogMetadata?.[modelKey(model)]?.customName)
    const protectedOldName = oldIds.some(id => {
      const old = profile.models.find(m => m.id === id), metadata = state.config.catalogMetadata?.[modelKey({ providerId: model.providerId, modelId: id })]
      return old?.name !== undefined && (profile.userFields === undefined || profile.userFields[id]?.includes('name')) && (metadata?.origin !== 'official' || metadata.customName)
    })
    if (value && field !== 'name' && (protectedName || protectedOldName)) delete value.name
    result.push({ id: JSON.stringify([modelId, field]), kind: field === 'migrateModel' ? 'migrate' : field === 'addModel' ? 'add' : field === 'removeModel' ? 'remove' : 'update', model, value, oldIds, evidence, protectedName,
      officialDiff: { id: JSON.stringify([modelId, field]), modelId, field, before: field === 'migrateModel' ? oldIds : field === 'addModel' ? null : field === 'removeModel' ? current : current?.[field], after: field === 'migrateModel' ? { oldIds, target: analysis.models.find(m => m.id === modelId) } : field === 'removeModel' ? null : field === 'addModel' ? analysis.models.find(m => m.id === modelId) : value?.[field], reason: field === 'migrateModel' ? '官方明确替代：整体合并并迁移引用' : field === 'removeModel' ? '本次当前完整清单未列出，需手动核对移除' : '有原文依据的官方声明', evidence, references: [], blockedReasons: [] } })
  }
  for (const official of analysis.models) {
    const oldIds = [...new Set(analysis.replacements.filter(r => r.newId === official.id && (profile.models.some(m => m.id === r.oldId) || officialReferences(state, r.oldId).length)).map(r => r.oldId))]
    const value: HostModel = { id: official.id, ...(official.name !== undefined ? { name: official.name } : {}), ...(official.contextWindow !== undefined ? { contextWindow: official.contextWindow } : {}), ...(official.image !== undefined ? { inputModalities: official.image ? ['text', 'image'] : ['text'] } : {}) }
    handled.add(official.id)
    if (oldIds.length) { oldIds.forEach(id => handled.add(id)); add(official.id, 'migrateModel', value, oldIds, analysis.replacements.filter(r => oldIds.includes(r.oldId)).flatMap(r => r.evidence)); continue }
    const current = profile.models.find(m => m.id === official.id)
    if (!current) { add(official.id, 'addModel', value, [], official.evidence); continue }
    for (const field of ['name', 'contextWindow', 'inputModalities'] as const) if (value[field] !== undefined && !same(current[field], value[field])) add(official.id, field, { id: official.id, [field]: value[field] }, [], official.propertyEvidence?.[field === 'inputModalities' ? 'image' : field] ?? official.evidence)
  }
  for (const model of profile.models) if (!handled.has(model.id)) add(model.id, 'removeModel', undefined)
  return result
}

export function planCatalog(before: CatalogState, intents: CatalogIntent[], resolutions: CatalogResolution[] = [], selected?: string[]): { operations: CatalogDiff[]; after: CatalogState } {
  const baselineChoices = resolutions.length ? planCatalog(before, intents, [], selected).operations.flatMap(o => o.choices) : []
  const state = structuredClone(before), operations: CatalogDiff[] = [], decisions = new Map(resolutions.map(r => [r.id, r.optionId]))
  if (decisions.size !== resolutions.length) throw new Error('处理选项不能重复')
  const offered = new Map<string, Set<string>>()
  const choice = (diff: CatalogDiff, suffix: string, kind: CatalogChoice['kind'], path: string, options: CatalogChoice['options']) => {
    const id = JSON.stringify([diff.id, suffix]), resolution = decisions.get(id)
    offered.set(id, new Set(options.map(o => o.optionId)))
    const item: CatalogChoice = { id, kind, path, options, ...(resolution ? { resolution } : {}) }
    diff.choices.push(item); if (kind === 'conflict') diff.conflicts.push(item)
    return options.find(o => o.optionId === resolution)
  }
  const merge = (a: unknown, b: unknown, path: string, diff: CatalogDiff): unknown => {
    if (a === undefined) return structuredClone(b)
    if (b === undefined || same(a, b)) return structuredClone(a)
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => [key, merge((a as any)[key], (b as any)[key], `${path}.${key}`, diff)]))
    const picked = choice(diff, `conflict:${path}:${canonical(b)}`, 'conflict', path, [{ optionId: 'target', label: `保留目标值：${canonical(a)}`, value: a, source: 'user / target' }, { optionId: 'old', label: `采用旧值：${canonical(b)}`, value: b, source: 'user / old' }])
    if (!picked) diff.blockedReasons.push(`请解决配置冲突：${path}`)
    return structuredClone(picked ? picked.value : a)
  }
  const officialFields = (target: HostModel, intent: ModelCatalogIntent, diff: CatalogDiff, userFields: Set<string>) => {
    for (const [field, value] of Object.entries(intent.value ?? {})) {
      if (field !== 'id' && target[field] !== undefined && !same(target[field], value) && (userFields.has(field) || field === 'name' && intent.protectedName)) {
        const picked = choice(diff, `official-field:${field}`, 'conflict', `${intent.model.modelId}.${field}`, [{ optionId: 'local', label: `保留本地值：${canonical(target[field])}`, value: target[field], source: 'user' }, { optionId: 'official', label: `采用官方值：${canonical(value)}`, value, source: 'official' }])
        if (!picked) diff.blockedReasons.push(`请确认本地与官方字段冲突：${field}`)
        else target[field] = structuredClone(picked.value)
      } else target[field] = structuredClone(value)
    }
  }
  for (const intent of intents) {
    if (intent.kind === 'clearLegacyImageOverrides') {
      if (intents.length !== 1) throw new Error('旧图片声明清理须单独提交')
      operations.push({ id: intent.id, kind: intent.kind, path: intent.path, before: structuredClone(state.legacyImages), after: null, references: [], attachedSettings: [], conflicts: [], choices: [], blockedReasons: [] })
      if (!selected || selected.includes(intent.id)) state.legacyImages = []
      continue
    }
    if (intent.kind === 'clearLegacyPreferences') {
      if (intents.length !== 1) throw new Error('旧分工偏好清理须单独提交')
      const diff: CatalogDiff = { id: intent.id, kind: intent.kind, path: intent.path, before: structuredClone(state.config.auto.preferences), after: null, references: [], attachedSettings: [], conflicts: [], choices: [], blockedReasons: [] }
      operations.push(diff)
      if (!selected || selected.includes(diff.id)) delete state.config.auto.preferences
      continue
    }
    if (intent.kind === 'removeAlias') {
      const { diff, working } = planAliasRemoval(state, intent, intents, choice)
      operations.push(diff)
      if (!diff.blockedReasons.length && (!selected || selected.includes(diff.id))) Object.assign(state, working)
      continue
    }
    const profile = state.profiles.find(p => p.providerId === intent.model.providerId)
    if (!profile) throw new Error('目录不可编辑')
    const current = profile.models.find(m => m.id === intent.model.modelId)
    const diff: CatalogDiff = { id: intent.id, kind: intent.kind, model: intent.model, before: structuredClone(current ?? null), after: null, references: [], attachedSettings: [], conflicts: [], choices: [], blockedReasons: [], evidence: intent.evidence }
    operations.push(diff)
    const working = structuredClone(state)
    const p = working.profiles.find(p => p.providerId === intent.model.providerId)!
    const key = modelKey(intent.model)
    if (intent.kind === 'add') {
      if (p.addConstraints) {
        const missing = [...p.addConstraints.missing]
        if (p.addConstraints.declared) for (const field of ['contextWindow', 'maxTokens'] as const) {
          const value = intent.value?.[field] ?? p.addConstraints[field === 'contextWindow' ? 'defaultContextWindow' : 'defaultMaxTokens']
          if (!Number.isSafeInteger(value) || (value as number) <= 0) missing.push(field)
        }
        if (missing.length) diff.blockedReasons.push(`Provider 无法提供新型号的必要设置：${missing.join('、')}`)
      }
      if (current) diff.blockedReasons.push('API ID 已存在')
      else { p.models.push(structuredClone(intent.value!)); working.config.catalogMetadata ??= {}; working.config.catalogMetadata[key] = { origin: intent.officialDiff ? 'official' : 'manual', ...(intent.value?.name && !intent.officialDiff ? { customName: true } : {}) } }
    } else if (intent.kind === 'rename' || intent.kind === 'update') {
      if (!current) diff.blockedReasons.push('模型目录已变化')
      else {
        const target = p.models.find(m => m.id === intent.model.modelId)!
        if (intent.officialDiff) officialFields(target, intent, diff, new Set(p.userFields?.[target.id] ?? Object.keys(target)))
        else {
          const compat = intent.parameter && object(intent.value?.compat) ? { ...(object(target.compat) ? target.compat : {}), ...intent.value.compat } : undefined
          Object.assign(target, intent.value)
          if (compat) target.compat = compat
        }
        if (intent.kind === 'rename' || intent.value?.name !== undefined && same(target.name, intent.value.name)) { working.config.catalogMetadata ??= {}; working.config.catalogMetadata[key] = { ...working.config.catalogMetadata[key], customName: intent.kind === 'rename' || intent.parameterNameBasis === 'knowledge' } }
        if (intent.parameter) {
          const record = working.records.find(r => modelKey(r) === key)!
          const defaults: Record<string, unknown> = working.parameterModels?.[key] ?? {}
          const effective = { ...defaults, ...target, contextWindow: target.contextWindow ?? record.contextWindow, maxTokens: target.maxTokens ?? record.defaultMaxTokens, compat: { ...(object(p.effective?.compat) ? p.effective.compat : {}), ...(object(defaults.compat) ? defaults.compat : {}), ...(object(target.compat) ? target.compat : {}) } }
          try { validateParameterModel(effective, p.ns, working.parameterApis?.[key] ?? String(p.effective?.api ?? 'unknown')) } catch (error) { diff.blockedReasons.push((error as Error).message) }
          const input = target[p.ns === 'llm-deepseek' ? 'inputModalities' : 'input']
          if (Array.isArray(input)) record.nativeImage = input.includes('image') ? 'yes' : 'no'
          if (intent.value?.reasoningEfforts !== undefined) record.reasoningEfforts = object(target.reasoningEfforts) ? Object.keys(target.reasoningEfforts).map(id => ({ id, name: id })) : []
          if (typeof target.contextWindow === 'number') record.contextWindow = target.contextWindow
          if (typeof target.maxTokens === 'number') record.defaultMaxTokens = target.maxTokens
          const settings = working.config.models[key]
          for (const [host, plugin] of [['contextWindow', 'contextWindow'], ['maxTokens', 'maxOutputTokens']] as const) if (intent.value?.[host] !== undefined && settings?.capability?.[plugin] !== undefined && !same(settings.capability[plugin], target[host])) {
            const picked = choice(diff, `override:${plugin}`, 'conflict', `models.${key}.capability.${plugin}`, [{ optionId: 'clear', label: '移除冲突的插件覆盖，采用宿主值' }])
            if (!picked) diff.blockedReasons.push(`请处理宿主字段与插件覆盖冲突：${plugin}`)
            else delete settings.capability[plugin]
          }
          for (const visual of visualSelections(working)) if (visualRefs(working, visual.value).some(ref => modelKey(ref) === key) && record.nativeImage !== 'yes') {
            const targets = working.records.filter(r => modelKey(r) !== key && r.nativeImage === 'yes')
            const picked = choice(diff, `vision:${visual.path}`, 'vision', visual.path, [{ optionId: 'disable', label: '关闭视觉辅助并清除该目标', value: 'disable' }, ...targets.map(r => ({ optionId: modelKey(r), label: `${r.name} · ${r.providerId}`, value: { providerId: r.providerId, modelId: r.modelId } }))])
            if (!picked) diff.blockedReasons.push(`图片目标失去原生图片声明：${visual.path}`)
            else if (picked.value === 'disable') { working.config.vision.enabled = false; visual.clear() } else visual.replace(picked.value as ModelRef)
          }
          if (intent.value?.reasoningEfforts !== undefined) {
            const options = [{ optionId: 'default', label: '使用模型默认，清除旧推理选择' }, ...record.reasoningEfforts.map(e => ({ optionId: e.id, label: e.name, value: e.id }))]
            for (const [name, alias] of Object.entries(working.config.aliases)) if (alias.candidates.some(r => modelKey(r) === key) && alias.efforts?.[key] && !record.reasoningEfforts.some(e => e.id === alias.efforts![key])) {
              const picked = choice(diff, `alias-parameter:${name}`, 'parameter', `aliases.${name}.efforts.${key}`, options)
              if (!picked) diff.blockedReasons.push(`别名 ${name} 的推理档位不兼容`)
              else if (picked.value === undefined) delete alias.efforts[key]; else alias.efforts[key] = picked.value as string
            }
            for (const field of ['tiers', 'legacyTiers'] as const) for (const [tier, effort] of Object.entries(settings?.[field] ?? {})) if (effort !== 'auto' && !record.reasoningEfforts.some(e => e.id === effort)) {
              const picked = choice(diff, `mapping:${field}:${tier}`, 'parameter', `models.${key}.${field}.${tier}`, options)
              if (!picked) diff.blockedReasons.push(`旧档位映射不兼容：${field}.${tier}`)
              else if (picked.value === undefined) delete (settings![field] as Record<string, string>)[tier]; else (settings![field] as Record<string, string>)[tier] = picked.value as string
            }
            for (const { value, path } of selections(working)) if (visualRefs(working, value.target).some(ref => modelKey(ref) === key)) {
              try { mapSelectionEffort(record, settings, value) } catch {
                const picked = choice(diff, `parameter:${path}`, 'parameter', `${path}.推理档位`, options)
                if (!picked) diff.blockedReasons.push(`已有推理选择不兼容：${path}`)
                else { delete value.reasoningEffort; delete value.tier; delete value.thinking; if (picked.value !== undefined) value.reasoningEffort = picked.value as string }
              }
            }
          }
        }
      }
    } else {
      const oldRefs = (intent.kind === 'migrate' ? intent.oldIds ?? [] : [intent.model.modelId]).map(modelId => ({ providerId: intent.model.providerId, modelId }))
      const oldKeys = new Set(oldRefs.map(modelKey)), oldIds = new Set(oldRefs.map(r => r.modelId))
      diff.references = catalogReferences(working, oldRefs); diff.attachedSettings = diff.references.filter(r => r.type === 'attached').map(r => r.path)
      let replacement: ModelRef | undefined = intent.kind === 'migrate' ? intent.model : undefined
      if (intent.kind === 'remove') {
        const targets = working.records.filter(m => !oldKeys.has(modelKey(m)) && !intents.some(i => i.kind === 'remove' && modelKey(i.model) === modelKey(m)))
        const picked = choice(diff, 'replacement', 'replacement', '使用引用替代', [{ optionId: 'none', label: '不替代（须没有使用引用）' }, ...targets.map(m => ({ optionId: modelKey(m), label: `${m.name} · ${m.providerId}`, value: { providerId: m.providerId, modelId: m.modelId } }))])
        replacement = picked?.value as ModelRef | undefined
        if (diff.attachedSettings.length && !choice(diff, 'cleanup', 'cleanup', '清理附属能力／档位设置', [{ optionId: 'clear', label: '确认清理列出的附属设置（完整备份）', value: true }])) diff.blockedReasons.push('请确认清理附属设置')
      } else {
        let target = p.models.find(m => m.id === intent.model.modelId)
        const existed = !!target
        target ??= { id: intent.model.modelId }
        for (const old of p.models.filter(m => oldIds.has(m.id))) {
          const source = { ...old }; delete (source as Partial<HostModel>).id
          // 旧目录的默认能力不能作为新型号的属性证据；输出上限和未知字段仍保留。
          if (p.userFields) for (const field of ['name', 'contextWindow', 'inputModalities', 'input', 'imagePixelBudget', 'imageMaxBytes']) if (!p.userFields[old.id]?.includes(field)) delete source[field]
          const metadata = working.config.catalogMetadata?.[modelKey({ providerId: p.providerId, modelId: old.id })]
          if (metadata?.origin === 'official' && !metadata.customName) delete source.name
          target = merge(target, source, `${p.ns}.models.${intent.model.modelId}`, diff) as HostModel
        }
        if (intent.officialDiff) officialFields(target, intent, diff, new Set([intent.model.modelId, ...oldIds].flatMap(id => p.userFields?.[id] ?? Object.keys(p.models.find(m => m.id === id) ?? {}))))
        else Object.assign(target, intent.value)
        const index = p.models.findIndex(m => m.id === intent.model.modelId || oldIds.has(m.id))
        p.models = p.models.filter(m => m.id !== intent.model.modelId && !oldIds.has(m.id)); p.models.splice(Math.max(0, index), 0, target)
        working.config.catalogMetadata ??= {}
        if (!existed) working.config.catalogMetadata[key] = { origin: 'official' }
      }
      const recordFor = (ref: ModelRef) => working.records.find(m => modelKey(m) === modelKey(ref))
      const imageFor = (ref: ModelRef) => {
        const profile = working.profiles.find(p => p.providerId === ref.providerId), model = profile?.models.find(m => m.id === ref.modelId)
        const input = model?.[profile?.ns === 'llm-deepseek' ? 'inputModalities' : 'input']
        return Array.isArray(input) ? input.includes('image') : recordFor(ref)?.nativeImage === 'yes'
      }
      for (const visual of visualSelections(working)) {
        if (!visualRefs(working, visual.value).some(ref => oldKeys.has(modelKey(ref)))) continue
        if (replacement && imageFor(replacement) && typeof visual.value !== 'string') { visual.replace(replacement); continue }
        const targets = working.records.filter(m => !oldKeys.has(modelKey(m)) && imageFor(m) && !intents.some(i => i.kind === 'remove' && modelKey(i.model) === modelKey(m)))
        const picked = choice(diff, `vision:${visual.path}`, 'vision', visual.path, [{ optionId: 'disable', label: '关闭视觉辅助并清除该引用', value: 'disable' }, ...targets.map(m => ({ optionId: modelKey(m), label: `图片辅助：${m.name} · ${m.providerId}`, value: { providerId: m.providerId, modelId: m.modelId } }))])
        if (!picked) diff.blockedReasons.push(`请替换图片辅助模型或关闭辅助：${visual.path}`)
        else if (picked.value === 'disable') { working.config.vision.enabled = false; visual.clear(); for (const other of visualSelections(working)) if (visualRefs(working, other.value).some(ref => oldKeys.has(modelKey(ref)))) other.clear() }
        else visual.replace(picked.value as ModelRef)
      }
      visitRefs(working, (ref, path, selection) => {
        if (!oldKeys.has(modelKey(ref))) return
        if (!replacement) { diff.blockedReasons.push(`仍被引用：${path}`); return }
        Object.assign(ref, replacement)
      })
      const destinationKey = replacement ? modelKey(replacement) : undefined
      for (const oldKey of oldKeys) {
        if (intent.kind === 'migrate' && destinationKey && working.config.models[oldKey]) working.config.models[destinationKey] = merge(working.config.models[destinationKey], working.config.models[oldKey], `models.${destinationKey}`, diff) as any
        delete working.config.models[oldKey]
        if (intent.kind === 'migrate' && destinationKey && (working.config.catalogMetadata?.[oldKey]?.customName || before.profiles.find(p => p.providerId === intent.model.providerId)?.models.some(m => modelKey({ providerId: intent.model.providerId, modelId: m.id }) === oldKey && m.name !== undefined && working.config.catalogMetadata?.[oldKey]?.origin !== 'official'))) { working.config.catalogMetadata ??= {}; working.config.catalogMetadata[destinationKey] = { ...working.config.catalogMetadata[destinationKey], customName: true } }
        if (working.config.catalogMetadata) delete working.config.catalogMetadata[oldKey]
        for (const [name, alias] of Object.entries(working.config.aliases)) if (alias.efforts && Object.hasOwn(alias.efforts, oldKey)) {
          if (destinationKey && alias.candidates.some(ref => modelKey(ref) === destinationKey)) alias.efforts[destinationKey] = merge(alias.efforts[destinationKey], alias.efforts[oldKey], `aliases.${name}.efforts.${destinationKey}`, diff) as string
          delete alias.efforts[oldKey]
        }
      }
      for (const [name, alias] of Object.entries(working.config.aliases)) {
        alias.candidates = [...new Map(alias.candidates.map(ref => [modelKey(ref), ref])).values()]
        for (const ref of alias.candidates) {
          const effort = alias.efforts?.[modelKey(ref)], record = recordFor(ref)
          if (effort && replacement && modelKey(ref) === modelKey(replacement) && !record?.reasoningEfforts.some(e => e.id === effort)) {
            const picked = choice(diff, `alias-parameter:${name}`, 'parameter', `aliases.${name}.efforts.${modelKey(ref)}`, [{ optionId: 'default', label: '使用模型默认' }, ...(record?.reasoningEfforts ?? []).map(e => ({ optionId: e.id, label: e.name, value: e.id }))])
            if (!picked) diff.blockedReasons.push(`别名 ${name} 的推理档位不兼容或未知`)
            else if (picked.value === undefined) delete alias.efforts![modelKey(ref)]; else alias.efforts![modelKey(ref)] = picked.value as string
          }
        }
      }
      if (replacement && destinationKey) {
        const record = recordFor(replacement), settings = working.config.models[destinationKey]
        for (const field of ['tiers', 'legacyTiers'] as const) for (const [tier, effort] of Object.entries(settings?.[field] ?? {})) {
          if (effort === 'auto' || record?.reasoningEfforts.some(e => e.id === effort)) continue
          const path = `models.${destinationKey}.${field}.${tier}`
          const picked = choice(diff, `mapping:${path}`, 'parameter', path, [{ optionId: 'default', label: '移除旧映射，使用目标模型默认' }, ...(record?.reasoningEfforts ?? []).map(e => ({ optionId: e.id, label: e.name, value: e.id }))])
          if (!picked) diff.blockedReasons.push(`目标模型不支持或无法确认旧档位映射：${path}`)
          else if (picked.value === undefined) delete (settings![field] as Record<string, string>)[tier]; else (settings![field] as Record<string, string>)[tier] = picked.value as string
        }
        for (const { value, path } of selections(working)) {
          if (!visualRefs(working, value.target).some(ref => modelKey(ref) === destinationKey)) continue
          let invalid = false
          try { if (!record) { if (value.reasoningEffort || value.thinking === 'off' || value.tier && !['auto', 'inherit'].includes(value.tier)) invalid = true } else mapSelectionEffort(record, settings, value) } catch { invalid = true }
          if (!invalid) continue
          const picked = choice(diff, `parameter:${path}.target`, 'parameter', `${path}.推理参数`, [{ optionId: 'default', label: '使用目标模型默认（清除旧档位）' }, ...(record?.reasoningEfforts ?? []).map(e => ({ optionId: e.id, label: e.name, value: e.id }))])
          if (!picked) diff.blockedReasons.push(`替代模型不支持或无法确认推理档位：${path}`)
          else { delete value.reasoningEffort; delete value.tier; delete value.thinking; if (picked.value !== undefined) value.reasoningEffort = picked.value as string }
        }
      }
      if (working.subagents?.allowedModels) {
        const deduped = new Map<string, typeof working.subagents.allowedModels[number]>()
        for (const item of working.subagents.allowedModels) { const k = JSON.stringify([item.provider, item.model]); deduped.set(k, merge(deduped.get(k), item, `subagent-model-selection.allowedModels.${k}`, diff) as typeof item) }
        working.subagents.allowedModels = [...deduped.values()]
      }
      if (intent.kind === 'remove') p.models = p.models.filter(m => !oldIds.has(m.id))
    }
    if (p.models.length < p.minimumModels) diff.blockedReasons.push('该 Provider 空清单会恢复内置目录，不能删除最后一个模型')
    for (const model of p.models) {
      const input = model[p.ns === 'llm-deepseek' ? 'inputModalities' : 'input']
      if (p.ns === 'llm-deepseek' && Array.isArray(input) && !input.includes('image') && (model.imagePixelBudget !== undefined || model.imageMaxBytes !== undefined)) {
        const picked = choice(diff, `image-limits:${model.id}`, 'conflict', `${p.ns}.models.${model.id}.图片限制`, [{ optionId: 'clear', label: '确认移除文本模型不兼容的图片限制（已备份）' }])
        if (!picked) diff.blockedReasons.push(`文本模型不能保留图片限制：${model.id}`)
        else { delete model.imagePixelBudget; delete model.imageMaxBytes }
      }
    }
    working.models = working.profiles.find(p => p.providerId === OFFICIAL_PROVIDER)?.models ?? []
    try { validateConfig(working.config) } catch (error) { diff.blockedReasons.push(String(error)) }
    diff.after = structuredClone(p.models.find(m => m.id === intent.model.modelId) ?? null)
    diff.referenceChanges = [
      { path: 'vision', before: state.config.vision, after: working.config.vision },
      { path: 'auto.roles.vision', before: state.config.auto.roles.vision, after: working.config.auto.roles.vision },
      { path: 'aliases', before: state.config.aliases, after: working.config.aliases },
      { path: 'auto', before: state.config.auto, after: working.config.auto },
      { path: 'agent-default-model', before: state.defaultModel, after: working.defaultModel },
      { path: 'subagent-model-selection', before: state.subagents, after: working.subagents },
      { path: 'overrides', before: state.overrides, after: working.overrides },
    ].filter(change => !same(change.before, change.after)).map(change => structuredClone(change))
    if (!diff.blockedReasons.length && (!selected || selected.includes(diff.id))) Object.assign(state, working)
  }
  for (const resolution of resolutions) if (!offered.get(resolution.id)?.has(resolution.optionId) && !baselineChoices.some(c => c.id === resolution.id && c.options.some(o => o.optionId === resolution.optionId))) throw new Error('处理选项已变化或无效，请重新预览')
  if (selected && (new Set(selected).size !== selected.length || selected.some(id => !operations.some(o => o.id === id)))) throw new Error('选中操作无效或重复')
  return { operations, after: state }
}
