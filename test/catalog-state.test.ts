import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, managedId, modelKey, type ModelRef } from '../src/domain.js'
import { catalogReferences, manualIntents, officialIntents, planCatalog } from '../src/catalog-state.js'
import type { CatalogResolution, CatalogState } from '../src/catalog-types.js'
import { analysis } from './official-fixtures.js'

const ref = (id: string, providerId = 'deepseek-official'): ModelRef => ({ providerId, modelId: id })
function fixture(): CatalogState {
  const models = [{ id: 'old-fast', name: '旧文本', inputModalities: ['text'] }, { id: 'old-vision', inputModalities: ['text', 'image'], imagePixelBudget: 88, maxTokens: 99 }, { id: 'fast', inputModalities: ['text', 'image'], maxTokens: 199 }, { id: 'pro', inputModalities: ['text'] }]
  const records = [...models.map(m => ({ providerId: 'deepseek-official', modelId: m.id, name: m.name ?? m.id, nativeImage: (m.inputModalities.includes('image') ? 'yes' : 'no') as 'yes' | 'no', reasoningEfforts: [{ id: 'high', name: 'High' }], source: 'host' as const, loaded: true })), { providerId: 'other', modelId: 'reader', name: '跨平台图片', nativeImage: 'yes' as const, reasoningEfforts: [{ id: 'medium', name: 'Medium' }], source: 'host' as const, loaded: true }]
  return { models, records, config: structuredClone(DEFAULT_CONFIG), profiles: [{ providerId: 'deepseek-official', ns: 'llm-deepseek', path: [], models, explicit: true, minimumModels: 0 }, { providerId: 'other', ns: 'llm-pi-ai', path: ['providers', 'other'], models: [{ id: 'reader' }], explicit: false, minimumModels: 1 }], overrides: {}, defaultModel: { provider: 'other', model: 'reader' } }
}
function remove(state: CatalogState, id = 'old-vision') { return manualIntents([{ kind: 'remove', model: ref(id) }], state) }
function resolveBy(plan: ReturnType<typeof planCatalog>, pick: (choice: typeof plan.operations[number]['choices'][number]) => string | undefined): CatalogResolution[] {
  return plan.operations.flatMap(o => o.choices.flatMap(c => { const optionId = pick(c); return optionId ? [{ id: c.id, optionId }] : [] }))
}
describe('真实目录生命周期与视觉删除', () => {
  it('停用偏好不阻止删除模型、别名或被官方迁移改写，原生范围仍检查', () => {
    const state = fixture()
    state.config.auto.preferences = { coding: { target: ref('old-fast') }, search: { target: '@legacy' } }
    state.config.aliases.legacy = { candidates: [ref('old-fast')] }
    const preferences = structuredClone(state.config.auto.preferences)
    const alias = planCatalog(state, manualIntents([{ kind: 'removeAlias', name: 'legacy' }], state))
    expect(alias.operations[0].blockedReasons).toEqual([])
    expect(alias.after.config.auto.preferences).toEqual(preferences)
    delete state.config.aliases.legacy
    const deletion = planCatalog(state, remove(state, 'old-fast'))
    expect(deletion.operations[0].blockedReasons).toEqual([])
    expect(deletion.after.config.auto.preferences).toEqual(preferences)
    const migrated = planCatalog(state, [{ id: 'merge', kind: 'migrate', model: ref('fast'), oldIds: ['old-fast'], value: { id: 'fast' } }])
    expect(migrated.after.config.auto.preferences).toEqual(preferences)
    state.subagents = { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'old-fast' }] }
    expect(catalogReferences(state, [ref('old-fast')]).map(r => r.path)).toEqual(['subagent-model-selection.allowedModels[0]'])
    expect(planCatalog(state, remove(state, 'old-fast')).operations[0].blockedReasons.length).toBeGreaterThan(0)
  })
  it('存在无关图片辅助模型不阻止删除其他模型，不变更视觉设置', () => {
    const state = fixture(); state.config.vision = { enabled: true, policy: 'native-first', target: ref('reader', 'other') }
    const p = planCatalog(state, remove(state, 'old-fast'))
    expect(p.operations[0].blockedReasons).toEqual([]); expect(p.after.config.vision).toEqual(state.config.vision)
    expect(p.after.models.some(m => m.id === 'old-fast')).toBe(false); expect(state.models).toHaveLength(4)
  })
  it('仅自身能力／档位设置可明确清理，不再永久阻止删除', () => {
    const state = fixture(); state.config.models[modelKey(ref('old-vision'))] = { capability: { image: 'yes' }, tiers: { high: 'high' } }
    const intents = remove(state), first = planCatalog(state, intents)
    expect(catalogReferences(state, [ref('old-vision')]).map(r => r.type)).toEqual(['attached'])
    const next = planCatalog(state, intents, resolveBy(first, c => c.kind === 'cleanup' ? 'clear' : undefined))
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.models).toEqual({})
  })
  it.each([true, false])('辅助 enabled=%s：关闭并清理直接与旧兜底目标，整体删除', enabled => {
    const state = fixture(); state.config.vision = { enabled, policy: 'sidecar-only', target: ref('old-vision') }; state.config.auto.roles.vision.target = ref('old-vision')
    const intents = remove(state), first = planCatalog(state, intents)
    expect(first.operations[0].blockedReasons.join()).toContain('图片辅助')
    const next = planCatalog(state, intents, resolveBy(first, c => c.kind === 'vision' && c.path === 'vision.target' ? 'disable' : undefined))
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.vision.enabled).toBe(false)
    expect(next.after.config.vision.target).toBeUndefined(); expect(next.after.config.auto.roles.vision.target).toBeUndefined()
    expect(next.after.models.some(m => m.id === 'old-vision')).toBe(false)
  })
  it('跨 Provider 图片替代保留目标声明，default provider/model 一起迁移', () => {
    const state = fixture(); state.config.vision = { enabled: true, policy: 'native-first', target: ref('old-vision') }; state.defaultModel = { provider: 'deepseek-official', model: 'old-vision' }
    state.overrides.s = { session: { target: ref('old-vision'), reasoningEffort: 'high', maxOutputTokens: 77 } }
    const intents = remove(state), first = planCatalog(state, intents)
    const resolutions = resolveBy(first, c => c.kind === 'replacement' ? modelKey(ref('reader', 'other')) : c.kind === 'parameter' ? 'default' : undefined)
    const mid = planCatalog(state, intents, resolutions)
    const next = planCatalog(state, intents, [...resolutions, ...resolveBy(mid, c => c.kind === 'parameter' ? 'default' : undefined)])
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.vision.target).toEqual(ref('reader', 'other'))
    expect(next.after.defaultModel).toEqual({ provider: 'other', model: 'reader' }); expect(next.after.profiles[1].models).toEqual([{ id: 'reader' }])
    expect(next.after.overrides.s.session).toEqual({ target: ref('reader', 'other'), maxOutputTokens: 77 })
  })
  it('视觉别名显示引用链；关闭不删除共享别名，未解决候选仍阻止', () => {
    const state = fixture(); state.config.aliases.images = { candidates: [ref('old-vision'), ref('pro')] }; state.config.vision = { enabled: true, policy: 'sidecar-first', target: '@images' }
    const intents = remove(state), first = planCatalog(state, intents)
    expect(first.operations[0].references.some(r => r.chain?.includes('@images'))).toBe(true)
    const next = planCatalog(state, intents, resolveBy(first, c => c.kind === 'vision' ? 'disable' : undefined))
    expect(next.operations[0].blockedReasons.join()).toContain('aliases.images.candidates')
    expect(next.after.config.vision.enabled).toBe(true); expect(next.after.models).toHaveLength(4)
  })
  it('图片替代候选不包括仅文本／未知能力模型；官方文本目标需要视觉单独处理', () => {
    const state = fixture(); state.config.vision = { enabled: true, policy: 'native-first', target: ref('old-vision') }
    const intents = [{ id: 'merge', kind: 'migrate' as const, model: ref('fast'), oldIds: ['old-vision'], value: { id: 'fast', inputModalities: ['text'] } }]
    const first = planCatalog(state, intents)
    const vision = first.operations[0].choices.find(c => c.kind === 'vision')!
    expect(vision.options.some(o => o.optionId === modelKey(ref('pro')))).toBe(false)
    expect(first.operations[0].blockedReasons.join()).toContain('图片辅助')
    const next = planCatalog(state, intents, resolveBy(first, c => c.kind === 'vision' ? modelKey(ref('reader', 'other')) : c.kind === 'conflict' ? c.options.some(o => o.optionId === 'target') ? 'target' : 'clear' : undefined))
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.vision.target).toEqual(ref('reader', 'other'))
    expect(next.after.models.find(m => m.id === 'fast')?.inputModalities).toEqual(['text'])
    expect(next.after.models.find(m => m.id === 'fast')).not.toHaveProperty('imagePixelBudget')
  })
  it('已有目标与不同用户上限逐项选择，不静默丢失用户字段', () => {
    const state = fixture(), intents = [{ id: 'merge', kind: 'migrate' as const, model: ref('fast'), oldIds: ['old-vision'], value: { id: 'fast' } }]
    const first = planCatalog(state, intents); expect(first.operations[0].blockedReasons.join()).toContain('maxTokens')
    const next = planCatalog(state, intents, resolveBy(first, c => c.kind === 'conflict' ? 'old' : undefined))
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.models.find(m => m.id === 'fast')).toMatchObject({ maxTokens: 99, imagePixelBudget: 88 })
    expect(next.after.models.filter(m => m.id === 'fast')).toHaveLength(1)
  })
  it('自定义名称写元信息，API ID 不变；后续官方资料不覆盖', () => {
    const state = fixture(); const next = planCatalog(state, manualIntents([{ kind: 'rename', model: ref('fast'), name: '我的图片模型' }], state)).after
    expect(next.models.find(m => m.id === 'fast')?.name).toBe('我的图片模型')
    expect(next.config.catalogMetadata?.[modelKey(ref('fast'))]?.customName).toBe(true)
    expect(officialIntents(next, analysis(['fast', 'pro'])).some(i => i.officialDiff?.field === 'name')).toBe(false)
  })
  it('新增重复 ID 返回编辑目标；跨 Provider 同 ID 可新增；删除最后一个 pi 模型阻止', () => {
    const state = fixture()
    try { manualIntents([{ kind: 'add', model: ref('fast') }], state); throw new Error('must reject') } catch (error) { expect((error as any).existingModel).toEqual(ref('fast')) }
    const added = planCatalog(state, manualIntents([{ kind: 'add', model: ref('fast', 'other'), name: '同名' }], state))
    expect(added.after.profiles[1].models.map(m => m.id)).toEqual(['reader', 'fast'])
    const last = planCatalog(state, manualIntents([{ kind: 'remove', model: ref('reader', 'other') }], state))
    expect(last.operations[0].blockedReasons.join()).toContain('最后一个模型')
  })
  it('选中操作与计数的状态模拟只提交有效组；非法处理选项拒绝', () => {
    const state = fixture(), intents = manualIntents([{ kind: 'rename', model: ref('fast'), name: '未选中' }, { kind: 'remove', model: ref('old-fast') }], state)
    const plan = planCatalog(state, intents, [], [intents[1].id]); expect(plan.after.models.find(m => m.id === 'fast')).not.toHaveProperty('name'); expect(plan.after.models).toHaveLength(3)
    expect(() => planCatalog(state, intents, [{ id: 'invented', optionId: 'force' }])).toThrow('无效')
    expect(() => planCatalog(state, intents, [], ['invented'])).toThrow('无效')
  })
})


