import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import { apply } from '../src/index.ts'
import { DEFAULT_CONFIG, modelKey, managedId } from '../src/domain.ts'
import { html, analysis, source } from './official-fixtures.ts'
import { resolveDataDir } from '../src/service.ts'

let temporary: string | undefined
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); if (temporary) await rm(temporary, { recursive: true, force: true }); delete process.env.DSH_HOME })

async function fixture(explicit = true, pi = false, absentUser = false, legacy = false, catalog?: { runtime: any[]; base?: any[] }) {
  temporary = await mkdtemp(join(tmpdir(), 'dmm-official-')); process.env.DSH_HOME = temporary
  const old = { providerId: 'deepseek-official', modelId: 'old-fast' }
  const config = structuredClone(DEFAULT_CONFIG)
  if (legacy) config.auto.preferences = { research: { target: '@missing', extra: { nested: 'preserve' } } as any }
  config.aliases.main = { candidates: [old], efforts: { [modelKey(old)]: 'high' } }
  config.models[modelKey(old)] = { capability: { image: 'yes' } }
  const originalModels = [{ id: 'old-fast', name: 'old', maxTokens: 99, custom: 'keep' }, { id: 'pro', name: 'pro' }]
  const raw: Record<string, any> = { 'dsh-model-manager': config, 'llm-deepseek': { apiKeyEnv: 'PRIVATE_KEY', ...(explicit ? { models: originalModels } : {}) }, 'agent-default-model': { provider: 'reader', model: 'reader' }, 'subagent-model-selection': { enabled: true, allowedModels: [{ provider: old.providerId, model: old.modelId }] } }
  if (pi) raw['llm-pi-ai'] = { providers: { reader: { apiKeyEnv: 'PRIVATE_PI_KEY', modelOverrides: { reader: { maxTokens: 77, custom: 'keep' } } } } }
  const rev: Record<string, number> = Object.fromEntries(Object.keys(raw).map(ns => [ns, 1]))
  const routes = new Map<string, Function>(), disposed: Function[] = [], prompts: (() => string)[] = [], hooks = new Map<string, Function>()
  let failureNamespace = '', failureOnce = false, outputMode = 'normal', analyses = 0, managedAdapter: any
  const get = (ns: string) => structuredClone(ns === 'llm-deepseek' ? { ...raw[ns], models: raw[ns].models ? raw[ns].models.map(({ custom: _custom, ...model }: any) => model) : originalModels } : raw[ns])
  const settings = {
    get, register: () => ({ watch: () => () => {} }),
    describe: () => Object.keys(raw).map(ns => ({ ns, revision: rev[ns], value: get(ns), ...(ns === 'llm-deepseek' && catalog?.base ? { base: { models: structuredClone(catalog.base) } } : {}), ...(!absentUser || ns !== 'llm-deepseek' ? { user: structuredClone(raw[ns]) } : {}) })),
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
    listProviders: () => [{ id: 'deepseek-official' }, { id: 'reader' }], listConfigurableProviders: () => pi ? [{ provider: 'reader', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'reader'] }] : [],
    listModels: async (provider: string) => provider === 'reader' ? (pi ? (raw['llm-pi-ai'].providers.reader.models ?? [{ id: 'reader', name: 'reader' }, { id: 'image', name: 'image' }]).map((m: any) => ({ ...m, ...raw['llm-pi-ai'].providers.reader.modelOverrides?.[m.id] })) : [{ id: 'reader', name: 'reader' }]) : get('llm-deepseek').models,
    resolveModelInfo: async (provider: string, id: string) => provider === 'reader' ? { id, name: pi ? raw['llm-pi-ai'].providers.reader.models?.find((m: any) => m.id === id)?.name ?? raw['llm-pi-ai'].providers.reader.modelOverrides?.[id]?.name ?? id : 'reader', inputModalities: id === 'image' ? ['text', 'image'] : ['text'], reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } } : { id, name: id, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }, ...get('llm-deepseek').models.find((model: any) => model.id === id) },
    registerAdapter: (_providers: string[], adapter: any) => { managedAdapter = adapter; return () => {} },
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
  if (catalog) {
    const originalList = runtime.listModels, originalInfo = runtime.resolveModelInfo
    runtime.listModels = async provider => provider === 'deepseek-official' && !raw['llm-deepseek'].models ? structuredClone(catalog.runtime) : originalList(provider)
    runtime.resolveModelInfo = async (provider, id) => provider === 'deepseek-official' && !raw['llm-deepseek'].models ? { id, ...structuredClone(catalog.runtime.find(m => m.id === id)) } : originalInfo(provider, id)
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['fast', 'pro'], ['old-fast']))))
  const ctx = { settings, llm: runtime, tools: { register: () => () => {} }, attachments: {}, systemPrompt: { section: (s: any) => { prompts.push(s.text); return () => {} } }, webServer: { register: (route: any) => { if (routes.has(route.path)) throw Error('duplicate route'); routes.set(route.path, route.handler); return () => {} } }, on: (name: string, fn: Function) => { hooks.set(name, fn); return () => {} }, effect: (fn: Function) => { const dispose = fn(); if (typeof dispose === 'function') disposed.push(dispose) }, logger: { error: () => {} } }
  apply(Object.assign(ctx,{configEditor:{documentPath:join(process.env.DSH_HOME!,'profiles/desktop/cordis.yml')},credentials:{resolve:async()=>undefined}}) as never)
  await new Promise(resolve => setTimeout(resolve, 15))
  await managedAdapter.service.init()
  const prepare = (path: string, value: unknown, headers: Record<string, string> = {}, method = 'POST') => {
    const result = { status: 0, body: '', writableEnded: false, destroyed: false, headersSent: false }
    const res = Object.assign(new EventEmitter(), result, { writeHead(status: number) { this.status = status; this.headersSent = true }, setHeader() {}, write(chunk: string) { this.body += chunk; return true }, end(chunk = '') { this.body += chunk; this.writableEnded = true } })
    const req = { method, headers: { host: '127.0.0.1:3082', ...headers }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)) } }
    const run = () => routes.get(`/api/model-manager/${path}`)!(req, res)
    return { run, res }
  }
  const call = async (path: string, value: unknown = {}, headers: Record<string, string> = {}, method = 'POST') => { const { run, res } = prepare(path, value, headers, method); await run(); return { status: res.status, json: JSON.parse(res.body) } }
  const backupPath = () => {
    const dir = join(resolveDataDir(), 'catalog-backups')
    return existsSync(dir) ? join(dir, readdirSync(dir).find(file => /^[0-9a-f-]{36}\.json$/.test(file)) ?? 'missing.json') : join(resolveDataDir(), 'official-sync-backup.json')
  }
  return { raw, rev, call, prepare, runtime, get, disposed, routes, prompts, hooks, managedAdapter, backupPath, analyses: () => analyses, mode: (value: string) => { outputMode = value }, fail: (ns: string) => { failureNamespace = ns; failureOnce = true } }
}

