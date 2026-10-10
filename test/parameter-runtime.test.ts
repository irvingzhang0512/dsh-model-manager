import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyPi } from '@deepseek-ai/dsh-llm-pi-ai'
import { readParameterCatalog } from '../src/parameter-catalog.ts'
import { describeParameterTargets, validateParameterSuggestions, parameterIntents } from '../src/model-parameters.ts'
import { planCatalog } from '../src/catalog-state.ts'
import { DEFAULT_CONFIG } from '../src/domain.ts'
afterEach(() => vi.unstubAllGlobals())
describe('锁定宿主公开目录及实际请求参数', () => {
  it('读取真实安装目录，包含原始 wire 映射，不凭 label 推测', async () => {
    const catalog = await readParameterCatalog({ profiles: [{ providerId: 'deepseek', ns: 'llm-pi-ai' }] } as any)
    expect(catalog['deepseek-official']['deepseek-v4-flash'].contextWindow).toBeGreaterThan(0)
    expect(catalog.deepseek['deepseek-v4-flash'].api).toBe('openai-completions')
    expect(catalog.deepseek['deepseek-v4-flash'].reasoningEfforts).toBeDefined()
  })
  it('参数写集经过宿主严格校验，目录、推理选择和最终请求 max_tokens/reasoning_effort 生效', async () => {
    let adapter: any, section: any
    let raw: any = { providers: { gateway: { api: 'openai-completions', baseURL: 'https://gateway.example/v1', apiKeyEnv: 'TEST_API_KEY', retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'test', contextWindow: 1000, maxTokens: 100, input: ['text'] }] } } }
    const ctx: any = { logger: { warn() {}, error() {} }, get: (name: string) => name === 'credentials' ? { resolve: async () => ({ value: 'TEST_KEY' }) } : undefined, llm: { registerConfigurableProviders: () => ({ replace() {} }), registerModelDiscovery() {}, registerAdapter: (_: unknown, next: unknown) => { adapter = next; return { replace() {} } } }, inject: (names: string[], callback: Function) => { if (names.includes('settings')) callback({ settings: { installSection: (_: unknown, _ns: string, _schema: unknown, _config: unknown, opts: any) => { section = opts; opts.setSource(() => raw) } } }) } }
    applyPi(ctx, raw)
    const beforeInfo = await adapter.resolveModel('gateway', 'test'); expect(beforeInfo.defaultMaxTokens).toBe(100)
    const state: any = { config: structuredClone(DEFAULT_CONFIG), overrides: {}, models: [], profiles: [{ providerId: 'gateway', ns: 'llm-pi-ai', path: [], explicit: true, minimumModels: 1, models: structuredClone(raw.providers.gateway.models), effective: { api: 'openai-completions' }, user: raw.providers.gateway }], records: [{ providerId: 'gateway', modelId: 'test', name: 'test', loaded: true, source: 'host', nativeImage: 'no', reasoningEfforts: [], contextWindow: 1000, defaultMaxTokens: 100 }] }
    const target = describeParameterTargets(state, {})[0]
    const suggestions = validateParameterSuggestions({ suggestions: [
      { field: ['contextWindow'], value: 20000, basis: 'knowledge', reason: 'test' },
      { field: ['maxTokens'], value: 500, basis: 'knowledge', reason: 'test' },
      { field: ['reasoningEfforts'], value: { off: null, high: 'wire-high' }, basis: 'knowledge', reason: 'test' },
      { field: ['compat', 'supportsReasoningEffort'], value: true, basis: 'knowledge', reason: 'test' },
      { field: ['compat', 'maxTokensField'], value: 'max_tokens', basis: 'knowledge', reason: 'test' },
    ], notes: [] }, target, [])
    const analysis: any = { results: [{ model: target.model, suggestions }] }
    const plan = planCatalog(state, parameterIntents(state, analysis, suggestions.map(s => s.id)))
    expect(plan.operations[0].blockedReasons).toEqual([])
    const next = { providers: { gateway: { ...raw.providers.gateway, models: plan.after.profiles[0].models } } }
    expect(() => section.validate(next)).not.toThrow(); raw = next; section.onChange()
    const info = await adapter.resolveModel('gateway', 'test')
    expect(info.context.contextWindow).toBe(20000); expect(info.defaultMaxTokens).toBe(500); expect(info.reasoning.efforts.map((e: any) => e.id)).toEqual(['off', 'high'])
    let payload: any
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      payload = JSON.parse(init.body as string)
      return new Response('data: {"id":"test-response","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"id":"test-response","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }))
    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'gateway', model: 'test', reasoningEffort: 'high', messages: [{ id: 'user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'OK' }] }], signal: new AbortController().signal })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } }); expect(payload).toMatchObject({ model: 'test', max_tokens: 500, reasoning_effort: 'wire-high' })
  })
})
