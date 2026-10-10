import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { registerOfficialSync } from '../src/official-host.ts'
import { ModelManagerService, resolveDataDir } from '../src/service.ts'
import { DEFAULT_CONFIG, modelKey, managedId } from '../src/domain.ts'

vi.mock('../src/parameter-catalog.ts', () => ({ readParameterCatalog: async () => ({ gateway: { same: { id: 'same', api: 'openai-completions', contextWindow: 1000, maxTokens: 100, input: ['text'], reasoningEfforts: { off: null, high: 'wire-high' } }, spare: { id: 'spare', api: 'openai-completions', contextWindow: 1000, maxTokens: 100, input: ['text'] } } }) }))
vi.mock('../src/parameter-analysis.ts', async original => {
  const actual = await original<typeof import('../src/parameter-analysis.ts')>()
  return { ...actual, createParameterSearch: (...args: Parameters<typeof actual.createParameterSearch>) => ({ ...actual.createParameterSearch(...args), read: async (url: string) => ({ url, text: 'gateway platform offers same context 2000 output 500 text image reasoning high wire-high supportsStore false. gateway platform offers spare context 2000 output 500 text image.', links: [], fetchedAt: 'now' }) }) }
})
let directory: string
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.DSH_HOME; if (directory) await rm(directory, { recursive: true, force: true }) })
async function fixture(explicit = true) {
  directory = await mkdtemp(join(tmpdir(), 'dmm-parameters-')); process.env.DSH_HOME = directory
  const raw: Record<string, any> = { 'dsh-model-manager': structuredClone(DEFAULT_CONFIG), 'agent-default-model': { provider: 'gateway', model: 'same' }, 'llm-pi-ai': { providers: { gateway: { api: 'openai-completions', baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DO_NOT_LEAK', ...(explicit ? { models: [{ id: 'same', contextWindow: 1000, compat: { supportsStore: true, requiresToolResultName: true }, custom: { keep: true } }, { id: 'spare', input: ['text'] }] } : { modelOverrides: { same: { compat: { supportsStore: true, requiresToolResultName: true }, custom: 'keep' } } }) } } } }
  const revisions: Record<string, number> = { 'dsh-model-manager': 1, 'agent-default-model': 1, 'llm-pi-ai': 1 }
  const routes = new Map<string, Function>(), disposers: Function[] = [], requests: any[] = []
  const at = (value: any, path: string[]) => path.reduce((v, k) => v?.[k], value)
  let fail = '', outputMode = '', analyzed = 0, searchMode = '', resolvedKey = ''
  const settings = { get: (ns: string) => structuredClone(raw[ns]), describe: () => Object.keys(raw).map(ns => ({ ns, revision: revisions[ns], user: structuredClone(raw[ns]), value: structuredClone(raw[ns]) })), mutate: async (ns: string, ops: any[], revision: number) => {
    if (revision !== revisions[ns]) throw new Error('SETTINGS_CONFLICT')
    if (fail === ns) { fail = ''; throw new Error('injected failure') }
    const next = structuredClone(raw[ns]); for (const op of ops) { let node = next; for (const k of op.path.slice(0, -1)) node = node[k] ??= {}; if (op.op === 'unset') delete node[op.path.at(-1)]; else node[op.path.at(-1)] = structuredClone(op.value) }
    raw[ns] = next; revisions[ns]++
  } }
  const catalog = async () => ['same', 'spare'].map(id => {
    const profile = raw['llm-pi-ai'].providers.gateway, m = profile.models?.find((m: any) => m.id === id) ?? profile.modelOverrides?.[id] ?? {}
    return { providerId: 'gateway', modelId: id, name: m.name ?? id, source: 'host' as const, loaded: true, nativeImage: (m.input ?? ['text']).includes('image') ? 'yes' as const : 'no' as const, contextWindow: m.contextWindow ?? 1000, defaultMaxTokens: m.maxTokens, reasoningEfforts: m.reasoningEfforts === false ? [] : Object.keys(m.reasoningEfforts ?? { off: null, high: 'wire-high' }).map(id => ({ id, name: id })) }
  })
  const service = new ModelManagerService({ catalog, applyNative: async () => {}, catalogCapabilities: () => [{ providerId: 'gateway', canAdd: true, canRename: true, canRemove: true, minimumModels: 1 }] }, directory, settings as never)
  await service.init()
  const runtime = { listConfigurableProviders: () => [{ provider: 'gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'gateway'] }], listModels: async (p: string) => p === 'deepseek-official' ? [] : ['same', 'spare'].map(id => ({ id, name: id })), resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }] } }), stream: vi.fn(async function* (options: any) {
    analyzed++; requests.push(options)
    const input = JSON.parse(options.messages[1].content[0].text)
    if (outputMode === 'stuck') await new Promise(() => {})
    if (outputMode === 'partial-failure' && input.target.model.modelId === 'same') throw new Error('single failure')
    if (outputMode === 'invalid') { yield { type: 'text-delta', text: 'invalid JSON' }; yield { type: 'finish', reason: { kind: 'stop' } }; return }
    const id = input.target.model.modelId, basis = input.pages.length ? 'official' : 'knowledge'
    const entries = [['contextWindow', 2000], ['maxTokens', 500], ['input', ['text', 'image']], ['reasoningEfforts', { off: null, high: 'wire-high' }], ['compat.supportsStore', false]]
    if (outputMode === 'name') entries.push(['name', '官方名称'])
    const suggestions = input.round === 1 && !input.pages.length ? [] : entries.map(([f, value]) => ({ field: (f as string).split('.'), value, basis, reason: 'platform API', ...(basis === 'official' ? { evidence: [{ source: input.pages[0].url, quote: input.pages[0].text }] } : {}) }))
    yield { type: 'text-delta', text: JSON.stringify({ suggestions, notes: [] }) }; yield { type: 'finish', reason: { kind: 'stop' } }
  }) }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: any) => {
    expect(options.headers.Authorization).toBe('Bearer SECRET_SEARCH'); expect(options.headers['X-Traffic-Tag']).toBe('skill_web_search_common')
    const input = JSON.parse(options.body); expect(input.Query).not.toContain('DO_NOT_LEAK'); expect(input).toMatchObject({ SearchType: 'web', Count: 5, NeedSummary: true })
    if (searchMode === 'fail') return new Response('{}', { status: 401 })
    return Response.json({ Result: { WebResults: [{ Title: 'platform API', Url: 'https://api-docs.deepseek.com/parameters', Summary: 'clue' }] } })
  }))
  registerOfficialSync({ llm: runtime, settings, credentials: { resolve: async (ref: string) => { resolvedKey = ref; return { value: 'SECRET_SEARCH' } } }, webServer: { register: (r: any) => { expect(routes.has(r.path)).toBe(false); routes.set(r.path, r.handler); return () => {} } }, effect: (fn: Function) => { const disposer = fn(); if (disposer) disposers.push(disposer) } } as never, service)
  const prepare = (path: string, input: unknown, headers = {}) => {
    const res = Object.assign(new EventEmitter(), { status: 0, body: '', destroyed: false, writableEnded: false, headersSent: false, writeHead(status: number) { this.status = status; this.headersSent = true }, write(data: string) { this.body += data }, end(data = '') { this.body += data; this.writableEnded = true }, setHeader() {} })
    const req = { method: 'POST', headers: { host: '127.0.0.1:3082', ...headers }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(input)) } }
    return { res, run: () => routes.get(`/api/model-manager/${path}`)!(req, res) }
  }
  const call = async (path: string, input: unknown) => { const request = prepare(path, input); await request.run(); return { status: request.res.status, json: JSON.parse(request.res.body) } }
  return { raw, revisions, call, prepare, service, runtime, disposers, requests, at, searches: () => (globalThis.fetch as any).mock.calls.length, analyzed: () => analyzed, resolvedKey: () => resolvedKey, mode: (mode: string) => { outputMode = mode }, search: (mode: string) => { searchMode = mode }, fail: (ns: string) => { fail = ns } }
}
const models = [{ providerId: 'gateway', modelId: 'same' }]
const preview = (f: Awaited<ReturnType<typeof fixture>>, extra = {}) => f.call('model-parameter-preview', { models, analyzer: null, ...extra })
const allFields = (view: any) => view.parameterAnalysis.results.flatMap((r: any) => r.suggestions.map((s: any) => s.id))
describe('参数补全完整目录事务', () => {
  it('宿主默认的具体管理模型解析真实目标，AUTO/别名在调用前拒绝', async () => {
    const f = await fixture()
    f.raw['agent-default-model'] = { provider: 'dsh-model-manager', model: managedId(models[0]) }
    expect((await preview(f)).json.parameterAnalysis.analyzer).toEqual(models[0])
    const calls = f.analyzed()
    for (const model of ['AUTO', 'alias:test']) {
      f.raw['agent-default-model'].model = model
      expect((await preview(f)).status).toBe(400)
    }
    expect(f.analyzed()).toBe(calls)
  })
  it('部分写入失败反向回滚，后续重新分析可以应用', async () => {
    const f = await fixture(), before = structuredClone(f.raw); f.mode('name')
    const p = await preview(f), r = await f.call('catalog-resolve', { token: p.json.token, selected: [], resolutions: [], selectedFields: allFields(p.json) })
    expect(r.json.writesPlugin).toBe(true); f.fail('llm-pi-ai')
    const a = await f.call('catalog-apply', { token: r.json.token, selected: r.json.selected }); expect(a.status).toBe(400); expect(a.json.error).toContain('回滚'); expect(f.raw).toEqual(before)
    const p2 = await preview(f); expect(p2.status).toBe(200)
  })
  it('普通保存保护已有原始旧图片值，清理后再保存不能复活', async () => {
    const f = await fixture(); f.raw['dsh-model-manager'].models = { unloaded: { capability: { image: false, contextWindow: 123 }, unknown: 'keep' } }; f.service.onSettingsChanged(f.raw['dsh-model-manager'])
    f.raw['dsh-model-manager'].auto.unknownNested = { keep: 'auto' }
    f.raw['dsh-model-manager'].reliability.unknownNested = { keep: 'reliability' }
    const next = f.service.snapshot().config; next.reliability.maxAttempts = 2
    ;(f.service as any).settings.replace = async (ns: string, value: any, revision: number) => { if (revision !== f.revisions[ns]) throw new Error('SETTINGS_CONFLICT'); f.raw[ns] = structuredClone(value); f.revisions[ns]++ }
    await f.service.update(next, 1); expect(f.raw['dsh-model-manager'].models.unloaded.capability.image).toBe(false); expect(f.service.snapshot().config.models.unloaded.capability).not.toHaveProperty('image')
    expect(f.raw['dsh-model-manager'].auto.unknownNested).toEqual({ keep: 'auto' }); expect(f.raw['dsh-model-manager'].reliability.unknownNested).toEqual({ keep: 'reliability' })
    const p = await f.call('catalog-preview', { operations: [{ kind: 'clearLegacyImageOverrides' }] }); const a = await f.call('catalog-apply', { token: p.json.token, selected: ['clearLegacyImageOverrides'] }); expect(a.status).toBe(200)
    await f.service.update(f.service.snapshot().config, f.service.snapshot().revision); expect(f.raw['dsh-model-manager'].models.unloaded.capability).toEqual({ contextWindow: 123 })
  })
  it.each([true, false])('显式数组=%s：逐字段选择、嵌套合并、完整备份和恢复', async explicit => {
    const f = await fixture(explicit), original = structuredClone(f.raw), p = await preview(f)
    expect(p.status, JSON.stringify(p.json)).toBe(200); expect(f.resolvedKey()).toBe('WEB_SEARCH_API_KEY'); expect(f.searches()).toBe(1)
    expect(JSON.stringify(p.json)).not.toContain('SECRET_SEARCH'); expect(JSON.stringify(p.json)).not.toContain('DO_NOT_LEAK'); expect(f.raw).toEqual(original)
    expect(p.json.selectedFields).not.toContain(p.json.parameterAnalysis.results[0].suggestions.find((s: any) => s.field[0] === 'maxTokens').id)
    const r = await f.call('catalog-resolve', { token: p.json.token, selected: p.json.selected, resolutions: [], selectedFields: allFields(p.json) })
    expect(r.status, JSON.stringify(r.json)).toBe(200); expect(r.json.token).not.toBe(p.json.token); expect(f.searches()).toBe(1)
    expect((await f.call('catalog-apply', { token: p.json.token, selected: r.json.selected })).status).toBe(400)
    const a = await f.call('catalog-apply', { token: r.json.token, selected: r.json.selected }); expect(a.status, JSON.stringify(a.json)).toBe(200)
    const profile = f.raw['llm-pi-ai'].providers.gateway, model = explicit ? profile.models[0] : profile.modelOverrides.same
    expect(model).toMatchObject({ contextWindow: 2000, maxTokens: 500, input: ['text', 'image'], compat: { supportsStore: false, requiresToolResultName: true } }); expect(profile.apiKeyEnv).toBe('DO_NOT_LEAK')
    expect(model).not.toHaveProperty('reasoningEfforts') // 内置目录相同的映射不物化为覆盖。
    if (!explicit) expect(profile).not.toHaveProperty('models')
    expect(a.json.snapshot.models[0]).toMatchObject({ nativeImage: 'yes', contextWindow: 2000, defaultMaxTokens: 500 }); expect(a.json.snapshot.parameterBackupId).toBe(a.json.backupId)
    const backup = JSON.parse(await readFile(join(resolveDataDir(), 'catalog-backups', `${a.json.backupId}.json`), 'utf8'))
    expect(backup.origin).toBe('parameter'); expect(backup.selectedFields).toHaveLength(5); expect(backup.parameterAnalysis.results[0].suggestions[0].evidence).toHaveLength(1)
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200); expect(f.raw).toEqual(original); f.disposers.forEach(d => d())
  })
  it('串行去重，单模型失败不阻止其他完成；非法/空目标先拒绝', async () => {
    const f = await fixture(); f.mode('partial-failure')
    for (const invalid of [[], [{ providerId: 'dsh-model-manager', modelId: 'auto' }], [{ providerId: 'gateway', modelId: 'missing' }]]) expect((await preview(f, { models: invalid })).status).toBe(400)
    expect(f.analyzed()).toBe(0); expect(f.searches()).toBe(0)
    const p = await preview(f, { models: [...models, ...models, { providerId: 'gateway', modelId: 'spare' }] })
    expect(p.status).toBe(200); expect(p.json.parameterAnalysis.results.map((r: any) => r.status)).toEqual(['failed', 'ready']); expect(f.analyzed()).toBe(2)
  })
  it('搜索失败知识兜底默认不选；格式错误没有可应用 token', async () => {
    const f = await fixture(); f.search('fail')
    const p = await preview(f); expect(p.status).toBe(200); expect(p.json.selectedFields).toEqual([]); expect(p.json.parameterAnalysis.results[0].suggestions.every((s: any) => s.basis === 'knowledge')).toBe(true)
    expect(p.json.parameterAnalysis.searchCount).toBe(2)
    f.mode('invalid'); const invalid = await preview(f); expect(invalid.json.token).toBe(''); expect(invalid.json.parameterAnalysis.results[0].status).toBe('failed')
  })
  it('基线 revision、目录/未来覆盖变化拒绝应用，恢复拒绝后续编辑', async () => {
    const f = await fixture()
    const selectedPreview = async () => { const p = await preview(f); return f.call('catalog-resolve', { token: p.json.token, selected: [], resolutions: [], selectedFields: allFields(p.json) }) }
    const p = await selectedPreview()
    f.revisions['llm-pi-ai']++; expect((await f.call('catalog-apply', { token: p.json.token, selected: p.json.selected })).status).toBe(409)
    const p2 = await selectedPreview(); f.raw['llm-pi-ai'].providers.gateway.models[0].custom.other = 1
    expect((await f.call('catalog-apply', { token: p2.json.token, selected: p2.json.selected })).status).toBe(409)
    const p3 = await selectedPreview(), a = await f.call('catalog-apply', { token: p3.json.token, selected: p3.json.selected }); expect(a.status).toBe(200)
    f.revisions['llm-pi-ai']++; expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(409)
  })
  it('分析中并发编辑导致冲突，新请求/断开取消忽略 abort 的流', async () => {
    const f = await fixture(); f.mode('stuck')
    const pending = f.prepare('model-parameter-preview', { models }, { accept: 'text/event-stream' }), task = pending.run()
    await vi.waitFor(() => expect(f.analyzed()).toBe(1)); pending.res.emit('close'); await task
    expect(pending.res.body).toContain('event: error'); expect(pending.res.body).not.toContain('event: result')
    f.mode(''); const p = await preview(f); expect(p.status).toBe(200)
  })
  it('每轮时限也终止忽略取消的适配器，批量仍可返回失败项', async () => {
    const f = await fixture(); vi.useFakeTimers(); f.mode('stuck')
    const pending = f.prepare('model-parameter-preview', { models, analysisTimeoutSeconds: 30 }), task = pending.run()
    await vi.waitFor(() => expect(f.analyzed()).toBe(1)); await vi.advanceTimersByTimeAsync(30_001); await task
    const value = JSON.parse(pending.res.body); expect(value.parameterAnalysis.results[0].status).toBe('failed'); expect(value.token).toBe('')
  })
  it('原始旧图片值不执行，清理原始未知模型/空包装并完整恢复；重复清理拒绝', async () => {
    const f = await fixture(); f.raw['dsh-model-manager'].models = { unknown: { capability: { image: { any: 'legacy' } } }, kept: { capability: { image: false, unknown: 1 }, tiers: { high: 'high' } }, empty: { capability: {} } }
    f.service.onSettingsChanged(f.raw['dsh-model-manager']); expect(f.service.snapshot().legacyImageOverrideCount).toBe(2); const before = structuredClone(f.raw)
    const p = await f.call('catalog-preview', { operations: [{ kind: 'clearLegacyImageOverrides' }] }); expect(p.json.counts).toEqual([]); expect(p.json.selected).toEqual([]); expect(p.json.operations[0].before).toHaveLength(2)
    const a = await f.call('catalog-apply', { token: p.json.token, selected: ['clearLegacyImageOverrides'] }); expect(a.status).toBe(200); expect(a.json.snapshot.legacyImageOverrideCount).toBe(0)
    expect(f.raw['dsh-model-manager'].models).toEqual({ kept: { capability: { unknown: 1 }, tiers: { high: 'high' } }, empty: { capability: {} } })
    expect((await f.call('catalog-preview', { operations: [{ kind: 'clearLegacyImageOverrides' }] })).status).toBe(400)
    const restored = await f.call('catalog-restore', { backupId: a.json.backupId }); expect(restored.status).toBe(200); expect(f.raw).toEqual(before); expect(restored.json.snapshot.legacyImageOverrideCount).toBe(2); expect(restored.json.snapshot.config.models.unknown.capability).toEqual({})
  })
  it('搜索引用叶字段 CAS 独立保存/清空，保留未知字段及其他配置', async () => {
    const f = await fixture(), original = structuredClone(f.raw['dsh-model-manager']); f.raw['dsh-model-manager'].parameterCompletion = { unknown: 1 }
    expect((await f.call('parameter-search-credential', { revision: 0, name: 'SEARCH_KEY' })).status).toBe(409)
    const a = await f.call('parameter-search-credential', { revision: 1, name: 'SEARCH_KEY' }); expect(a.status).toBe(200); expect(f.raw['dsh-model-manager']).toEqual({ ...original, parameterCompletion: { unknown: 1, searchCredentialName: 'SEARCH_KEY' } })
    expect((await preview(f)).status).toBe(200); expect(f.resolvedKey()).toBe('SEARCH_KEY')
    const cleared = await f.call('parameter-search-credential', { revision: 2, name: 'WEB_SEARCH_API_KEY' }); expect(cleared.status).toBe(200); expect(f.raw['dsh-model-manager'].parameterCompletion).toEqual({ unknown: 1 })
  })
})
