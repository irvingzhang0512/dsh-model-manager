import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { apply } from '../src/index.ts'
import { DEFAULT_CONFIG, modelKey, managedId } from '../src/domain.ts'
import { html, analysis, source } from './official-fixtures.ts'
import { resolveDataDir } from '../src/service.ts'

let temporary: string | undefined
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); if (temporary) await rm(temporary, { recursive: true, force: true }); delete process.env.DSH_HOME })

async function fixture(explicit = true) {
  temporary = await mkdtemp(join(tmpdir(), 'dmm-official-')); process.env.DSH_HOME = temporary
  const old = { providerId: 'deepseek-official', modelId: 'old-fast' }
  const config = structuredClone(DEFAULT_CONFIG)
  config.aliases.main = { candidates: [old], efforts: { [modelKey(old)]: 'high' } }
  config.models[modelKey(old)] = { capability: { image: 'yes' } }
  const originalModels = [{ id: 'old-fast', name: 'old', maxTokens: 99, custom: 'keep' }, { id: 'pro', name: 'pro' }]
  const raw: Record<string, any> = { 'dsh-model-manager': config, 'llm-deepseek': { apiKeyEnv: 'PRIVATE_KEY', ...(explicit ? { models: originalModels } : {}) }, 'agent-default-model': { provider: 'reader', model: 'reader' }, 'subagent-model-selection': { enabled: true, allowedModels: [{ provider: old.providerId, model: old.modelId }] } }
  const rev: Record<string, number> = Object.fromEntries(Object.keys(raw).map(ns => [ns, 1]))
  const routes = new Map<string, Function>(), disposed: Function[] = []
  let failureNamespace = '', failureOnce = false, outputMode = 'normal', analyses = 0
  const get = (ns: string) => structuredClone(ns === 'llm-deepseek' ? { ...raw[ns], models: raw[ns].models ? raw[ns].models.map(({ custom: _custom, ...model }: any) => model) : originalModels } : raw[ns])
  const settings = {
    get, register: () => ({ watch: () => () => {} }),
    describe: () => Object.keys(raw).map(ns => ({ ns, revision: rev[ns], value: get(ns), user: structuredClone(raw[ns]) })),
    mutate: async (ns: string, ops: any[], expected: number) => {
      if (rev[ns] !== expected) throw Error('SETTINGS_CONFLICT')
      if (failureNamespace === ns && failureOnce) { failureOnce = false; throw Error('injected write failure') }
      const next = structuredClone(raw[ns])
      for (const op of ops) {
        let node = next
        for (const key of op.path.slice(0, -1)) node = node[key] ??= {}
        const key = op.path.at(-1)
        if (op.op === 'unset') delete node[key]; else node[key] = structuredClone(op.value)
      }
      raw[ns] = next; rev[ns]++
    },
    replace: async (ns: string, next: unknown, expected: number) => { if (rev[ns] !== expected) throw Error('SETTINGS_CONFLICT'); raw[ns] = structuredClone(next); rev[ns]++ },
  }
  const runtime = {
    listProviders: () => [{ id: 'deepseek-official' }, { id: 'reader' }], listConfigurableProviders: () => [],
    listModels: async (provider: string) => provider === 'reader' ? [{ id: 'reader', name: 'reader' }] : get('llm-deepseek').models,
    resolveModelInfo: async (provider: string, id: string) => provider === 'reader' ? { id, name: 'reader', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } } : get('llm-deepseek').models.find((model: any) => model.id === id),
    registerAdapter: () => () => {},
    stream: vi.fn(async function* (options: any) {
      analyses++
      const page = JSON.parse(options.messages[1].content[0].text).pages[0]
      const value = analysis(['fast', 'pro'], ['old-fast'], page)
      if (outputMode === 'invalid') value.models[0].evidence[0].quote = 'invented quote'
      if (outputMode === 'missing-notes') delete (value as Partial<typeof value>).notes
      if (outputMode === 'paused') await new Promise<void>((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); setTimeout(resolve, 25) })
      yield { type: 'text-delta', text: JSON.stringify(value) }; yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['fast', 'pro'], ['old-fast']))))
  const ctx = { settings, llm: runtime, tools: { register: () => () => {} }, subagents: {}, attachments: {}, systemPrompt: { section: () => () => {} }, webServer: { register: (route: any) => { if (routes.has(route.path)) throw Error('duplicate route'); routes.set(route.path, route.handler); return () => {} } }, on: () => () => {}, effect: (fn: Function) => { const dispose = fn(); if (typeof dispose === 'function') disposed.push(dispose) }, logger: { error: () => {} } }
  apply(ctx as never)
  await new Promise(resolve => setTimeout(resolve, 15))
  const prepare = (path: string, value: unknown, headers: Record<string, string> = {}, method = 'POST') => {
    const result = { status: 0, body: '', writableEnded: false, destroyed: false, headersSent: false }
    const res = Object.assign(new EventEmitter(), result, { writeHead(status: number) { this.status = status; this.headersSent = true }, setHeader() {}, write(chunk: string) { this.body += chunk; return true }, end(chunk = '') { this.body += chunk; this.writableEnded = true } })
    const req = { method, headers: { host: '127.0.0.1:3082', ...headers }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)) } }
    const run = () => routes.get(`/api/model-manager/${path}`)!(req, res)
    return { run, res }
  }
  const call = async (path: string, value: unknown = {}, headers: Record<string, string> = {}, method = 'POST') => { const { run, res } = prepare(path, value, headers, method); await run(); return { status: res.status, json: JSON.parse(res.body) } }
  const backupPath = () => join(resolveDataDir(), 'official-sync-backup.json')
  return { raw, rev, call, prepare, runtime, get, disposed, backupPath, analyses: () => analyses, mode: (value: string) => { outputMode = value }, fail: (ns: string) => { failureNamespace = ns; failureOnce = true } }
}

