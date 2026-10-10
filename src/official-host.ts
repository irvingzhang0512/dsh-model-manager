import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { analyzeOfficial, officialUrl } from './official-sync.js'
import { DEFAULT_OFFICIAL_URL, OFFICIAL_PROVIDER, officialAnalysisTimeout, type OfficialPreview, type OfficialProgress } from './official-types.js'
import { canonical, type FutureOverrides, type HostModel, type OfficialState } from './official-state.js'
import { manualIntents, officialIntents, planCatalog } from './catalog-state.js'
import type { CatalogIntent, CatalogPreview, CatalogResolution, CatalogState } from './catalog-types.js'
import { migrateConfig, validateConfig, fromManagedId, type ManagerConfig, type ModelRef } from './domain.js'
import { isSettingsConflict, ModelManagerService, resolveDataDir } from './service.js'
import { legacyImageOverrides, cleanLegacyImages } from './legacy-image.js'
import { readParameterCatalog } from './parameter-catalog.js'
import { describeParameterTargets, defaultParameterFields, parameterIntents, setField, type ParameterAnalysis, type ModelParameterPreview } from './model-parameters.js'
import { analyzeModelParameters, createParameterSearch, platformOfficialHosts } from './parameter-analysis.js'

interface Host { llm: LlmRuntime; settings: SettingsProvider; credentials?: CredentialProvider; webServer: WebServer; effect: Context['effect'] }
type Field = { path: string[]; before: unknown; had: boolean; after: unknown }
type Write = { ns: string; revision: number; fields: Field[]; appliedRevision?: number; reverted?: boolean }
interface Backup {
  version: 2 | 3; backupId?: string; origin?: CatalogPreview['origin']; selected?: string[]; selectedFields?: string[]; parameterAnalysis?: ParameterAnalysis; resolutions?: CatalogResolution[]; token: string; sourceUrl?: string; analyzer?: ModelRef; reasoningEffort?: string; analysisTimeoutSeconds?: number; pages?: OfficialPreview['pages']; at: string
  status: 'prepared' | 'applying' | 'applied' | 'rolled-back' | 'recovery-required' | 'restored'
  writes: Write[]; overrides?: { before: FutureOverrides; after: FutureOverrides; appliedFingerprint?: string; reverted?: boolean }
}
const namespaces = ['llm-deepseek', 'llm-pi-ai', 'dsh-model-manager', 'agent-default-model', 'subagent-model-selection']
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
function preserveRaw(before: unknown, after: unknown, raw: unknown): unknown {
  if (same(before, after)) return structuredClone(raw)
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return structuredClone(after)
  const result = { ...(raw && typeof raw === 'object' ? structuredClone(raw) : {}) } as Record<string, unknown>
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (!same((before as any)[key], (after as any)[key])) {
    if ((after as any)[key] === undefined) delete result[key]
    else result[key] = preserveRaw((before as any)[key], (after as any)[key], (raw as any)?.[key])
  }
  return result
}