describe('rc3 官方动态目录与持久覆盖', () => {
  const live = [{ id: 'live-v4', name: '实时官方模型', contextWindow: 1000000, maxTokens: 65536, custom: 'runtime-kept' }]
  it('读取和取消使用宿主实时目录，不把 effective 兜底模型物化', async () => {
    const f = await fixture(false, false, false, false, { runtime: live }), original = structuredClone(f.raw)
    const preview = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: { providerId: 'deepseek-official', modelId: 'live-v4' }, name: '我的名称' }] })
    expect(preview.status, JSON.stringify(preview.json)).toBe(200)
    expect(preview.json.counts.find((p: any) => p.providerId === 'deepseek-official').before).toBe(1)
    expect(f.raw).toEqual(original)
    const applied = await f.call('catalog-apply', { token: preview.json.token, selected: preview.json.selected })
    expect(applied.status, JSON.stringify(applied.json)).toBe(200)
    expect(f.raw['llm-deepseek'].models).toEqual([{ ...live[0], name: '我的名称' }])
    expect((await f.call('catalog-restore', { backupId: applied.json.backupId })).status).toBe(200)
    expect(f.raw).toEqual(original)
  })
  it.each([true, false])('已保存用户／继承目录不自动替换为动态目录，用户层=%s', async user => {
    const inherited = [{ id: 'saved-model', name: '继承目录', custom: { keep: true } }]
    const f = await fixture(user, false, false, false, { runtime: live, ...(!user ? { base: inherited } : {}) }), original = structuredClone(f.raw)
    const id = user ? 'old-fast' : 'saved-model'
    const preview = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: { providerId: 'deepseek-official', modelId: id }, name: '显式编辑' }] })
    expect(preview.status, JSON.stringify(preview.json)).toBe(200)
    expect(preview.json.counts.find((p: any) => p.providerId === 'deepseek-official').before).toBe(user ? 2 : 1)
    expect(f.raw).toEqual(original)
  })
})

