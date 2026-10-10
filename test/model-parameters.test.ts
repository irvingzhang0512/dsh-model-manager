import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, migrateConfig, modelKey, probeSuggestions, validateConfig } from '../src/domain.ts'
import { describeParameterTargets, validateParameterSuggestions, validateParameterModel, defaultParameterFields, parameterIntents, parameterFields, type ParameterAnalysis } from '../src/model-parameters.ts'
import { planCatalog } from '../src/catalog-state.ts'
import { cleanLegacyImages, legacyImageOverrides, preserveLegacyImages } from '../src/legacy-image.ts'
import { platformOfficialHosts, publicAddress } from '../src/parameter-analysis.ts'
import type { CatalogState } from '../src/catalog-types.ts'

const model = { providerId: 'gateway', modelId: 'same' }, other = { providerId: 'other', modelId: 'same' }
function fixture(): CatalogState {
  return { config: structuredClone(DEFAULT_CONFIG), models: [], overrides: {}, profiles: [{ providerId: 'gateway', ns: 'llm-pi-ai', path: ['providers', 'gateway'], minimumModels: 1, explicit: true, models: [{ id: 'same', contextWindow: 1000, compat: { supportsStore: true, requiresToolResultName: true }, custom: { keep: true } }], effective: { api: 'openai-completions' }, user: { models: [{ id: 'same', contextWindow: 1000, compat: { supportsStore: true, requiresToolResultName: true } }] } }], records: [{ ...model, name: '重名', loaded: true, source: 'host', nativeImage: 'yes', reasoningEfforts: [{ id: 'high', name: 'High' }], contextWindow: 1000 }, { ...other, name: '重名', loaded: true, source: 'host', nativeImage: 'no', reasoningEfforts: [] }] }
}
const page = { url: 'https://docs.example.com/same', text: 'gateway provides same with context 2000 and max output 500. supportsStore false.', links: [], fetchedAt: 'now' }
const result = (field: string[], value: unknown, basis = 'official') => ({ suggestions: [{ field, value, basis, reason: '平台原文明确参数', ...(basis === 'official' ? { evidence: [{ source: page.url, quote: page.text }] } : {}) }], notes: [] })
function analyze(state = fixture(), fields = [['contextWindow'], ['maxTokens'], ['compat', 'supportsStore']], values: unknown[] = [2000, 500, false]): ParameterAnalysis {
  const target = describeParameterTargets(state, {})[0]
  return { analyzer: model, analysisTimeoutSeconds: 180, searchCount: 1, analysisCount: 1, results: [{ model, status: 'ready', notes: [], suggestions: fields.flatMap((f, i) => validateParameterSuggestions(result(f, values[i]), target, [page])) }] }
}
describe('模型参数边界与来源', () => {
  it('搜索引用严格校验原始类型，不能把布尔／对象强转成合法名称', () => {
    for (const value of [false, true, null, 42, { toString: () => 'KEY' }, '', 'invalid-key']) expect(() => validateConfig({ ...structuredClone(DEFAULT_CONFIG), parameterCompletion: { searchCredentialName: value } } as any)).toThrow()
    for (const value of [null, false, [], 'KEY']) expect(() => validateConfig({ ...structuredClone(DEFAULT_CONFIG), parameterCompletion: value } as any)).toThrow()
  })
  it('组合校验使用已冻结的目录 compat，而不隐式写入继承字段', () => {
    const state = fixture(), key = modelKey(model)
    state.profiles[0].models[0].reasoningEfforts = { off: null, high: 'high' }
    state.parameterModels = { [key]: { id: 'same', compat: { thinkingFormat: 'deepseek' } } }
    const analysis = analyze(state, [['compat', 'supportsReasoningEffort']], [false])
    const plan = planCatalog(state, parameterIntents(state, analysis, [analysis.results[0].suggestions[0].id]))
    expect(plan.operations[0].blockedReasons).toEqual([])
    expect(plan.after.profiles[0].models[0].compat).not.toHaveProperty('thinkingFormat')
  })
  it('重名与跨 Provider 同 ID 隔离，未适配平台不可写', () => {
    const targets = describeParameterTargets(fixture(), {})
    expect(targets.map(t => t.model)).toEqual([model, other]); expect(targets[1].writable).toBe(false)
    expect(targets[0].currentSources.contextWindow).toBe('user')
  })
  it('没有显式值时分别证明 catalog、路由默认、运行默认；数值相同也不猜来源', () => {
    const state = fixture(), p = state.profiles[0]; p.models = [{ id: 'same' }]; p.user = { defaultMaxTokens: 32768 }; p.effective = { api: 'openai-completions', defaultMaxTokens: 32768 }; p.addConstraints = { declared: true, missing: [] }
    const target = describeParameterTargets(state, { gateway: { same: { id: 'same', name: 'catalog name', contextWindow: 262144, reasoningEfforts: { off: null, high: 'wire-high' } } } })[0]
    expect(target.currentSources).toMatchObject({ contextWindow: 'catalog', maxTokens: 'provider-default', input: 'runtime-default', reasoningEfforts: 'catalog' })
    expect(target.currentValues.reasoningEfforts).toEqual({ off: null, high: 'wire-high' })
    delete p.user.defaultMaxTokens
    expect(describeParameterTargets(state, {})[0].currentSources.maxTokens).toBe('runtime-default')
  })
  it('叶字段来源独立，Provider compat 可覆盖目录，未选嵌套字段保留', () => {
    const state = fixture(); state.profiles[0].effective!.compat = { supportsUsageInStreaming: false }
    const target = describeParameterTargets(state, {})[0]
    expect(target.currentSources['compat.supportsStore']).toBe('user'); expect(target.currentSources['compat.supportsUsageInStreaming']).toBe('provider-default')
    const a = analyze(state), chosen = a.results[0].suggestions.at(-1)!
    const plan = planCatalog(state, parameterIntents(state, a, [chosen.id]))
    expect(plan.operations[0].blockedReasons).toEqual([])
    expect(plan.after.profiles[0].models[0]).toMatchObject({ compat: { supportsStore: false, requiresToolResultName: true }, custom: { keep: true } })
  })
  it.each(['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses', 'anthropic-messages', 'bedrock-converse-stream'])('协议字段白名单：%s', api => {
    const fields = parameterFields('llm-pi-ai', api).map(f => f.field.join('.'))
    expect(fields).not.toContain('id'); expect(fields).not.toContain('compat.openRouterRouting')
    expect(fields.includes('compat.thinkingFormat')).toBe(api === 'openai-completions')
    expect(fields.includes('compat.allowEmptySignature')).toBe(api === 'anthropic-messages')
  })
  it('DeepSeek 的全部公开模型字段，不伪造模型推理/compat', () => {
    const fields = parameterFields('llm-deepseek', 'deepseek').map(f => f.field.join('.'))
    expect(fields).toContain('systemPromptUpdate'); expect(fields).toContain('imageMaxBytes'); expect(fields).not.toContain('reasoningEfforts')
  })
  it('仅 official 缺失/兜底默认选中，最大输出、名称、知识、已有值都不默认选中', () => {
    const state = fixture(); state.profiles[0].models = [{ id: 'same' }]; state.profiles[0].user = {}; state.profiles[0].addConstraints = { declared: true, missing: [] }
    const a = analyze(state); expect(defaultParameterFields(a)).toEqual([a.results[0].suggestions[0].id, a.results[0].suggestions[2].id])
    expect(defaultParameterFields(analyze())).toEqual([])
    a.results[0].suggestions[0].basis = 'knowledge'; expect(defaultParameterFields(a)).not.toContain(a.results[0].suggestions[0].id)
  })
  it('非法类型、未知路径、原型污染、重复、伪造证据和未知携值被拒绝，合法 false 可用', () => {
    const target = describeParameterTargets(fixture(), {})[0]
    expect(validateParameterSuggestions(result(['compat', 'supportsStore'], false), target, [page])[0].value).toBe(false)
    for (const input of [result(['id'], 'x'), result(['contextWindow'], false), result(['__proto__'], {}), result(['contextWindow'], 1, 'unknown'), result(['contextWindow'], 1, 'knowledge') && { suggestions: [{ field: ['contextWindow'], value: 1, basis: 'official', reason: 'x', evidence: [{ source: page.url, quote: 'invented' }] }], notes: [] }]) expect(() => validateParameterSuggestions(input, target, [page])).toThrow()
    const duplicate = result(['contextWindow'], 2000); duplicate.suggestions.push(duplicate.suggestions[0]); expect(() => validateParameterSuggestions(duplicate, target, [page])).toThrow('重复')
    expect(() => validateParameterSuggestions(result(['compat', 'chatTemplateKwargs'], { effort: { $var: 'thinking.effort', omitWhenOff: true } }), target, [page])).not.toThrow()
  })
  it('完整 reasoning 映射及组合校验，不把 label 当 wire', () => {
    const target = describeParameterTargets(fixture(), {})[0]
    expect(validateParameterSuggestions(result(['reasoningEfforts'], { off: null, high: 'enabled' }), target, [page])[0].value).toEqual({ off: null, high: 'enabled' })
    for (const value of [{ off: null }, { high: null }, { invalid: 'high' }, {}]) expect(() => validateParameterSuggestions(result(['reasoningEfforts'], value), target, [page])).toThrow()
    expect(() => validateParameterModel({ id: 'same', contextWindow: 100, maxTokens: 200 }, 'llm-pi-ai', 'openai-completions')).toThrow('上下文')
    expect(() => validateParameterModel({ id: 'same', reasoningEfforts: { high: 'yes' }, compat: { supportsReasoningEffort: false } }, 'llm-pi-ai', 'openai-completions')).toThrow('不兼容')
  })
  it('opaque 选择拒绝未知/重复，单模型分组，不允许任意路径', () => {
    const state = fixture(), a = analyze(state), ids = a.results[0].suggestions.map(s => s.id)
    expect(parameterIntents(state, a, ids)).toHaveLength(1)
    expect(() => parameterIntents(state, a, ['fake'])).toThrow(); expect(() => parameterIntents(state, a, [ids[0], ids[0]])).toThrow()
  })
  it('图片与别名/AUTO/旧主模型/未来覆盖推理冲突明确解决，停用 preferences 不复活', () => {
    const state = fixture(), k = modelKey(model)
    state.profiles[0].models[0].input = ['text', 'image']; (state.profiles[0].user!.models as any[])[0].input = ['text', 'image']
    state.config.aliases.a = { candidates: [model], efforts: { [k]: 'high' } }; state.config.auto.main = { target: model, reasoningEffort: 'high' }; state.overrides.session = { nextTurn: { target: '@a', reasoningEffort: 'high' } }; state.config.vision = { enabled: true, policy: 'sidecar-only', target: '@a' }; state.config.auto.preferences = { old: { target: model, reasoningEffort: 'invented' } }
    const a = analyze(state, [['reasoningEfforts'], ['input']], [{ off: null, low: 'wire-low' }, ['text']]), intents = parameterIntents(state, a, a.results[0].suggestions.map(s => s.id))
    const initial = planCatalog(state, intents); expect(initial.operations[0].blockedReasons.length).toBeGreaterThanOrEqual(4); expect(initial.after).toEqual(state)
    const resolved = planCatalog(state, intents, initial.operations[0].choices.map(c => ({ id: c.id, optionId: c.kind === 'vision' ? 'disable' : 'default' })))
    expect(resolved.operations[0].blockedReasons).toEqual([]); expect(resolved.after.config.vision.enabled).toBe(false); expect(resolved.after.config.auto.main.reasoningEffort).toBeUndefined(); expect(resolved.after.overrides.session.nextTurn!.reasoningEffort).toBeUndefined(); expect(resolved.after.config.auto.preferences).toEqual(state.config.auto.preferences)
  })
})
describe('旧图片声明生命周期与公开地址', () => {
  it.each([1,2,3])('v%s 忽略任何旧图片值，迁移幂等且无原始写入', version => {
    const raw = { ...structuredClone(DEFAULT_CONFIG), version, models: { unloaded: { capability: { image: { invalid: true }, contextWindow: 100, unknown: 42 }, custom: true } } }, original = structuredClone(raw)
    const config = migrateConfig(raw)
    expect(config.models.unloaded.capability).toEqual({ contextWindow: 100, unknown: 42 }); expect(migrateConfig(config)).toEqual(config); expect(raw).toEqual(original)
  })
  it('只清理本次导致的空包装，普通保存不补回已清理字段，恢复后仍忽略', () => {
    const raw = { models: { a: { capability: { image: false } }, b: { capability: { image: 'yes', custom: true } }, c: { capability: {} }, d: { capability: { image: 'no' }, tiers: { low: 'low' } } } }
    expect(legacyImageOverrides(raw)).toHaveLength(3)
    const cleaned = cleanLegacyImages(raw); expect(cleaned).toEqual({ b: { capability: { custom: true } }, c: { capability: {} }, d: { tiers: { low: 'low' } } })
    const saved = { models: structuredClone(cleaned) }; preserveLegacyImages(saved, { models: cleaned }); expect(saved.models).toEqual(cleaned)
    expect(probeSuggestions([{ kind: 'image', status: 'rejected' } as any])).toEqual([])
  })
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.16.2.3', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', '2001:db8::1'])('拒绝私网/保留地址 %s', address => expect(publicAddress(address)).toBe(false))
  it('只核实本平台站点，网关不能套用基础模型平台', () => {
    expect(publicAddress('8.8.8.8')).toBe(true); expect(platformOfficialHosts('arkcli-agent-plan')).toContain('docs.volcengine.com')
    expect(platformOfficialHosts('openai', 'private-gateway.example')).toEqual([]); expect(platformOfficialHosts('myroute', 'api.deepseek.com')).toEqual(['api-docs.deepseek.com'])
  })
})
