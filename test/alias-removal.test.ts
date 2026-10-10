import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, modelKey, type ModelRef } from '../src/domain.js'
import { manualIntents, planCatalog } from '../src/catalog-state.js'
import type { CatalogResolution, CatalogState } from '../src/catalog-types.js'

const text: ModelRef = { providerId: 'p', modelId: 'text' }, image: ModelRef = { providerId: 'p', modelId: 'image' }
function fixture(): CatalogState {
  const config = structuredClone(DEFAULT_CONFIG)
  config.aliases['deepseek-v4-1'] = { candidates: [text], reliability: { maxAttempts: 3 } }
  return { config, models: [], profiles: [{ providerId: 'p', ns: 'llm-pi-ai', path: ['providers', 'p'], models: [{ id: 'text' }, { id: 'image' }], explicit: true, minimumModels: 1 }], records: [
    { ...text, name: '文字模型', nativeImage: 'no', loaded: true, source: 'host', reasoningEfforts: [{ id: 'low', name: 'Low' }] },
    { ...image, name: '图片模型', nativeImage: 'yes', loaded: true, source: 'host', reasoningEfforts: [{ id: 'high', name: 'High' }] },
  ], overrides: {}, defaultModel: { provider: 'p', model: 'text', custom: 'keep' } }
}
const intents = (state: CatalogState) => manualIntents([{ kind: 'removeAlias', name: 'deepseek-v4-1' }], state)
const resolutions = (plan: ReturnType<typeof planCatalog>, pick: (path: string) => string = () => 'clear'): CatalogResolution[] => plan.operations[0].choices.map(c => ({ id: c.id, optionId: pick(c.path) }))