describe('旧分工偏好独立清理事务', () => {
  it('旧别名策略独立预览／清理／恢复、保存不复活及并发拒绝', async () => {
    const f = await fixture()
    f.raw['dsh-model-manager'].aliases.main.reliability = { maxAttempts: 'invalid', retryTransient: false, parameterDowngrade: { bad: true }, extra: 'preserve' }
    f.managedAdapter.service.onSettingsChanged(f.get('dsh-model-manager'))
    const original = structuredClone(f.raw)
    expect(f.managedAdapter.service.snapshot().legacyAliasReliabilityCount).toBe(1)
    expect(f.managedAdapter.service.snapshot().config.aliases.main).not.toHaveProperty('reliability')
    const input = { operations: [{ kind: 'clearLegacyAliasReliability' }] }
    const p = await f.call('catalog-preview', input)
    expect(p.status, JSON.stringify(p.json)).toBe(200); expect(p.json.selected).toEqual([]); expect(f.raw).toEqual(original)
    const selected = p.json.operations.map((o: any) => o.id)
    const applied = await f.call('catalog-apply', { token: p.json.token, selected })
    expect(applied.status, JSON.stringify(applied.json)).toBe(200)
    expect(f.raw['dsh-model-manager'].aliases.main.reliability).toEqual({ extra: 'preserve' })
    expect(applied.json.snapshot.legacyAliasReliabilityCount).toBe(0)
    await f.managedAdapter.service.update(applied.json.snapshot.config, f.managedAdapter.service.snapshot().revision)
    expect(f.raw['dsh-model-manager'].aliases.main.reliability).toEqual({ extra: 'preserve' })
    // 后续保存会阻止旧备份覆盖；不强行恢复。
    expect((await f.call('catalog-restore', { backupId: applied.json.backupId })).status).toBe(409)
  })
  it('旧别名策略完整恢复仍停用，过期清理预览不写入', async () => {
    const input = { operations: [{ kind: 'clearLegacyAliasReliability' }] }
    const g = await fixture()
    g.raw['dsh-model-manager'].aliases.main.reliability = { maxAttempts: 2, unknown: ['keep'] }
    g.managedAdapter.service.onSettingsChanged(g.get('dsh-model-manager'))
    const before = structuredClone(g.raw), preview = await g.call('catalog-preview', input)
    const done = await g.call('catalog-apply', { token: preview.json.token, selected: preview.json.operations.map((o: any) => o.id) })
    expect(done.status, JSON.stringify(done.json)).toBe(200)
    expect((await g.call('catalog-restore', { backupId: done.json.backupId })).status).toBe(200)
    expect(g.raw).toEqual(before); expect(g.managedAdapter.service.snapshot().config.aliases.main).not.toHaveProperty('reliability')
    const stale = await g.call('catalog-preview', input); g.rev['dsh-model-manager']++
    expect((await g.call('catalog-apply', { token: stale.json.token, selected: stale.json.operations.map((o: any) => o.id) })).status).toBe(409)
  })
  const input = { operations: [{ kind: 'clearLegacyPreferences' }] }
  it('父入口为 AUTO 时 fork 延续父任务已选模型及原生参数，不再次评估', async () => {
    const f = await fixture(), chosen = { providerId: 'deepseek-official', modelId: 'pro' }
    f.managedAdapter.service.recordActualModel('parent', chosen)
    f.managedAdapter.service.saveAutoDecision('parent', 1, { grade: 'normal', candidates: [chosen], selection: { target: chosen }, reason: 'test', fallback: false })
    const parentOptions = { provider: 'dsh-model-manager', model: 'auto', reasoningEffort: 'high', maxTokens: 33 }
    const child = await f.hooks.get('agent/request')!({ agent: { session: { id: 'fork', header: { parentSession: 'parent' } } }, turn: 1 }, async () => parentOptions)
    expect(child).toEqual({ ...parentOptions, model: managedId(chosen) })
    expect(f.managedAdapter.service.isDelegatedSession('fork')).toBe(true)
    expect(f.runtime.stream).not.toHaveBeenCalled(); f.disposed.forEach(dispose => dispose())
  })
  it.each([false, true])('清理仅 unset 历史字段，完整备份并恢复；空对象=%s', empty => fixture(true, false, false, true).then(async f => {
    if (empty) f.raw['dsh-model-manager'].auto.preferences = {}
    f.raw['dsh-model-manager'].auto.custom = { untouched: true }
    const original = structuredClone(f.raw)
    const p = await f.call('catalog-preview', input)
    expect(p.status, JSON.stringify(p.json)).toBe(200)
    expect(p.json).toMatchObject({ writesPlugin: true, counts: [], selected: [] })
    expect(p.json.operations[0]).not.toHaveProperty('model')
    expect(f.raw).toEqual(original)
    expect(f.runtime.stream).not.toHaveBeenCalled()
    const a = await f.call('catalog-apply', { token: p.json.token, selected: ['clearLegacyPreferences'] })
    expect(a.status, JSON.stringify(a.json)).toBe(200)
    expect(a.json.snapshot.config.auto).not.toHaveProperty('preferences')
    expect(a.json.snapshot.catalogBackupId).toBe(a.json.backupId)
    const expected = structuredClone(original); delete expected['dsh-model-manager'].auto.preferences
    expect(f.raw).toEqual(expected)
    const backup = JSON.parse(await readFile(f.backupPath(), 'utf8'))
    expect(backup.writes).toHaveLength(1)
    expect(backup.writes[0]).toMatchObject({ ns: 'dsh-model-manager', fields: [{ path: ['auto', 'preferences'], before: original['dsh-model-manager'].auto.preferences, had: true }] })
    expect(backup.writes[0].fields).toHaveLength(1)
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200)
    expect(f.raw).toEqual(original)
    expect(f.prompts.map(p => p()).join('')).not.toContain('research')
    f.disposed.forEach(dispose => dispose())
  }))
  it('缺失、混合、重复、未知输入和跨站均拒绝；取消不修改', async () => {
    const f = await fixture()
    expect((await f.call('catalog-preview', input)).json.error).toContain('无需清理')
    f.raw['dsh-model-manager'].auto.preferences = {}
    const original = structuredClone(f.raw)
    for (const operations of [[...input.operations, ...input.operations], [...input.operations, { kind: 'removeAlias', name: 'main' }], [{ kind: 'clearLegacyPreferences', model: {} }]]) expect((await f.call('catalog-preview', { operations })).status).toBe(400)
    expect((await f.call('catalog-preview', input, { origin: 'https://evil.invalid' })).status).toBe(403)
    const p = await f.call('catalog-preview', input)
    expect((await f.call('catalog-apply', { token: p.json.token, selected: [] })).status).toBe(400)
    expect(f.raw).toEqual(original); f.disposed.forEach(dispose => dispose())
  })
  it('后续 revision 拒绝清理与恢复，写失败保留原值', async () => {
    const f = await fixture(true, false, false, true), original = structuredClone(f.raw)
    const p = await f.call('catalog-preview', input); f.rev['dsh-model-manager']++
    expect((await f.call('catalog-apply', { token: p.json.token, selected: ['clearLegacyPreferences'] })).status).toBe(409)
    const next = await f.call('catalog-preview', input); f.fail('dsh-model-manager')
    expect((await f.call('catalog-apply', { token: next.json.token, selected: ['clearLegacyPreferences'] })).status).toBe(400)
    expect(f.raw).toEqual(original)
    const final = await f.call('catalog-preview', input)
    const a = await f.call('catalog-apply', { token: final.json.token, selected: ['clearLegacyPreferences'] })
    expect(a.status).toBe(200); f.rev['dsh-model-manager']++
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(409)
    expect(f.raw['dsh-model-manager'].auto).not.toHaveProperty('preferences')
    f.disposed.forEach(dispose => dispose())
  })
  it('无需 subagents 注入且不注册重复路由、不注入偏好；原生子任务保留显式参数', async () => {
    const f = await fixture(true, false, false, true)
    expect(f.routes.has('/api/model-manager/subagents')).toBe(false)
    expect(f.prompts.map(p => p()).join('')).not.toContain('分工')
    await f.call('overrides', { sessionId: 'child', scope: 'session', selection: { target: { providerId: 'reader', modelId: 'reader' } } }, {}, 'PUT')
    const selected = { provider: 'dsh-model-manager', model: managedId({ providerId: 'deepseek-official', modelId: 'pro' }), reasoningEffort: 'high' }
    const result = await f.hooks.get('agent/request')!({ agent: { session: { id: 'child', header: { parentSession: 'parent' } } }, turn: 1 }, async () => selected)
    expect(result).toEqual(selected); expect(f.runtime.stream).not.toHaveBeenCalled()
    f.disposed.forEach(dispose => dispose())
  })
})

