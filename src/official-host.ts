import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { analyzeOfficial, officialUrl } from './official-sync.js'
import { DEFAULT_OFFICIAL_URL, OFFICIAL_PROVIDER, officialAnalysisTimeout, type OfficialPreview, type OfficialProgress } from './official-types.js'
import { applyOfficialDiffs, canonical, officialDiffs, type FutureOverrides, type HostModel, type OfficialState } from './official-state.js'
import { migrateConfig, validateConfig, type ManagerConfig, type ModelRef } from './domain.js'
import { isSettingsConflict, ModelManagerService, resolveDataDir } from './service.js'

interface Host { llm: LlmRuntime; settings: SettingsProvider; webServer: WebServer; effect: Context['effect'] }
type Field = { path: string[]; before: unknown; had: boolean; after: unknown }
type Write = { ns: string; revision: number; fields: Field[]; appliedRevision?: number; reverted?: boolean }
interface Backup {
  version: 2; token: string; sourceUrl: string; analyzer: ModelRef; reasoningEffort?: string; analysisTimeoutSeconds?: number; pages: OfficialPreview['pages']; at: string
  status: 'prepared' | 'applying' | 'applied' | 'rolled-back' | 'recovery-required' | 'restored'
  writes: Write[]; overrides?: { before: FutureOverrides; after: FutureOverrides; appliedFingerprint?: string; reverted?: boolean }
}
const namespaces = ['llm-deepseek', 'dsh-model-manager', 'agent-default-model', 'subagent-model-selection']
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
function trusted(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (!req.headers.origin) return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
  try { return new URL(req.headers.origin).host === req.headers.host } catch { return false }
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of req) { text += chunk.toString(); if (text.length > 1024 * 1024) throw new Error('请求体过大') }
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体无效')
  return value
}
function at(value: unknown, path: string[]): unknown { let node = value; for (const key of path) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined; return node }
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