describe('别名删除引用处理', () => {
  it('无引用删除只删完整别名配置，不删除模型或其他别名', () => {
    const state = fixture(); state.config.aliases.keep = { candidates: [text] }; state.config.models[modelKey(text)] = { capability: { contextWindow: 64000 } }
    const next = planCatalog(state, intents(state))
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.aliases).not.toHaveProperty('deepseek-v4-1')
    expect(next.after.config.aliases.keep).toEqual(state.config.aliases.keep); expect(next.after.profiles).toEqual(state.profiles); expect(next.after.config.models).toEqual(state.config.models)
    expect(state.config.aliases).toHaveProperty('deepseek-v4-1')
  })
  it('当前用户复现：隐藏旧主模型及关闭旧视觉兜底明确清理，保留当前有效视觉', () => {
    const state = fixture(); state.config.auto.main = { target: '@deepseek-v4-1', tier: 'high', reasoningEffort: 'high', thinking: 'on', maxOutputTokens: 99, custom: 'keep' } as any
    state.config.auto.roles.vision = { enabled: false, target: '@deepseek-v4-1', tier: 'auto' }
    state.config.vision = { enabled: true, policy: 'native-first', target: image }
    const first = planCatalog(state, intents(state))
    expect(first.operations[0].references.map(r => r.path)).toEqual(['auto.main.target', 'auto.roles.vision.target'])
    expect(first.operations[0].blockedReasons.join()).toContain('别名未绑定'); expect(first.after).toEqual(state)
    const next = planCatalog(state, intents(state), resolutions(first))
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.auto.main).toEqual({ maxOutputTokens: 99, custom: 'keep' })
    expect(next.after.config.auto.roles.vision).toEqual({ enabled: false }); expect(next.after.config.vision).toEqual(state.config.vision)
  })
  it('所有配置与未来覆盖引用均展示，未处理任意一项不能删除', () => {
    const state = fixture()
    for (const key of ['simple', 'normal', 'complex'] as const) state.config.auto[key].target = '@deepseek-v4-1'
    state.config.auto.preferences = { review: { target: '@deepseek-v4-1' } }; state.config.auto.roles.search.target = '@deepseek-v4-1'
    state.overrides.s = { session: { target: '@deepseek-v4-1', maxOutputTokens: 123 }, nextTurn: { target: '@deepseek-v4-1' } }
    state.defaultModel = { provider: 'dsh-model-manager', model: 'alias:deepseek-v4-1', custom: 'keep' }
    state.subagents = { enabled: false, allowedModels: [{ provider: 'dsh-model-manager', model: 'alias:deepseek-v4-1' }] }
    const first = planCatalog(state, intents(state)), picked = resolutions(first, path => path === 'agent-default-model.model' ? modelKey(text) : 'clear')
    expect(first.operations[0].references).toHaveLength(8)
    expect(planCatalog(state, intents(state), picked.slice(1)).after).toEqual(state)
    const next = planCatalog(state, intents(state), picked)
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.defaultModel).toEqual({ provider: 'p', model: 'text', custom: 'keep' })
    expect(next.after.overrides.s.session).toEqual({ maxOutputTokens: 123 }); expect(next.after.subagents!.allowedModels).toEqual([])
  })
  it('启用 AUTO 的必填档及宿主默认不提供清除，子 Agent 空范围阻止', () => {
    const state = fixture(); state.config.auto.enabled = true; state.config.auto.evaluator = text
    for (const grade of ['simple', 'normal', 'complex'] as const) state.config.auto[grade].target = '@deepseek-v4-1'
    state.defaultModel = { provider: 'dsh-model-manager', model: 'alias:deepseek-v4-1' }
    const first = planCatalog(state, intents(state))
    expect(first.operations[0].choices.every(c => c.options.every(o => o.optionId !== 'clear'))).toBe(true)
    expect(() => planCatalog(state, intents(state), resolutions(first))).toThrow('无效')
    expect(planCatalog(state, intents(state), resolutions(first, () => modelKey(text))).operations[0].blockedReasons).toEqual([])
    state.subagents = { enabled: true, allowedModels: [{ provider: 'dsh-model-manager', model: 'alias:deepseek-v4-1' }] }
    const second = planCatalog(state, intents(state))
    expect(planCatalog(state, intents(state), resolutions(second, path => path.startsWith('subagent') ? 'clear' : modelKey(text))).operations[0].blockedReasons.join()).toContain('至少保留')
  })
  it.each([true, false])('直接视觉目标 enabled=%s：必须图片替换或明确关闭／清理', enabled => {
    const state = fixture(); state.config.vision = { enabled, policy: 'sidecar-only', target: '@deepseek-v4-1' }; state.config.auto.roles.vision.target = '@deepseek-v4-1'
    const first = planCatalog(state, intents(state))
    expect(first.operations[0].choices.filter(c => c.kind === 'vision').every(c => !c.options.some(o => o.optionId === modelKey(text)))).toBe(true)
    const chosen = first.operations[0].choices.find(c => c.path === 'vision.target')!
    const next = planCatalog(state, intents(state), [{ id: chosen.id, optionId: enabled ? 'disable' : 'clear' }, ...(!enabled ? resolutions(first).filter(r => r.id !== chosen.id) : [])])
    expect(next.operations[0].blockedReasons).toEqual([]); expect(next.after.config.vision.enabled).toBe(false)
    expect(next.after.config.vision.target).toBeUndefined(); expect(next.after.config.auto.roles.vision.target).toBeUndefined()
    expect(next.operations[0].references).toHaveLength(2)
    const replaced = planCatalog(state, intents(state), resolutions(first, () => modelKey(image)))
    expect(replaced.after.config.vision.target).toEqual(image); expect(replaced.after.config.vision.enabled).toBe(enabled)
  })
  it('视觉仅用旧兜底时必须关闭或图片替换，不能留下已开启但无目标的配置', () => {
    const state = fixture(); state.config.vision.enabled = true; state.config.auto.roles.vision.target = '@deepseek-v4-1'
    const first = planCatalog(state, intents(state))
    expect(first.operations[0].choices[0].options.map(o => o.optionId)).toEqual(['disable', modelKey(image)])
  })
  it('跨模型替换检查旧推理参数，明确使用默认后清理，不更改输出上限', () => {
    const state = fixture(); state.config.auto.main = { target: '@deepseek-v4-1', reasoningEffort: 'high', maxOutputTokens: 99 }
    const first = planCatalog(state, intents(state)), picked = resolutions(first, () => modelKey(text))
    const mid = planCatalog(state, intents(state), picked), parameter = mid.operations[0].choices.find(c => c.kind === 'parameter')!
    expect(mid.operations[0].blockedReasons.join()).toContain('旧推理档位')
    const next = planCatalog(state, intents(state), [...picked, { id: parameter.id, optionId: 'default' }])
    expect(next.after.config.auto.main).toEqual({ target: text, maxOutputTokens: 99 })
  })
  it('非法／不存在／重复／带未知键删除拒绝；未选中操作不写入', () => {
    const state = fixture()
    for (const op of [{ kind: 'removeAlias', name: '@deepseek-v4-1' }, { kind: 'removeAlias', name: 'missing' }, { kind: 'removeAlias', name: 'deepseek-v4-1', force: true }]) expect(() => manualIntents([op], state)).toThrow()
    expect(() => manualIntents([{ kind: 'removeAlias', name: 'deepseek-v4-1' }, { kind: 'removeAlias', name: 'deepseek-v4-1' }], state)).toThrow('重复')
    expect(planCatalog(state, intents(state), [], []).after).toEqual(state)
  })
})