describe('别名删除宿主完整事务', () => {
  async function preview(f: Awaited<ReturnType<typeof fixture>>) {
    const first = await f.call('catalog-preview', { operations: [{ kind: 'removeAlias', name: 'main' }] })
    expect(first.status, JSON.stringify(first.json)).toBe(200)
    expect(first.json.selected).toEqual([])
    expect(first.json.counts.every((c: any) => c.before === c.after && !c.operationCount)).toBe(true)
    const op = first.json.operations[0]
    const resolved = await f.call('catalog-resolve', { token: first.json.token, selected: [op.id], resolutions: op.choices.map((c: any) => ({ id: c.id, optionId: c.options.some((o: any) => o.optionId === 'clear') ? 'clear' : modelKey({ providerId: 'reader', modelId: 'reader' }) })) })
    expect(resolved.status, JSON.stringify(resolved.json)).toBe(200)
    expect(resolved.json.operations[0].blockedReasons).toEqual([])
    return resolved.json
  }
  it('隐藏旧主模型、旧视觉引用可一次删除和完整恢复，实际模型与无关视觉保留', async () => {
    const f = await fixture(false, true)
    f.raw['dsh-model-manager'].auto.main = { target: '@main', tier: 'high', maxOutputTokens: 77, custom: 'keep' }
    f.raw['dsh-model-manager'].auto.roles.vision = { enabled: false, target: '@main', tier: 'auto' }
    f.raw['dsh-model-manager'].vision = { enabled: true, policy: 'native-first', target: { providerId: 'reader', modelId: 'image' } }
    const original = structuredClone(f.raw), p = await preview(f)
    expect(f.raw).toEqual(original)
    const a = await f.call('catalog-apply', { token: p.token, selected: p.selected })
    expect(a.status, JSON.stringify(a.json)).toBe(200)
    expect(a.json.snapshot.config.aliases.main).toBeUndefined(); expect(a.json.snapshot.config.auto.main).toEqual({ maxOutputTokens: 77, custom: 'keep' })
    expect(a.json.snapshot.config.vision).toEqual(original['dsh-model-manager'].vision)
    expect(f.raw['llm-deepseek']).toEqual(original['llm-deepseek']); expect(f.raw['llm-pi-ai']).toEqual(original['llm-pi-ai'])
    expect(f.analyses()).toBe(0)
    const backup = JSON.parse(await readFile(f.backupPath(), 'utf8'))
    expect(backup.writes.map((w: any) => w.ns)).toEqual(['dsh-model-manager'])
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200)
    expect(f.raw).toEqual(original)
    f.disposed.forEach(dispose => dispose())
  })
  it('未处理引用不可绕过 apply，跨站及非法输入拒绝，preview 不修改设置', async () => {
    const f = await fixture(); f.raw['dsh-model-manager'].auto.main.target = '@main'
    const original = structuredClone(f.raw)
    const p = await f.call('catalog-preview', { operations: [{ kind: 'removeAlias', name: 'main' }] })
    expect((await f.call('catalog-apply', { token: p.json.token, selected: [p.json.operations[0].id] })).status).toBe(400)
    expect((await f.call('catalog-preview', { operations: [{ kind: 'removeAlias', name: 'main' }] }, { origin: 'https://evil.invalid' })).status).toBe(403)
    expect((await f.call('catalog-preview', { operations: [{ kind: 'removeAlias', name: 'main', force: true }] })).status).toBe(400)
    expect(f.raw).toEqual(original); f.disposed.forEach(dispose => dispose())
  })
  it('宿主默认及范围更改同组备份；后续写失败回滚别名删除', async () => {
    const f = await fixture()
    f.raw['agent-default-model'] = { provider: 'dsh-model-manager', model: 'alias:main', custom: 'keep' }
    f.raw['subagent-model-selection'].allowedModels = [{ provider: 'dsh-model-manager', model: 'alias:main' }, { provider: 'deepseek-official', model: 'pro' }]
    const original = structuredClone(f.raw), p = await preview(f)
    f.fail('agent-default-model')
    const a = await f.call('catalog-apply', { token: p.token, selected: p.selected })
    expect(a.status).toBe(400); expect(a.json.error).toContain('回滚'); expect(f.raw).toEqual(original)
    const next = await preview(f), applied = await f.call('catalog-apply', { token: next.token, selected: next.selected })
    expect(applied.status, JSON.stringify(applied.json)).toBe(200)
    expect(f.raw['agent-default-model']).toEqual({ provider: 'reader', model: 'reader', custom: 'keep' })
    expect(f.raw['subagent-model-selection'].allowedModels).toEqual([{ provider: 'deepseek-official', model: 'pro' }])
    expect((await f.call('catalog-restore', { backupId: applied.json.backupId })).status).toBe(200); expect(f.raw).toEqual(original)
    f.disposed.forEach(dispose => dispose())
  })
  it('未来 session／nextTurn 引用清理整体备份恢复；并发覆盖变化拒绝', async () => {
    const f = await fixture()
    for (const scope of ['session', 'nextTurn']) expect((await f.call('overrides', { sessionId: 'alias-test', scope, selection: { target: '@main', maxOutputTokens: 11 } }, {}, 'PUT')).status).toBe(200)
    const path = join(resolveDataDir(), 'overrides.json'), original = JSON.parse(await readFile(path, 'utf8'))
    const p = await preview(f)
    expect(p.operations[0].references.filter((r: any) => r.path.startsWith('overrides.'))).toHaveLength(2)
    const a = await f.call('catalog-apply', { token: p.token, selected: p.selected })
    expect(a.status, JSON.stringify(a.json)).toBe(200)
    expect(JSON.parse(await readFile(path, 'utf8'))['alias-test']).toEqual({ session: { maxOutputTokens: 11 }, nextTurn: { maxOutputTokens: 11 } })
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original)
    const stale = await preview(f)
    await f.call('overrides', { sessionId: 'alias-test', scope: 'nextTurn', selection: { target: { providerId: 'reader', modelId: 'reader' } } }, {}, 'PUT')
    expect((await f.call('catalog-apply', { token: stale.token, selected: stale.selected })).status).toBe(409)
    expect(f.raw['dsh-model-manager'].aliases.main).toBeDefined(); f.disposed.forEach(dispose => dispose())
  })
  it('后续 revision 编辑拒绝 apply 和 restore，不覆盖后续配置', async () => {
    const f = await fixture(), p = await preview(f)
    f.rev['dsh-model-manager']++
    expect((await f.call('catalog-apply', { token: p.token, selected: p.selected })).status).toBe(409)
    const next = await preview(f), applied = await f.call('catalog-apply', { token: next.token, selected: next.selected })
    expect(applied.status).toBe(200)
    f.raw['dsh-model-manager'].reliability.maxAttempts = 1; f.rev['dsh-model-manager']++
    expect((await f.call('catalog-restore', { backupId: applied.json.backupId })).status).toBe(409)
    expect(f.raw['dsh-model-manager'].reliability.maxAttempts).toBe(1); expect(f.raw['dsh-model-manager'].aliases.main).toBeUndefined()
    f.disposed.forEach(dispose => dispose())
  })
})

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
    backup.version = 2
    await writeFile(join(resolveDataDir(), 'official-sync-backup.json'), JSON.stringify(backup))
    await rm(join(resolveDataDir(), 'catalog-backups', 'latest.json'))
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
    expect(result.json.snapshot.config.models[modelKey({ providerId: 'deepseek-official', modelId: 'fast' })]).toEqual({ capability: {} })
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
    expect(restored.json.snapshot.config.models[modelKey({ providerId: 'deepseek-official', modelId: 'old-fast' })]).toEqual({ capability: {} })
    expect(f.raw['dsh-model-manager'].models[modelKey({ providerId: 'deepseek-official', modelId: 'old-fast' })]).toEqual({ capability: { image: 'yes' } })
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
    expect((await f.call('official-restore')).status).toBe(400)
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