describe('官方同步宿主完整写集', () => {
  it('缺少必填字段的格式错误经 SSE 明确反馈，不提供结果或写配置', async () => {
    const f = await fixture(), original = structuredClone(f.raw), revisions = structuredClone(f.rev)
    f.mode('missing-notes')
    const request = f.prepare('official-preview', { sourceUrl: source, analysisTimeoutSeconds: 60 }, { accept: 'text/event-stream' })
    await request.run()
    expect(request.res.body).toContain('event: error'); expect(request.res.body).toContain('notes 必须是字符串数组')
    expect(request.res.body).not.toContain('event: result'); expect(request.res.writableEnded).toBe(true)
    expect(f.raw).toEqual(original); expect(f.rev).toEqual(revisions)
    await expect(readFile(f.backupPath())).rejects.toMatchObject({ code: 'ENOENT' })
    f.disposed.forEach(dispose => dispose())
  })
  it('挂起适配器的超时结束 SSE，不写配置且新刷新作废旧预览', async () => {
    const f = await fixture(), original = structuredClone(f.raw), revisions = structuredClone(f.rev)
    const previous = await f.call('official-preview', { sourceUrl: source })
    vi.useFakeTimers()
    const returned = vi.fn(() => new Promise<never>(() => {}))
    f.runtime.stream.mockImplementation((() => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}), return: returned }) })) as never)
    const request = f.prepare('official-preview', { sourceUrl: source, analysisTimeoutSeconds: 60 }, { accept: 'text/event-stream' })
    const pending = request.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(request.res.body).toContain('"stage":"analyzing"')
    await vi.advanceTimersByTimeAsync(60_000)
    await pending
    expect(request.res.body).toContain('event: error'); expect(request.res.body).toContain('60 秒')
    expect(request.res.body).not.toContain('event: result'); expect(request.res.writableEnded).toBe(true)
    expect(f.raw).toEqual(original); expect(f.rev).toEqual(revisions)
    expect((await f.call('official-apply', { token: previous.json.token, selected: previous.json.diffs.map((d: any) => d.id) })).status).toBe(400)
    await expect(readFile(f.backupPath())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(returned).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
    f.disposed.forEach(dispose => dispose())
  })
  it('临时参数无需保存；显式宿主默认覆盖旧 analyzer，应用不保存临时偏好', async () => {
    const f = await fixture()
    f.raw['dsh-model-manager'].official = { sourceUrl: source, analyzer: { providerId: 'deepseek-official', modelId: 'old-fast' } }
    const original = structuredClone(f.raw), revisions = structuredClone(f.rev)
    const p = await f.call('official-preview', { sourceUrl: source, analyzer: null, reasoningEffort: 'high', analysisTimeoutSeconds: 300 })
    expect(p.status, JSON.stringify(p.json)).toBe(200)
    expect(p.json).toMatchObject({ analyzer: { providerId: 'reader', modelId: 'reader' }, reasoningEffort: 'high', analysisTimeoutSeconds: 300 })
    expect(f.runtime.stream.mock.calls.at(-1)![0]).toMatchObject({ provider: 'reader', model: 'reader', reasoningEffort: 'high' })
    expect(f.raw).toEqual(original); expect(f.rev).toEqual(revisions)
    const applied = await f.call('official-apply', { token: p.json.token, selected: p.json.diffs.map((d: any) => d.id) })
    expect(applied.status, JSON.stringify(applied.json)).toBe(200)
    expect(f.raw['dsh-model-manager'].official).toMatchObject({ sourceUrl: source, analyzer: { providerId: 'deepseek-official', modelId: 'fast' } })
    expect(f.raw['dsh-model-manager'].official).not.toHaveProperty('reasoningEffort')
    expect(f.raw['dsh-model-manager'].official).not.toHaveProperty('analysisTimeoutSeconds')
    expect(JSON.parse(await readFile(f.backupPath(), 'utf8')).analysisTimeoutSeconds).toBe(300)
    expect(JSON.parse(await readFile(f.backupPath(), 'utf8')).reasoningEffort).toBe('high')
    const defaults = await f.call('official-preview', { sourceUrl: source, analyzer: null })
    expect(defaults.status).toBe(200); expect(defaults.json).not.toHaveProperty('reasoningEffort')
    expect(defaults.json.analysisTimeoutSeconds).toBe(180)
    expect(f.runtime.stream.mock.calls.at(-1)![0]).not.toHaveProperty('reasoningEffort')
  })
  it.each([null, '180', '', 29, 601, 30.5])('非法临时时限 %s 不读取网页或写配置，并作废旧 token', async value => {
    const f = await fixture(), original = structuredClone(f.raw), revisions = structuredClone(f.rev)
    const previous = await f.call('official-preview', { sourceUrl: source })
    vi.mocked(fetch).mockClear(); f.runtime.stream.mockClear()
    const p = await f.call('official-preview', { sourceUrl: source, analysisTimeoutSeconds: value })
    expect(p.status).toBe(400); expect(p.json.error).toContain('30–600')
    expect(fetch).not.toHaveBeenCalled(); expect(f.runtime.stream).not.toHaveBeenCalled()
    expect(f.raw).toEqual(original); expect(f.rev).toEqual(revisions)
    expect((await f.call('official-apply', { token: previous.json.token, selected: previous.json.diffs.map((d: any) => d.id) })).status).toBe(400)
    await expect(readFile(f.backupPath())).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('默认时限和宿主开始时间经 SSE 下发；旧 v2 备份缺少时限仍可恢复', async () => {
    const f = await fixture(), original = structuredClone(f.raw)
    const request = f.prepare('official-preview', { sourceUrl: source }, { accept: 'text/event-stream' })
    await request.run()
    const events = request.res.body.split('\n\n').filter(part => part.startsWith('event:')).map(part => ({ type: part.split('\n')[0], value: JSON.parse(part.split('\ndata: ')[1]) }))
    const progress = events.find(event => event.value.stage === 'analyzing')!.value
    expect(progress.analysisTimeoutSeconds).toBe(180); expect(Number.isFinite(Date.parse(progress.analysisStartedAt))).toBe(true)
    const p = events.find(event => event.type === 'event: result')!.value
    expect(p.analysisTimeoutSeconds).toBe(180)
    expect((await f.call('official-apply', { token: p.token, selected: p.diffs.map((d: any) => d.id) })).status).toBe(200)
    const backup = JSON.parse(await readFile(f.backupPath(), 'utf8')); delete backup.analysisTimeoutSeconds
    await writeFile(f.backupPath(), JSON.stringify(backup))
    expect((await f.call('official-restore')).status).toBe(200)
    expect(f.raw).toEqual(original)
    f.disposed.forEach(dispose => dispose())
  })
  it.each(['invalid', '', null, 1])('非法临时推理档位 %s 不读取网页或写配置', async effort => {
    const f = await fixture(), original = structuredClone(f.raw)
    const p = await f.call('official-preview', { sourceUrl: source, analyzer: null, reasoningEffort: effort })
    expect(p.status).toBe(400); expect(f.analyses()).toBe(0); expect(fetch).not.toHaveBeenCalled(); expect(f.raw).toEqual(original)
  })
  it.each([true, false])('显式数组=%s：迁移、默认模型／Subagent／覆盖、恢复及重复同步', async explicit => {
    const f = await fixture(explicit)
    // 选择分析模型独立于默认，默认模型也迁移。
    f.raw['agent-default-model'] = { provider: 'deepseek-official', model: 'old-fast', other: 'keep' }
    await f.call('overrides', { sessionId: 'session-1', scope: 'session', selection: { target: { providerId: 'deepseek-official', modelId: 'old-fast' } } }, {}, 'PUT')
    const preview = await f.call('official-preview', { sourceUrl: source, analyzer: { providerId: 'reader', modelId: 'reader' } })
    expect(preview.status, JSON.stringify(preview.json)).toBe(200)
    expect(preview.json.diffs).toHaveLength(1)
    const result = await f.call('official-apply', { token: preview.json.token, selected: preview.json.diffs.map((d: any) => d.id) })
    expect(result.status, JSON.stringify(result.json)).toBe(200)
    expect(f.raw['llm-deepseek'].models.map((m: any) => m.id)).toEqual(['fast', 'pro'])
    expect(f.raw['llm-deepseek']).toMatchObject({ apiKeyEnv: 'PRIVATE_KEY' }); expect(f.raw['llm-deepseek'].models[0]).toMatchObject({ maxTokens: 99, custom: 'keep' })
    expect(f.raw['agent-default-model']).toMatchObject({ model: 'fast', other: 'keep' }); expect(f.raw['subagent-model-selection'].allowedModels[0].model).toBe('fast')
    expect((await f.call('overrides', {}, {}, 'GET')).status).toBe(400) // 需要 sessionId，不误读其他会话。
    expect(result.json.snapshot.config.models[modelKey({ providerId: 'deepseek-official', modelId: 'fast' })]).toEqual({ capability: { image: 'yes' } })
    expect(managedId(result.json.snapshot.config.aliases.main.candidates[0])).toBe('deepseek-official/fast')
    const fresh = await f.call('official-preview', { sourceUrl: source, analyzer: { providerId: 'reader', modelId: 'reader' } })
    expect(fresh.json.diffs).toEqual([])
    expect((await f.call('official-apply', { token: preview.json.token, selected: preview.json.diffs.map((d: any) => d.id) })).status).toBe(400)
    const restored = await f.call('official-restore')
    expect(restored.status, JSON.stringify(restored.json)).toBe(200)
    expect(f.get('llm-deepseek').models.map((m: any) => m.id)).toEqual(['old-fast', 'pro'])
    expect(Object.hasOwn(f.raw['llm-deepseek'], 'models')).toBe(explicit)
    expect(f.raw['agent-default-model'].model).toBe('old-fast'); expect(f.raw['subagent-model-selection'].allowedModels[0].model).toBe('old-fast')
    expect(managedId(restored.json.snapshot.config.aliases.main.candidates[0])).toBe('deepseek-official/old-fast')
    expect(restored.json.snapshot.config.models[modelKey({ providerId: 'deepseek-official', modelId: 'old-fast' })]).toEqual({ capability: { image: 'yes' } })
    expect((await f.call('official-restore')).status).toBe(409)
  })
  it('settings revision 与未来覆盖变化拒绝应用；编造证据不写配置', async () => {
    const f = await fixture()
    const p = await f.call('official-preview', { sourceUrl: source }); f.rev['subagent-model-selection']++
    expect((await f.call('official-apply', { token: p.json.token, selected: p.json.diffs.map((d: any) => d.id) })).status).toBe(409)
    const fresh = await f.call('official-preview', { sourceUrl: source })
    await f.call('overrides', { sessionId: 's', scope: 'nextTurn', selection: { maxOutputTokens: 55 } }, {}, 'PUT')
    expect((await f.call('official-apply', { token: fresh.json.token, selected: fresh.json.diffs.map((d: any) => d.id) })).status).toBe(409)
    f.mode('invalid'); expect((await f.call('official-preview', { sourceUrl: source })).status).toBe(400)
    expect(f.raw['llm-deepseek'].models[0].id).toBe('old-fast')
    expect((await f.call('official-apply', { token: fresh.json.token, selected: fresh.json.diffs.map((d: any) => d.id) })).status).toBe(400)
  })
  it('部分写入失败回滚已写模型、插件配置，不覆盖其他分节', async () => {
    const f = await fixture(), original = structuredClone(f.raw)
    const p = await f.call('official-preview', { sourceUrl: source }); f.fail('subagent-model-selection')
    const result = await f.call('official-apply', { token: p.json.token, selected: p.json.diffs.map((d: any) => d.id) })
    expect(result.status).toBe(400); expect(result.json.error).toContain('已回滚'); expect(f.raw).toEqual(original)
    expect(JSON.parse(await readFile(f.backupPath(), 'utf8')).status).toBe('rolled-back')
    expect((await f.call('official-restore')).status).toBe(409)
  })
  it('同步后任一涉及分节再修改，恢复拒绝覆盖', async () => {
    const f = await fixture(), p = await f.call('official-preview', { sourceUrl: source })
    await f.call('official-apply', { token: p.json.token, selected: p.json.diffs.map((d: any) => d.id) })
    f.rev['subagent-model-selection']++; f.raw['subagent-model-selection'].enabled = false
    expect((await f.call('official-restore')).status).toBe(409)
    expect(f.raw['llm-deepseek'].models[0].id).toBe('fast'); expect(f.raw['subagent-model-selection'].enabled).toBe(false)
  })
  it('JSON／POST SSE 进度、取消、方法和信任检查，不注册重复路径', async () => {
    const f = await fixture()
    const request = f.prepare('official-preview', { sourceUrl: source }, { accept: 'text/event-stream' })
    await request.run()
    expect(request.res.body).toContain('event: progress'); expect(request.res.body).toContain('event: result'); expect(request.res.body).toContain('"complete":true')
    expect((await f.call('official-preview', {}, {}, 'GET')).status).toBe(405)
    expect((await f.call('official-preview', {}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await f.call('official-preview', { sources: {} })).status).toBe(400)
    f.mode('paused')
    const canceled = f.prepare('official-preview', { sourceUrl: source }, { accept: 'text/event-stream' })
    const task = canceled.run(); await new Promise(resolve => setTimeout(resolve, 5)); canceled.res.emit('close'); await task
    expect(canceled.res.body).not.toContain('event: result'); expect(canceled.res.body).toContain('取消')
    f.disposed.forEach(dispose => dispose())
  })
})