export function registerOfficialSync(ctx: Host, service: ModelManagerService): void {
  let preview: OfficialPreview | undefined, generation = 0, analysisAbort: AbortController | undefined
  let catalog: { view: CatalogPreview | ModelParameterPreview; state: CatalogState; intents: CatalogIntent[]; resolutions: CatalogResolution[]; parameterAnalysis?: ParameterAnalysis; selectedFields?: string[] } | undefined
  let writesQueue = Promise.resolve()
  const file = join(resolveDataDir(), 'official-sync-backup.json')
  const backupDir = join(resolveDataDir(), 'catalog-backups')
  const revision = (ns: string) => ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns)?.revision ?? null
  const fullSnapshot = () => ({ ...service.snapshot(), nativeRevision: revision('llm-pi-ai') ?? undefined })
  const revisions = () => Object.fromEntries(namespaces.map(ns => [ns, revision(ns)]))
  const get = (ns: string) => ctx.settings.get(ns as never) as Record<string, unknown> | undefined
  const saveBackup = async (value: Backup | Record<string, unknown>) => {
    const destination = value.version === 3 ? join(backupDir, `${value.backupId}.json`) : file
    await mkdir(value.version === 3 ? backupDir : resolveDataDir(), { recursive: true })
    await writeFile(`${destination}.tmp`, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    try { await copyFile(destination, `${destination}.bak`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await rename(`${destination}.tmp`, destination)
    if (value.version === 3 && value.status === 'applied') {
      let latest: Record<string, string> = {}
      try { latest = JSON.parse(await readFile(join(backupDir, 'latest.json'), 'utf8')) } catch {}
      latest[String(value.origin)] = String(value.backupId)
      await writeFile(join(backupDir, 'latest.json.tmp'), JSON.stringify(latest), { mode: 0o600 })
      await rename(join(backupDir, 'latest.json.tmp'), join(backupDir, 'latest.json'))
    }
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
  const readCatalogState = async (): Promise<CatalogState> => {
    const base = await readState(), profiles: CatalogState['profiles'] = []
    const descriptors = ctx.settings.describe({ redactSecrets: true })
    const raw = (ns: string) => descriptors.find(d => d.ns === ns)?.user as Record<string, unknown> | undefined
    const capabilities = service.snapshot().catalogCapabilities
    for (const capability of capabilities.filter(c => c.canAdd)) {
      const entry = ctx.llm.listConfigurableProviders().find(p => p.provider === capability.providerId)
      const ns = entry?.settingsNs ?? 'llm-deepseek', path = [...entry?.settingsPath ?? []]
      const effective = at(get(ns), path) as Record<string, unknown> | undefined
      const user = at(raw(ns), path) as Record<string, unknown> | undefined
      const baseProfile = at(descriptors.find(d => d.ns === ns)?.base, path) as Record<string, unknown> | undefined
      const explicit = Array.isArray(effective?.models) && (ns === 'llm-deepseek' || !!effective.models.length)
      const list = explicit ? effective!.models as HostModel[] : (await ctx.llm.listModels(capability.providerId)).map(model => ({ id: model.id }))
      const original = Array.isArray(user?.models) ? user.models as HostModel[] : []
      const overrides = (user?.modelOverrides ?? effective?.modelOverrides) as Record<string, Record<string, unknown>> | undefined
      const models = list.map(model => ({ ...structuredClone(model), ...(!explicit ? structuredClone(overrides?.[model.id] ?? {}) : {}), ...structuredClone(original.find(m => m.id === model.id) ?? {}) }))
      const addConstraints = ns === 'llm-pi-ai' ? { missing: [...(entry?.declared && !effective?.api ? ['api（Provider 协议）'] : []), ...(entry?.declared && !effective?.baseURL ? ['baseURL（Provider 端点）'] : []), ...(entry?.error ? [entry.error] : [])], declared: entry?.declared ?? false, defaultContextWindow: effective?.defaultContextWindow as number | undefined, defaultMaxTokens: effective?.defaultMaxTokens as number | undefined } : undefined
      const modelSettings = (value?: Record<string, unknown>) => structuredClone(Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => ['models', 'modelOverrides', 'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'compat'].includes(k))))
      profiles.push({ providerId: capability.providerId, ns, path, models, explicit, overrides, addConstraints, effective: { ...modelSettings(effective), ...(effective?.api ? { api: effective.api } : {}) }, user: modelSettings(user), base: modelSettings(baseProfile), userFields: Object.fromEntries(models.map(model => [model.id, Object.keys(original.find(m => m.id === model.id) ?? overrides?.[model.id] ?? {})])), minimumModels: capability.minimumModels })
    }
    return { ...base, profiles, records: service.snapshot().models, legacyImages: legacyImageOverrides(raw('dsh-model-manager')), models: profiles.find(p => p.providerId === OFFICIAL_PROVIDER)?.models ?? base.models }
  }
  const fingerprint = (state: CatalogState) => canonical([state.profiles, service.snapshot().models])
  const present = (state: CatalogState, intents: CatalogIntent[], origin: CatalogPreview['origin'], choices: CatalogResolution[] = [], selected?: string[]): CatalogPreview => {
    const plan = planCatalog(state, intents, choices, selected)
    const cleanup = intents.some(i => i.kind === 'clearLegacyPreferences' || i.kind === 'clearLegacyImageOverrides')
    const picked = selected ?? plan.operations.filter(o => o.kind !== 'remove' && o.kind !== 'removeAlias' && o.model && !o.blockedReasons.length).map(o => o.id)
    const simulated = planCatalog(state, intents, choices, picked)
    return { token: randomUUID(), origin, fetchedAt: new Date().toISOString(), operations: plan.operations, selected: picked, writesPlugin: cleanup || origin === 'official' || !same(state.config, simulated.after.config), counts: cleanup ? [] : state.profiles.map(p => ({ providerId: p.providerId, before: p.models.length, after: simulated.after.profiles.find(q => q.providerId === p.providerId)!.models.length, operationCount: plan.operations.filter(o => o.model?.providerId === p.providerId && picked.includes(o.id) && !o.blockedReasons.length).length })), revisions: revisions(), catalogFingerprint: fingerprint(state), overridesFingerprint: service.futureOverridesFingerprint() }
  }
  const buildWrites = (before: OfficialState, after: OfficialState): Write[] => {
    const result: Write[] = []
    const add = (ns: string, values: [string[], unknown, unknown][]) => {
      const changed = values.filter(([, a, b]) => !same(a, b))
      if (!changed.length) return
      const rev = revision(ns)
      if (rev === null) throw new Error(`设置分节不可写：${ns}`)
      const desc = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns)!
      // 缺少 user 表示该 namespace 从未显式配置，不能把有效默认值当成原始用户值。
      const user = desc.user
      result.push({ ns, revision: rev, fields: changed.map(([path, old, value]) => ({ path, before: at(user, path), had: at(user, path) !== undefined, after: ns === 'dsh-model-manager' ? preserveRaw(old, value, at(user, path)) : value })) })
    }
    add('llm-deepseek', [[['models'], before.models, after.models]])
    // 无显式数组且选中字段变化，模型数组必须物化；即使目录表示的值未变也需要建立此数组。
    for (const key of ['aliases', 'models', 'auto', 'vision', 'official', 'catalogMetadata'] as const) add('dsh-model-manager', [[[key], before.config[key], after.config[key]]])
    // 同 namespace 合并为一个 CAS，不能让同一 revision 被使用两次。
    const grouped = new Map<string, Write>()
    for (const write of result) { const current = grouped.get(write.ns); if (current) current.fields.push(...write.fields); else grouped.set(write.ns, write) }
    add('agent-default-model', [[['model'], before.defaultModel?.model, after.defaultModel?.model], [['provider'], before.defaultModel?.provider, after.defaultModel?.provider]])
    add('subagent-model-selection', [[['allowedModels'], before.subagents?.allowedModels, after.subagents?.allowedModels]])
    for (const write of result.filter(write => !grouped.has(write.ns))) grouped.set(write.ns, write)
    return [...grouped.values()]
  }
  const catalogWrites = (before: CatalogState, after: CatalogState): Write[] => {
    if (before.legacyImages?.length && !after.legacyImages?.length) {
      const desc = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')!
      const path = ['models'], value = at(desc.user, path)
      return [{ ns: desc.ns, revision: desc.revision, fields: [{ path, before: structuredClone(value), had: value !== undefined, after: cleanLegacyImages(desc.user) }] }]
    }
    if (Object.hasOwn(before.config.auto, 'preferences') && !Object.hasOwn(after.config.auto, 'preferences')) {
      const ns = 'dsh-model-manager', desc = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === ns)
      if (!desc) throw new Error('设置分节不可写：dsh-model-manager')
      const path = ['auto', 'preferences'], value = at(desc.user, path)
      return [{ ns, revision: desc.revision, fields: [{ path, before: structuredClone(value), had: value !== undefined, after: undefined }] }]
    }
    const writes = buildWrites(before, after)
    for (const profile of before.profiles.filter(p => p.ns === 'llm-pi-ai')) {
      const next = after.profiles.find(p => p.providerId === profile.providerId)!
      if (same(profile.models, next.models)) continue
      const desc = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === profile.ns)!
      const user = desc.user
      const fields: Field[] = []
      const field = (path: string[], value: unknown) => fields.push({ path, before: at(user, path), had: at(user, path) !== undefined, after: value })
      const onlyNames = profile.models.length === next.models.length && profile.models.every((m, i) => {
        const { name: _a, ...a } = m, { name: _b, ...b } = next.models[i]; return same(a, b)
      })
      const sameIds = profile.models.length === next.models.length && profile.models.every((m, i) => m.id === next.models[i].id)
      if (!profile.explicit && (onlyNames || sameIds)) {
        const overrides = structuredClone(profile.overrides ?? {})
        for (const model of next.models) {
          const prior = profile.models.find(m => m.id === model.id)!
          for (const [key, value] of Object.entries(model)) if (key !== 'id' && !same(value, prior[key])) overrides[model.id] = { ...overrides[model.id], [key]: key === 'compat' ? { ...(overrides[model.id]?.compat as object ?? {}), ...(value as object) } : value }
        }
        field([...profile.path, 'modelOverrides'], overrides)
      } else {
        field([...profile.path, 'models'], next.models)
        if (profile.overrides !== undefined) field([...profile.path, 'modelOverrides'], undefined)
      }
      let write = writes.find(w => w.ns === profile.ns)
      if (!write) { write = { ns: profile.ns, revision: desc.revision, fields: [] }; writes.push(write) }
      write.fields.push(...fields)
    }
    return writes
  }
  const mutate = async (write: Write, reverting = false) => {
    const expected = reverting ? write.appliedRevision : write.revision
    if (expected === undefined || revision(write.ns) !== expected) throw new Error(`SETTINGS_CONFLICT：${write.ns}`)
    const ops = write.fields.map(field => reverting ? field.had ? { op: 'set', path: field.path, value: field.before } : { op: 'unset', path: field.path } : field.after === undefined ? { op: 'unset', path: field.path } : { op: 'set', path: field.path, value: field.after }) as SettingsPathOp[]
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
      if (backup.version === 3) service.onCatalogBackup(backup.backupId!, backup.origin!, backup.status, backup.writes.some(w => w.ns === 'dsh-model-manager'))
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
    try { await handler(req, res) } catch (failure) { if (!res.writableEnded && !res.destroyed) json(res, isSettingsConflict(failure) || /CONFLICT/.test(String(failure)) ? 409 : 400, { error: failure instanceof Error ? failure.message : String(failure), ...((failure as any)?.existingModel ? { existingModel: (failure as any).existingModel } : {}) }) }
  } }), `dsh-model-manager: ${suffix}`)

  const ensureCurrent = async (current: NonNullable<typeof catalog>) => {
    await service.refresh()
    const currentFingerprint = fingerprint(await readCatalogState())
    if (catalog !== current || !same(current.view.revisions, revisions()) || current.view.overridesFingerprint !== service.futureOverridesFingerprint() || current.view.catalogFingerprint !== currentFingerprint) throw new Error('SETTINGS_CONFLICT：目录或引用已变化，请重新预览')
  }
  const updateOfficial = () => {
    if (!preview || !catalog || catalog.view.origin !== 'official') return
    preview.catalog = catalog.view; preview.token = catalog.view.token
    preview.diffs = catalog.intents.map(intent => {
      const operation = catalog!.view.operations.find(o => o.id === intent.id)!
      return { ...intent.officialDiff!, blockedReasons: operation.blockedReasons, references: operation.references.map(r => r.chain ? r.chain.join(' → ') : r.path) }
    })
  }
  register('catalog-preview', async (req, res) => {
    const input = await body(req)
    await enqueue(async () => {
      generation++; analysisAbort?.abort(); preview = undefined; catalog = undefined
      await service.refresh(); await service.flush()
      const rev = revisions(), overrides = service.futureOverridesFingerprint(), state = await readCatalogState()
      if (!same(rev, revisions()) || overrides !== service.futureOverridesFingerprint()) throw new Error('SETTINGS_CONFLICT')
      const intents = manualIntents(input.operations, state), view = present(state, intents, 'manual')
      catalog = { view, state, intents, resolutions: [] }; json(res, 200, view)
    })
  })
  register('catalog-resolve', async (req, res) => {
    const input = await body(req)
    await enqueue(async () => {
      const current = catalog
      if (!current || input.token !== current.view.token || !Array.isArray(input.selected) || !Array.isArray(input.resolutions) || input.resolutions.some(r => !r || typeof r.id !== 'string' || typeof r.optionId !== 'string')) throw new Error('预览或处理选项无效')
      await ensureCurrent(current)
      const resolutions = input.resolutions as CatalogResolution[]
      if (input.selectedFields !== undefined && (!current.parameterAnalysis || !Array.isArray(input.selectedFields))) throw new Error('本预览不支持逐字段选择')
      const selectedFields = (input.selectedFields ?? current.selectedFields) as string[] | undefined
      const intents = current.parameterAnalysis ? parameterIntents(current.state, current.parameterAnalysis, selectedFields!) : current.intents
      const ids = new Set(intents.map(i => i.id))
      if (new Set(input.selected).size !== input.selected.length || input.selected.some(id => typeof id !== 'string' || !(current.parameterAnalysis ? current.parameterAnalysis.results.some(r => JSON.stringify([r.model.providerId, r.model.modelId]) === id) : ids.has(id)))) throw new Error('选中操作无效或重复')
      const selected = current.parameterAnalysis && input.selectedFields !== undefined ? intents.map(i => i.id) : (input.selected as string[]).filter(id => ids.has(id))
      if (!current.parameterAnalysis && (input.selected as string[]).some(id => !ids.has(id))) throw new Error('选中操作无效')
      const validChoices = current.parameterAnalysis ? new Set(planCatalog(current.state, intents).operations.flatMap(o => o.choices.map(c => c.id))) : undefined
      if (validChoices && (new Set(resolutions.map(r => r.id)).size !== resolutions.length || resolutions.some(r => !validChoices.has(r.id) && !current.view.operations.some(o => o.choices.some(c => c.id === r.id && c.options.some(option => option.optionId === r.optionId)))))) throw new Error('处理选项无效或重复')
      const choices = validChoices ? resolutions.filter(r => validChoices.has(r.id)) : resolutions
      const baseView = present(current.state, intents, current.view.origin, choices, selected)
      const view = current.parameterAnalysis ? { ...baseView, parameterAnalysis: current.parameterAnalysis, selectedFields: selectedFields! } : baseView
      catalog = { ...current, view, intents, resolutions: choices, selectedFields }; updateOfficial(); json(res, 200, preview?.catalog?.token === view.token ? preview : view)
    })
  })
  const applyCatalog = async (input: Record<string, unknown>, res: ServerResponse) => enqueue(async () => {
    const current = catalog, selected = input.selected
    if (!current || input.token !== current.view.token || !Array.isArray(selected) || !selected.length || selected.some(id => typeof id !== 'string')) throw new Error('请选择有效的整体操作，或重新预览')
    await ensureCurrent(current)
    await service.withFutureOverrides(current.view.overridesFingerprint, async saveOverrides => {
      await ensureCurrent(current)
      const simulated = planCatalog(current.state, current.intents, current.resolutions, selected as string[])
      const blocked = simulated.operations.filter(o => selected.includes(o.id)).flatMap(o => o.blockedReasons)
      if (blocked.length) throw new Error(blocked.join('；'))
      const after = simulated.after
      if (current.view.origin === 'official') after.config.official = { ...after.config.official, checkedAt: preview!.fetchedAt }
      const backup: Backup = { version: 3, backupId: randomUUID(), origin: current.view.origin, selected: selected as string[], resolutions: current.resolutions, token: current.view.token, at: new Date().toISOString(), status: 'prepared', writes: catalogWrites(current.state, after), ...(current.parameterAnalysis ? { parameterAnalysis: current.parameterAnalysis, selectedFields: current.selectedFields } : {}), ...(!same(current.state.overrides, after.overrides) ? { overrides: { before: current.state.overrides, after: after.overrides } } : {}), ...(preview && current.view.origin === 'official' ? { sourceUrl: preview.sourceUrl, analyzer: preview.analyzer, reasoningEffort: preview.reasoningEffort, analysisTimeoutSeconds: preview.analysisTimeoutSeconds, pages: preview.pages } : {}) }
      if (!backup.writes.length && !backup.overrides) throw new Error('没有选中有效修改')
      catalog = undefined; preview = undefined
      await transaction(backup, saveOverrides, false)
      json(res, 200, { applied: selected.length, backupId: backup.backupId, backupAt: backup.at, snapshot: fullSnapshot() })
    })
  })
  register('catalog-apply', async (req, res) => { await applyCatalog(await body(req), res) })
  const readBackup = async (backupId: unknown): Promise<Backup> => {
    if (typeof backupId !== 'string' || !/^[0-9a-f-]{36}$/.test(backupId)) throw new Error('备份 ID 无效')
    const path = join(backupDir, `${backupId}.json`)
    let raw: Backup
    try { raw = JSON.parse(await readFile(path, 'utf8')) } catch { raw = JSON.parse(await readFile(`${path}.bak`, 'utf8')) }
    if (raw.version !== 3 || raw.backupId !== backupId || !Array.isArray(raw.writes)) throw new Error('备份格式无效')
    return raw
  }
  const restoreBackup = async (backup: Backup, res: ServerResponse) => {
    if (backup.status !== 'applied') throw new Error(`SETTINGS_CONFLICT：备份状态 ${backup.status} 不允许恢复`)
    await service.withFutureOverrides(backup.overrides?.appliedFingerprint, async saveOverrides => { await transaction(backup, saveOverrides, true); preview = undefined; catalog = undefined })
    json(res, 200, { restored: true, snapshot: fullSnapshot() })
  }
  register('catalog-restore', async (req, res) => { const input = await body(req); await enqueue(async () => restoreBackup(await readBackup(input.backupId), res)) })

  register('parameter-search-credential', async (req, res) => {
    const input = await body(req)
    if (input.name !== undefined && (typeof input.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name))) throw new Error('搜索凭据引用名无效')
    await enqueue(async () => {
      const ns = 'dsh-model-manager', desc = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === ns)!
      if (input.revision !== desc.revision) throw new Error('SETTINGS_CONFLICT')
      const raw = at(desc.user, ['parameterCompletion']) as Record<string, unknown> | undefined
      const name = input.name === 'WEB_SEARCH_API_KEY' ? undefined : input.name
      const ops: SettingsPathOp[] = name === undefined ? raw && Object.keys(raw).every(k => k === 'searchCredentialName') ? [{ op: 'unset', path: ['parameterCompletion'] }] : [{ op: 'unset', path: ['parameterCompletion', 'searchCredentialName'] }] : [{ op: 'set', path: ['parameterCompletion', 'searchCredentialName'], value: name }]
      await ctx.settings.mutate(ns, ops, desc.revision)
      service.onSettingsChanged(ctx.settings.get(ns) as ManagerConfig)
      generation++; analysisAbort?.abort(); preview = undefined; catalog = undefined
      json(res, 200, { snapshot: fullSnapshot() })
    })
  })
  register('model-parameter-preview', async (req, res) => {
    const currentGeneration = ++generation
    analysisAbort?.abort(); const abort = new AbortController(); analysisAbort = abort; preview = undefined; catalog = undefined
    let streaming = false, timer: ReturnType<typeof setInterval> | undefined
    const close = () => { if (!res.writableEnded) abort.abort() }; res.on?.('close', close)
    const emit = (event: string, data: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    try {
      const input = await body(req), analysisTimeoutSeconds = officialAnalysisTimeout(input.analysisTimeoutSeconds)
      if (!Array.isArray(input.models) || !input.models.length || input.models.length > 100 || input.models.some(m => !m || typeof m.providerId !== 'string' || typeof m.modelId !== 'string' || m.providerId === 'dsh-model-manager')) throw new Error('请选择 1–100 个已加载真实模型')
      await service.refresh(); await service.flush()
      const before = revisions(), overrides = service.futureOverridesFingerprint(), state = await readCatalogState(), startingFingerprint = fingerprint(state)
      const targets = describeParameterTargets(state, await readParameterCatalog(state))
      const selectedTargets = [...new Map((input.models as ModelRef[]).map(ref => [JSON.stringify([ref.providerId, ref.modelId]), targets.find(t => t.model.providerId === ref.providerId && t.model.modelId === ref.modelId)])).values()]
      if (selectedTargets.some(t => !t)) throw new Error('存在未加载的目标模型')
      state.parameterApis = Object.fromEntries(targets.map(t => [JSON.stringify([t.model.providerId, t.model.modelId]), t.api]))
      state.parameterModels = Object.fromEntries(targets.map(t => {
        const model: HostModel = { id: t.model.modelId }
        for (const descriptor of t.fields.filter(d => d.writable)) {
          const value = t.currentValues[descriptor.field.join('.')]
          if (value !== undefined) setField(model, descriptor.field, value)
        }
        return [JSON.stringify([t.model.providerId, t.model.modelId]), model]
      }))
      let analyzer = input.analyzer === null || input.analyzer === undefined ? service.hostDefault() : input.analyzer as ModelRef
      if ((input.analyzer === null || input.analyzer === undefined) && analyzer?.providerId === 'dsh-model-manager') {
        try { analyzer = fromManagedId(analyzer.modelId) } catch { throw new Error('宿主默认分析模型须指向真实模型，不能使用 AUTO 或别名') }
      }
      if (!analyzer || typeof analyzer.providerId !== 'string' || typeof analyzer.modelId !== 'string' || analyzer.providerId === 'dsh-model-manager' || !service.model(analyzer)?.loaded) throw new Error('请选择已加载真实分析模型，或设置宿主默认模型')
      if (input.reasoningEffort !== undefined && (typeof input.reasoningEffort !== 'string' || !input.reasoningEffort)) throw new Error('分析推理档位无效')
      if (!same(before, revisions()) || overrides !== service.futureOverridesFingerprint()) throw new Error('SETTINGS_CONFLICT')
      const credentialName = state.config.parameterCompletion?.searchCredentialName ?? 'WEB_SEARCH_API_KEY'
      const officialHosts = new Map(targets.map(target => {
        const profile = state.profiles.find(p => p.providerId === target.model.providerId)
        let hostname: string | undefined
        try { const url = new URL(String(at(get(profile!.ns), [...profile!.path, 'baseURL']))); if (url.protocol === 'https:') hostname = url.hostname } catch {}
        return [JSON.stringify([target.model.providerId, target.model.modelId]), platformOfficialHosts(target.model.providerId, hostname)]
      }))
      const search = createParameterSearch(async () => {
        if (!ctx.credentials) throw new Error('搜索凭据服务不可用')
        const resolved = await ctx.credentials.resolve(credentialRef(credentialName))
        if (!resolved?.value) throw new Error('搜索凭据未配置')
        return resolved.value
      }, target => officialHosts.get(JSON.stringify([target.model.providerId, target.model.modelId])) ?? [])
      streaming = req.headers.accept?.includes('text/event-stream') ?? false
      if (streaming) { res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); timer = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n') }, 15_000); timer.unref() }
      const parameterAnalysis = await analyzeModelParameters(ctx.llm, search, selectedTargets as NonNullable<typeof selectedTargets[number]>[], { analyzer, ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort as string } : {}), analysisTimeoutSeconds }, abort.signal, value => { if (streaming) emit('progress', value) })
      abort.signal.throwIfAborted(); await service.refresh()
      if (generation !== currentGeneration || !same(before, revisions()) || overrides !== service.futureOverridesFingerprint() || startingFingerprint !== fingerprint(await readCatalogState())) throw new Error('SETTINGS_CONFLICT：分析期间目录或引用发生变化，请重新分析')
      const selectedFields = defaultParameterFields(parameterAnalysis), intents = parameterIntents(state, parameterAnalysis, selectedFields)
      const view: ModelParameterPreview = { ...present(state, intents, 'parameter'), revisions: before, catalogFingerprint: startingFingerprint, parameterAnalysis, selectedFields }
      const hasChanges = parameterAnalysis.results.some(r => r.status === 'ready' && r.suggestions.some(s => s.writable && s.value !== undefined && !same(s.currentValue, s.value)))
      if (hasChanges) catalog = { view, state, intents, resolutions: [], parameterAnalysis, selectedFields }
      else view.token = ''
      if (streaming) { emit('result', view); res.end() } else json(res, 200, view)
    } catch (failure) {
      if (streaming) { emit('error', { error: abort.signal.aborted ? '分析已取消' : failure instanceof Error ? failure.message : '参数分析失败' }); res.end() } else throw failure
    } finally { if (timer) clearInterval(timer); res.off?.('close', close); if (analysisAbort === abort) analysisAbort = undefined }
  })

  register('official-preview', async (req, res) => {
    const currentGeneration = ++generation
    preview = undefined; catalog = undefined; analysisAbort?.abort(); const abort = new AbortController(); analysisAbort = abort
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
      const before = revisions(), overrideFingerprint = service.futureOverridesFingerprint(), state = await readCatalogState()
      if (!same(before, revisions()) || overrideFingerprint !== service.futureOverridesFingerprint()) throw new Error('SETTINGS_CONFLICT')
      for (const model of analysis.models) if (!state.records.some(r => r.providerId === OFFICIAL_PROVIDER && r.modelId === model.id)) {
        const info = await ctx.llm.resolveModelInfo(OFFICIAL_PROVIDER, model.id).catch(() => undefined)
        if (info) state.records.push({ providerId: OFFICIAL_PROVIDER, modelId: model.id, name: info.name ?? model.id, source: 'host', loaded: false, nativeImage: info.inputModalities ? info.inputModalities.includes('image') ? 'yes' : 'no' : 'unknown', reasoningEfforts: 'reasoning' in info && info.reasoning ? info.reasoning.efforts.map(e => ({ id: e.id, name: e.name })) : [] })
      }
      const intents = officialIntents(state, analysis), view = present(state, intents, 'official')
      const result: OfficialPreview = { token: view.token, sourceUrl, analyzer, ...(reasoningEffort ? { reasoningEffort } : {}), analysisTimeoutSeconds, fetchedAt: pages[0].fetchedAt, pages: pages.map(({ url, fetchedAt }) => ({ url, fetchedAt })), analysis, diffs: [], notes: analysis.notes, revisions: before, overridesFingerprint: overrideFingerprint, localModelIds: state.models.map(model => model.id), catalog: view }
      abort.signal.throwIfAborted()
      if (generation !== currentGeneration) throw new Error('预览已失效')
      preview = result
      catalog = { view, state, intents, resolutions: [] }; updateOfficial()
      if (streaming) { emit('result', result); res.end() } else json(res, 200, result)
    } catch (failure) {
      if (streaming) { emit('error', { error: abort.signal.aborted ? '分析已取消' : failure instanceof Error ? failure.message : String(failure) }); res.end() }
      else throw failure
    } finally { if (timer) clearInterval(timer); res.off?.('close', close); if (analysisAbort === abort) analysisAbort = undefined }
  })

  register('official-apply', async (req, res) => {
    if (catalog?.view.origin !== 'official') throw new Error('官方预览已失效')
    await applyCatalog(await body(req), res)
  })

  register('official-restore', async (_req, res) => {
    await enqueue(async () => {
      let latest: Record<string, string> = {}
      try { latest = JSON.parse(await readFile(join(backupDir, 'latest.json'), 'utf8')) } catch {}
      if (latest.official) { await restoreBackup(await readBackup(latest.official), res); return }
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
      json(res, 200, { restored: true, snapshot: fullSnapshot() })
    })
  })
  ctx.effect(() => () => { preview = undefined; catalog = undefined; generation++; analysisAbort?.abort() }, 'dsh-model-manager: official cleanup')
}