describe('目录操作完整宿主链路', () => {
  const model = (modelId: string, providerId = 'deepseek-official') => ({ providerId, modelId })
  it('中文改名更新宿主选择器，重复 ID 提供编辑入口，恢复不覆盖后续编辑', async () => {
    const f = await fixture(), original = structuredClone(f.raw)
    const p = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: model('pro'), name: '中文模型名称' }] })
    expect(p.status, JSON.stringify(p.json)).toBe(200); expect(f.raw).toEqual(original)
    const a = await f.call('catalog-apply', { token: p.json.token, selected: p.json.selected })
    expect(a.status, JSON.stringify(a.json)).toBe(200)
    expect(a.json.snapshot.models.find((m: any) => m.modelId === 'pro').name).toBe('中文模型名称')
    expect(f.raw['dsh-model-manager'].catalogMetadata[modelKey(model('pro'))].customName).toBe(true)
    const duplicate = await f.call('catalog-preview', { operations: [{ kind: 'add', model: model('pro') }] })
    expect(duplicate.status).toBe(400); expect(duplicate.json.existingModel).toEqual(model('pro'))
    const restored = await f.call('catalog-restore', { backupId: a.json.backupId })
    expect(restored.status, JSON.stringify(restored.json)).toBe(200); expect(f.raw).toEqual(original)
    const next = await f.call('catalog-preview', { operations: [{ kind: 'add', model: model('manual') }] })
    const b = await f.call('catalog-apply', { token: next.json.token, selected: next.json.selected })
    f.rev['llm-deepseek']++; f.raw['llm-deepseek'].models[0].name = '后续编辑'
    expect((await f.call('catalog-restore', { backupId: b.json.backupId })).status).toBe(409)
    expect(f.raw['llm-deepseek'].models[0].name).toBe('后续编辑')
  })
  it('删除图片辅助：阻断未解决引用，关闭与清理后整体删除，可完整恢复', async () => {
    const f = await fixture(); f.raw['dsh-model-manager'].vision = { enabled: true, policy: 'sidecar-only', target: model('old-fast') }
    f.raw['dsh-model-manager'].auto.roles.vision.target = model('old-fast')
    const original = structuredClone(f.raw)
    const p = await f.call('catalog-preview', { operations: [{ kind: 'remove', model: model('old-fast') }] })
    const op = p.json.operations[0]
    expect((await f.call('catalog-apply', { token: p.json.token, selected: [op.id] })).status).toBe(400)
    expect(f.raw).toEqual(original)
    const resolutions = op.choices.flatMap((c: any) => c.kind === 'vision' ? [{ id: c.id, optionId: 'disable' }] : c.kind === 'cleanup' ? [{ id: c.id, optionId: 'clear' }] : c.kind === 'replacement' ? [{ id: c.id, optionId: modelKey(model('pro')) }] : [])
    const r = await f.call('catalog-resolve', { token: p.json.token, selected: [op.id], resolutions })
    expect(r.status, JSON.stringify(r.json)).toBe(200); expect(r.json.operations[0].blockedReasons).toEqual([])
    expect(f.raw).toEqual(original); expect(f.analyses()).toBe(0)
    const a = await f.call('catalog-apply', { token: r.json.token, selected: r.json.selected })
    expect(a.status, JSON.stringify(a.json)).toBe(200)
    expect(f.raw['dsh-model-manager'].vision).toEqual({ enabled: false, policy: 'sidecar-only' })
    expect(f.raw['dsh-model-manager'].auto.roles.vision.target).toBeUndefined()
    expect(f.raw['llm-deepseek'].models.map((m: any) => m.id)).toEqual(['pro'])
    expect(f.raw['dsh-model-manager'].aliases.main.candidates).toEqual([model('pro')])
    expect(f.raw['subagent-model-selection'].allowedModels[0].model).toBe('pro')
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200)
    expect(f.raw).toEqual(original)
  })
  it('目录与插件写入失败回滚；无关图片辅助不阻断删除', async () => {
    const f = await fixture(); f.raw['dsh-model-manager'].vision = { enabled: true, policy: 'native-first', target: model('reader', 'reader') }
    const original = structuredClone(f.raw)
    const p = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: model('pro'), name: '失败改名' }] })
    f.fail('dsh-model-manager')
    const a = await f.call('catalog-apply', { token: p.json.token, selected: p.json.selected })
    expect(a.status).toBe(400); expect(a.json.error).toContain('已回滚'); expect(f.raw).toEqual(original)
    const remove = await f.call('catalog-preview', { operations: [{ kind: 'remove', model: model('pro') }] })
    expect(remove.json.operations[0].blockedReasons).toEqual([])
    expect((await f.call('catalog-apply', { token: remove.json.token, selected: [remove.json.operations[0].id] })).status).toBe(200)
    expect(f.raw['dsh-model-manager'].vision).toEqual(original['dsh-model-manager'].vision)
  })
  it('pi 默认目录改名只写 override，新增物化保留未知字段和输出上限，恢复默认表示', async () => {
    const f = await fixture(true, true), original = structuredClone(f.raw)
    const rename = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: model('image', 'reader'), name: '图片中文名' }] })
    const a = await f.call('catalog-apply', { token: rename.json.token, selected: rename.json.selected })
    expect(a.status, JSON.stringify(a.json)).toBe(200); expect(a.json.snapshot.nativeRevision).toBe(2)
    expect(f.raw['llm-pi-ai'].providers.reader.models).toBeUndefined()
    expect(f.raw['llm-pi-ai'].providers.reader.modelOverrides.image.name).toBe('图片中文名')
    expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200); expect(f.raw).toEqual(original)
    const p = await f.call('catalog-preview', { operations: [{ kind: 'add', model: model('pro', 'reader'), name: '另一个 Provider 的同 ID', image: true }] })
    const b = await f.call('catalog-apply', { token: p.json.token, selected: p.json.selected })
    expect(b.status, JSON.stringify(b.json)).toBe(200)
    expect(f.raw['llm-pi-ai'].providers.reader.models).toEqual([{ id: 'reader', maxTokens: 77, custom: 'keep' }, { id: 'image' }, { id: 'pro', name: '另一个 Provider 的同 ID', input: ['text', 'image'] }])
    expect(f.raw['llm-pi-ai'].providers.reader.modelOverrides).toBeUndefined()
    expect(f.raw['llm-pi-ai'].providers.reader.apiKeyEnv).toBe('PRIVATE_PI_KEY')
    expect((await f.call('catalog-restore', { backupId: b.json.backupId })).status).toBe(200); expect(f.raw).toEqual(original)
  })
  it('新预览作废旧 token，非法选项或未公开 Provider 不写配置', async () => {
    const f = await fixture(), original = structuredClone(f.raw)
    const first = await f.call('catalog-preview', { operations: [{ kind: 'add', model: model('new') }] })
    const second = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: model('pro'), name: '新的预览' }] })
    expect((await f.call('catalog-apply', { token: first.json.token, selected: first.json.selected })).status).toBe(400)
    expect((await f.call('catalog-resolve', { token: second.json.token, selected: second.json.selected, resolutions: [{ id: 'invented', optionId: 'invented' }] })).status).toBe(400)
    expect((await f.call('catalog-preview', { operations: [{ kind: 'add', model: model('unknown', 'reader') }] })).status).toBe(400)
    expect(f.raw).toEqual(original)
  })
})