describe('旧推理档位与本地名称保护', () => {
  it('未知来源旧名称保护，目标已存在时显式处理名称冲突', () => {
    const state = fixture(); state.models.find(m => m.id === 'old-fast')!.inputModalities = ['text', 'image']; state.models.find(m => m.id === 'fast')!.name = '目标中文名'
    const intents = officialIntents(state, analysis(['fast', 'pro'], ['old-fast']))
    const first = planCatalog(state, intents)
    const conflict = first.operations[0].choices.find(c => c.path.endsWith('.name'))!
    expect(conflict.options.map(o => o.value)).toEqual(['目标中文名', '旧文本'])
    const next = planCatalog(state, intents, [{ id: conflict.id, optionId: 'old' }])
    expect(next.operations[0].blockedReasons).toEqual([])
    expect(next.after.models.find(m => m.id === 'fast')!.name).toBe('旧文本')
    expect(next.after.config.catalogMetadata![modelKey(ref('fast'))].customName).toBe(true)
  })
  it('跨 Provider 替代检查旧 tier 与 thinking，默认选择清理旧参数', () => {
    const state = fixture(); state.config.auto.normal = { target: ref('old-fast'), tier: 'off' }
    const intents = remove(state, 'old-fast'), first = planCatalog(state, intents)
    const replacement = resolveBy(first, c => c.kind === 'replacement' ? modelKey(ref('reader', 'other')) : undefined)
    const mid = planCatalog(state, intents, replacement)
    expect(mid.operations[0].blockedReasons.join()).toContain('推理档位')
    const next = planCatalog(state, intents, [...replacement, ...resolveBy(mid, c => c.kind === 'parameter' ? 'default' : undefined)])
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.auto.normal).toEqual({ target: ref('reader', 'other') })
  })
  it('官方迁移的 tiers / legacyTiers 映射必须兼容目标', () => {
    const state = fixture(); state.models.find(m => m.id === 'old-fast')!.inputModalities = ['text', 'image']; state.config.models[modelKey(ref('old-fast'))] = { tiers: { high: 'unknown' }, legacyTiers: { deep: 'unknown' } }
    const intents = officialIntents(state, analysis(['fast', 'pro'], ['old-fast'])), first = planCatalog(state, intents)
    expect(first.operations[0].choices.filter(c => c.kind === 'parameter')).toHaveLength(2)
    const next = planCatalog(state, intents, resolveBy(first, c => c.kind === 'parameter' ? 'default' : undefined))
    expect(next.operations[0].blockedReasons).toEqual([])
    expect(next.after.config.models[modelKey(ref('fast'))]).toEqual({ tiers: {}, legacyTiers: {} })
  })
})