export function registerOfficialSync(ctx: Host, service: ModelManagerService): void {
  let preview: OfficialPreview | undefined, generation = 0, analysisAbort: AbortController | undefined
  let writesQueue = Promise.resolve()
  const file = join(resolveDataDir(), 'official-sync-backup.json')
  const revision = (ns: string) => ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns)?.revision ?? null
  const revisions = () => Object.fromEntries(namespaces.map(ns => [ns, revision(ns)]))
  const get = (ns: string) => ctx.settings.get(ns as never) as Record<string, unknown> | undefined
  const saveBackup = async (value: Backup | Record<string, unknown>) => {
    await mkdir(resolveDataDir(), { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    try { await copyFile(file, `${file}.bak`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await rename(`${file}.tmp`, file)
  }
  const readState = async (): Promise<OfficialState> => {
    const explicit = get('llm-deepseek')?.models as HostModel[] | undefined
    const models = new Map<string, HostModel>()
    for (const model of await ctx.llm.listModels(OFFICIAL_PROVIDER)) {
      const info = await ctx.llm.resolveModelInfo(OFFICIAL_PROVIDER, model.id)
      const record = info as unknown as Record<string, unknown>
      models.set(model.id, { ...record, id: model.id, name: model.name,
        ...('context' in info && info.context?.contextWindow ? { contextWindow: info.context.contextWindow } : {}),
        ...('defaultMaxTokens' in info && info.defaultMaxTokens ? { maxTokens: info.defaultMaxTokens } : {}) })
    }
    for (const model of explicit ?? []) models.set(model.id, structuredClone(model))
    // 设置 schema 可能剥离未知键；迁移必须保留用户原始模型字段。
    const raw = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-deepseek')?.user as Record<string, unknown> | undefined
    if (Array.isArray(raw?.models)) for (const model of raw.models as HostModel[]) {
      if (model && typeof model.id === 'string') models.set(model.id, { ...models.get(model.id), ...structuredClone(model) })
    }
    return { models: [...models.values()], config: migrateConfig(ctx.settings.get('dsh-model-manager')), defaultModel: get('agent-default-model'), subagents: get('subagent-model-selection') as OfficialState['subagents'], overrides: service.futureOverrides() }
  }
  const buildWrites = (before: OfficialState, after: OfficialState): Write[] => {
    const result: Write[] = []
    const add = (ns: string, values: [string[], unknown, unknown][]) => {
      const changed = values.filter(([, a, b]) => !same(a, b))
      if (!changed.length) return
      const rev = revision(ns)
      if (rev === null) throw new Error(`设置分节不可写：${ns}`)
      const desc = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns)!
      const user = Object.hasOwn(desc, 'user') ? desc.user : get(ns)
      result.push({ ns, revision: rev, fields: changed.map(([path, _old, value]) => ({ path, before: at(user, path), had: at(user, path) !== undefined, after: value })) })
    }
    add('llm-deepseek', [[['models'], before.models, after.models]])
    // 无显式数组且选中字段变化，模型数组必须物化；即使目录表示的值未变也需要建立此数组。
    for (const key of ['aliases', 'models', 'auto', 'vision', 'official'] as const) add('dsh-model-manager', [[[key], before.config[key], after.config[key]]])
    // 同 namespace 合并为一个 CAS，不能让同一 revision 被使用两次。
    const grouped = new Map<string, Write>()
    for (const write of result) { const current = grouped.get(write.ns); if (current) current.fields.push(...write.fields); else grouped.set(write.ns, write) }
    add('agent-default-model', [[['model'], before.defaultModel?.model, after.defaultModel?.model]])
    add('subagent-model-selection', [[['allowedModels'], before.subagents?.allowedModels, after.subagents?.allowedModels]])
    for (const write of result.filter(write => !grouped.has(write.ns))) grouped.set(write.ns, write)
    return [...grouped.values()]
  }
  const mutate = async (write: Write, reverting = false) => {
    const expected = reverting ? write.appliedRevision : write.revision
    if (expected === undefined || revision(write.ns) !== expected) throw new Error(`SETTINGS_CONFLICT：${write.ns}`)
    const ops = write.fields.map(field => reverting ? field.had ? { op: 'set', path: field.path, value: field.before } : { op: 'unset', path: field.path } : { op: 'set', path: field.path, value: field.after }) as SettingsPathOp[]
    await ctx.settings.mutate(write.ns as never, ops, expected)
    if (reverting) write.reverted = true
    else write.appliedRevision = revision(write.ns) ?? undefined
    if (write.ns === 'dsh-model-manager') service.onSettingsChanged(ctx.settings.get('dsh-model-manager') as ManagerConfig)
  }
  const transaction = async (backup: Backup, saveOverrides: (next: FutureOverrides) => Promise<void>, restoring: boolean) => {
    const failures: string[] = []
    if (restoring) {
      for (const write of backup.writes) if (write.appliedRevision === undefined || revision(write.ns) !== write.appliedRevision) throw new Error(`SETTINGS_CONFLICT：${write.ns}`)
      if (backup.overrides?.appliedFingerprint && service.futureOverridesFingerprint() !== backup.overrides.appliedFingerprint) throw new Error('SETTINGS_CONFLICT：会话覆盖已变化')
    }
    try {
      if (restoring) {
        if (backup.overrides) { await saveOverrides(backup.overrides.before); backup.overrides.reverted = true; await saveBackup(backup) }
        for (const write of [...backup.writes].reverse()) { await mutate(write, true); await saveBackup(backup) }
        backup.status = 'restored'
      } else {
        await saveBackup(backup); backup.status = 'applying'; await saveBackup(backup)
        for (const write of backup.writes) { await mutate(write); await saveBackup(backup) }
        if (backup.overrides) { await saveOverrides(backup.overrides.after); backup.overrides.appliedFingerprint = service.futureOverridesFingerprint(); await saveBackup(backup) }
        backup.status = 'applied'
      }
      await saveBackup(backup)
    } catch (failure) {
      if (!restoring) {
        if (backup.overrides?.appliedFingerprint) {
          try { if (backup.overrides.appliedFingerprint !== service.futureOverridesFingerprint()) throw new Error('覆盖已变化'); await saveOverrides(backup.overrides.before); backup.overrides.reverted = true } catch { failures.push('会话覆盖') }
        }
        for (const write of [...backup.writes].reverse().filter(write => write.appliedRevision !== undefined)) {
          try { await mutate(write, true); await saveBackup(backup) } catch { failures.push(write.ns) }
        }
      }
      backup.status = restoring || failures.length ? 'recovery-required' : 'rolled-back'
      await saveBackup(backup).catch(() => { failures.push('备份记录') })
      throw new Error(`${failure instanceof Error ? failure.message : String(failure)}${backup.status === 'recovery-required' ? `；需要核对备份：${failures.join('、') || '恢复中断'}` : '；本次写入已回滚'}`)
    } finally { await service.refresh().catch(() => {}) }
  }
  const enqueue = async (action: () => Promise<void>) => { const task = writesQueue.catch(() => {}).then(action); writesQueue = task.catch(() => {}); return task }
  const register = (suffix: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) => ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `/api/model-manager/${suffix}`, handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try { await handler(req, res) } catch (failure) { if (!res.writableEnded && !res.destroyed) json(res, isSettingsConflict(failure) || /CONFLICT/.test(String(failure)) ? 409 : 400, { error: failure instanceof Error ? failure.message : String(failure) }) }
  } }), `dsh-model-manager: ${suffix}`)

  register('official-preview', async (req, res) => {
    const currentGeneration = ++generation
    preview = undefined; analysisAbort?.abort(); const abort = new AbortController(); analysisAbort = abort
    let streaming = false, timer: ReturnType<typeof setInterval> | undefined
    const close = () => { if (!res.writableEnded) abort.abort() }
    res.on?.('close', close)
    const emit = (event: string, data: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    try {
      const input = await body(req)
      if ('sources' in input) throw new Error('同步接口已改为入口网址和分析模型，请刷新页面')
      const analysisTimeoutSeconds = officialAnalysisTimeout(input.analysisTimeoutSeconds)
      await service.refresh()
      const config = service.snapshot().config
      if (input.sourceUrl !== undefined && typeof input.sourceUrl !== 'string') throw new Error('入口网址无效')
      const sourceUrl = officialUrl(input.sourceUrl as string ?? config.official?.sourceUrl ?? DEFAULT_OFFICIAL_URL).href
      const analyzer = input.analyzer === null ? service.hostDefault() : input.analyzer === undefined ? config.official?.analyzer ?? service.hostDefault() : input.analyzer as ModelRef
      if (!analyzer || typeof analyzer.providerId !== 'string' || typeof analyzer.modelId !== 'string' || analyzer.providerId === 'dsh-model-manager' || !service.model(analyzer)) throw new Error('请选择已加载的真实分析模型，或先设置宿主默认模型')
      if (input.reasoningEffort !== undefined && (typeof input.reasoningEffort !== 'string' || !input.reasoningEffort)) throw new Error('分析推理档位无效')
      const reasoningEffort = input.reasoningEffort as string | undefined
      if (revision('llm-deepseek') === null) throw new Error('DSH 未加载 DeepSeek 官方配置')
      const startingRevision = revision('llm-deepseek')
      const startingCatalog = canonical(service.snapshot().models.filter(model => model.providerId === OFFICIAL_PROVIDER))
      streaming = req.headers.accept?.includes('text/event-stream') ?? false
      if (streaming) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        timer = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n') }, 15_000); timer.unref()
      }
      const report = (value: OfficialProgress) => { if (streaming) emit('progress', value) }
      const { analysis, pages } = await analyzeOfficial(ctx.llm, analyzer, sourceUrl, abort.signal, report, reasoningEffort, analysisTimeoutSeconds)
      await service.refresh(); abort.signal.throwIfAborted()
      if (generation !== currentGeneration) throw new Error('同步预览已被新刷新取代')
      if (revision('llm-deepseek') !== startingRevision || canonical(service.snapshot().models.filter(model => model.providerId === OFFICIAL_PROVIDER)) !== startingCatalog) throw new Error('SETTINGS_CONFLICT：分析期间模型目录已变化')
      report({ stage: 'diffing', round: 0, pageCount: pages.length })
      await service.flush()
      const before = revisions(), fingerprint = service.futureOverridesFingerprint(), state = await readState()
      if (!same(before, revisions()) || fingerprint !== service.futureOverridesFingerprint()) throw new Error('SETTINGS_CONFLICT')
      const result: OfficialPreview = { token: randomUUID(), sourceUrl, analyzer, ...(reasoningEffort ? { reasoningEffort } : {}), analysisTimeoutSeconds, fetchedAt: pages[0].fetchedAt, pages: pages.map(({ url, fetchedAt }) => ({ url, fetchedAt })), analysis, diffs: officialDiffs(state, analysis), notes: analysis.notes, revisions: before, overridesFingerprint: fingerprint, localModelIds: state.models.map(model => model.id) }
      abort.signal.throwIfAborted()
      if (generation !== currentGeneration) throw new Error('预览已失效')
      preview = result
      if (streaming) { emit('result', result); res.end() } else json(res, 200, result)
    } catch (failure) {
      if (streaming) { emit('error', { error: abort.signal.aborted ? '分析已取消' : failure instanceof Error ? failure.message : String(failure) }); res.end() }
      else throw failure
    } finally { if (timer) clearInterval(timer); res.off?.('close', close); if (analysisAbort === abort) analysisAbort = undefined }
  })

  register('official-apply', async (req, res) => {
    const input = await body(req)
    await enqueue(async () => {
      const selected = input.selected, current = preview
      if (!current || input.token !== current.token || !Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(id => typeof id !== 'string' || !current.diffs.some(diff => diff.id === id && !diff.blockedReasons.length))) throw new Error('请选择有效且不重复的同步差异，或重新刷新预览')
      await service.withFutureOverrides(current.overridesFingerprint, async saveOverrides => {
        if (!same(current.revisions, revisions())) throw new Error('SETTINGS_CONFLICT')
        const before = await readState()
        if (preview !== current || !same(current.revisions, revisions())) throw new Error('SETTINGS_CONFLICT')
        const after = applyOfficialDiffs(before, current.diffs.filter(diff => selected.includes(diff.id)))
        after.config.official = { ...after.config.official, checkedAt: current.fetchedAt }
        validateConfig(after.config)
        const backup: Backup = { version: 2, token: current.token, sourceUrl: current.sourceUrl, analyzer: current.analyzer, ...(current.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}), analysisTimeoutSeconds: current.analysisTimeoutSeconds, pages: current.pages, at: new Date().toISOString(), status: 'prepared', writes: buildWrites(before, after), ...(!same(before.overrides, after.overrides) ? { overrides: { before: before.overrides, after: after.overrides } } : {}) }
        // 完成预检后立即消费 token；部分失败也不能重放同一次预览。
        preview = undefined
        await transaction(backup, saveOverrides, false)
        json(res, 200, { applied: selected.length, backupAt: backup.at, snapshot: service.snapshot() })
      })
    })
  })

  register('official-restore', async (_req, res) => {
    await enqueue(async () => {
      let raw: Record<string, unknown>
      try { raw = JSON.parse(await readFile(file, 'utf8')) } catch { throw new Error('没有可用同步备份') }
      if (raw.version !== 2) {
        if (raw.restored || typeof raw.appliedOfficialRevision !== 'number' || typeof raw.appliedPluginRevision !== 'number' || revision('llm-deepseek') !== raw.appliedOfficialRevision || service.snapshot().revision !== raw.appliedPluginRevision) throw new Error('SETTINGS_CONFLICT：旧备份已失效')
        const beforeConfig = service.snapshot().config, beforeModels = get('llm-deepseek')?.models
        await ctx.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: raw.models }], raw.appliedOfficialRevision)
        try { await service.update(raw.config as ManagerConfig, raw.appliedPluginRevision) } catch (failure) {
          const latest = revision('llm-deepseek')
          if (latest === raw.appliedOfficialRevision + 1) await ctx.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: beforeModels }], latest)
          service.onSettingsChanged(beforeConfig); throw failure
        }
        await saveBackup({ ...raw, restored: true }); await service.refresh(); preview = undefined
      } else {
        const backup = raw as unknown as Backup
        if (backup.status !== 'applied') throw new Error(`SETTINGS_CONFLICT：备份状态 ${backup.status} 不允许恢复，请核对记录`)
        await service.withFutureOverrides(backup.overrides?.appliedFingerprint, async saveOverrides => { await transaction(backup, saveOverrides, true); preview = undefined })
      }
      json(res, 200, { restored: true, snapshot: service.snapshot() })
    })
  })
  ctx.effect(() => () => { preview = undefined; generation++; analysisAbort?.abort() }, 'dsh-model-manager: official cleanup')
}