it('未配置 namespace 的恢复不把默认数组写成显式数组', async () => {
  const f = await fixture(false, false, true)
  const p = await f.call('catalog-preview', { operations: [{ kind: 'rename', model: { providerId: 'deepseek-official', modelId: 'pro' }, name: '用户名字' }] })
  const a = await f.call('catalog-apply', { token: p.json.token, selected: p.json.selected })
  expect(a.status, JSON.stringify(a.json)).toBe(200)
  const backup = JSON.parse(await readFile(f.backupPath(), 'utf8'))
  expect(backup.writes.find((w: any) => w.ns === 'llm-deepseek').fields[0].had).toBe(false)
  expect((await f.call('catalog-restore', { backupId: a.json.backupId })).status).toBe(200)
  expect(f.raw['llm-deepseek'].models).toBeUndefined()
})


it('仅宿主删除声明无需写插件，清理附属设置则标记插件写集', async () => {
 const f=await fixture()
 const p=await f.call('catalog-preview',{operations:[{kind:'remove',model:{providerId:'deepseek-official',modelId:'pro'}}]})
 const r=await f.call('catalog-resolve',{token:p.json.token,selected:[p.json.operations[0].id],resolutions:[]})
 expect(r.json.writesPlugin).toBe(false)
 const a=await f.call('catalog-apply',{token:r.json.token,selected:r.json.selected})
 expect(a.json.snapshot.catalogBackupWritesPlugin).toBe(false)
 expect(a.json.snapshot.catalogBackupId).toBe(a.json.backupId)
 expect((await f.call('catalog-restore',{backupId:a.json.backupId})).json.snapshot.catalogBackupId).toBeUndefined()
 const rename=await f.call('catalog-preview',{operations:[{kind:'rename',model:{providerId:'deepseek-official',modelId:'pro'},name:'新名字'}]})
 expect(rename.json.writesPlugin).toBe(true)
})

vi.mock('../src/desktop-settings.js', async original=>({...await original(),DesktopSettings:(await import('./route-port.js')).RouteSettingsPort}))