describe('官方字段与宿主必要属性', () => {
  it('官方明确属性与原显式值冲突时逐项选择，不直接覆盖', () => {
    const state = fixture(); const a = analysis(['fast', 'pro'], ['old-fast']); a.models[0].image = false
    const intents = officialIntents(state, a), first = planCatalog(state, intents, [], [intents[0].id])
    const official = first.operations[0].choices.find(c => c.options.some(o => o.optionId === 'official'))!
    expect(official.path).toBe('fast.inputModalities')
    expect(first.after.models).toEqual(state.models)
    const choices = resolveBy(first, c => c.options.some(o => o.optionId === 'official') ? 'official' : c.kind === 'conflict' ? 'target' : undefined)
    const next = planCatalog(state, intents, choices)
    expect(next.operations[0].blockedReasons).toEqual([])
    expect(next.after.models.find(m => m.id === 'fast')!.inputModalities).toEqual(['text'])
  })
  it('自定义名称仅在明确采用官方名称后解除保护', () => {
    const state = fixture(); state.models.find(m => m.id === 'fast')!.name = '我的名称'
    state.config.catalogMetadata = { [modelKey(ref('fast'))]: { customName: true, origin: 'manual' } }
    const a = analysis(['fast', 'pro']); a.models[0].name = '官方名称'
    const intents = officialIntents(state, a), first = planCatalog(state, intents)
    const op = first.operations.find(o => o.kind === 'update')!
    expect(op.blockedReasons.join()).toContain('冲突')
    const next = planCatalog(state, intents, [{ id: op.choices[0].id, optionId: 'official' }])
    expect(next.after.models.find(m => m.id === 'fast')!.name).toBe('官方名称')
    expect(next.after.config.catalogMetadata![modelKey(ref('fast'))].customName).toBe(false)
  })
  it('自定义 Provider 缺少协议或必要默认值，新增预览阻止且不物化', () => {
    const state = fixture(); state.profiles[1].addConstraints = { declared: true, missing: ['api', 'baseURL'] }
    const intents = manualIntents([{ kind: 'add', model: ref('new', 'other') }], state)
    const p = planCatalog(state, intents)
    expect(p.operations[0].blockedReasons.join()).toContain('api、baseURL、contextWindow、maxTokens')
    expect(p.after.profiles[1].models).toEqual(state.profiles[1].models)
  })
})


it('宿主默认与子 Agent 中受管理具体 ID 的真实目标一并迁移，历史输入不改', () => {
  const state = fixture(), old = ref('old-fast'), target = ref('reader','other')
  state.defaultModel = { provider: 'dsh-model-manager', model: managedId(old) }
  state.subagents = { allowedModels: [{ provider: 'dsh-model-manager', model: Buffer.from(JSON.stringify([old.providerId,old.modelId])).toString('base64url') }] }
  const intents = remove(state,'old-fast'), first = planCatalog(state,intents)
  const next = planCatalog(state,intents,resolveBy(first,c=>c.kind==='replacement'?modelKey(target):undefined))
  expect(next.operations[0].blockedReasons).toEqual([])
  expect(next.after.defaultModel).toEqual({ provider:'dsh-model-manager',model:managedId(target) })
  expect(next.after.subagents!.allowedModels![0].model).toBe(managedId(target))
  expect(state.defaultModel.model).toBe(managedId(old))
})
