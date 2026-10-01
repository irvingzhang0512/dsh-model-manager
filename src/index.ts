import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { LlmRuntime, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONFIG, LONG_CONTEXT_ALIAS, managedId, migrateConfig, modelKey, probeSuggestions, resolveSelection, validateConfig, type ManagerConfig, type ModelRef, type ProbeSuggestion, type Selection, type Verification } from './domain.js'
import { genericProviderAdapter } from './provider-adapter.js'
import { HostModelBridge, ModelManagerService, isSettingsConflict, resolveDataDir, type ModelInputBridge } from './service.js'
import { ManagedAdapter, MANAGED_PROVIDER, VisionRegistry } from './adapter.js'
import { registerManagerTools } from './tools.js'
import { probePng } from './probe-image.js'
import { OFFICIAL_SOURCES, fetchOfficial, officialDiffs, parseOfficialPages, type OfficialPreview, type SourceUrls } from './official-sync.js'
import { recommendAuto } from './recommend-auto.js'

export const name = 'dsh-model-manager'
export const inject = ['llm', 'settings', 'tools', 'subagents', 'attachments', 'webServer', 'systemPrompt']
export const Config = z.any<ManagerConfig>()

type Host = Context & { llm: LlmRuntime; settings: SettingsProvider; tools: ToolRuntime; subagents: SubagentRuntime; attachments: AttachmentStore; webServer: WebServer; systemPrompt: SystemPrompt }

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function trusted(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  const origin = req.headers.origin
  if (!origin) return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
  try { return !!host && new URL(origin).host === host } catch { return false }
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = ''
  for await (const chunk of req) {
    text += chunk.toString()
    if (text.length > 1024 * 1024) throw new Error('请求体过大')
  }
  return JSON.parse(text)
}

function error(res: ServerResponse, failure: unknown): void {
  const message = failure instanceof Error ? failure.message : String(failure)
  // 冲突可能是配置版本（service.update 抛字面量）或宿主 settings 的 SETTINGS_CONFLICT：两者都要走 409，否则前端只能用消息文本猜。
  json(res, /CONFLICT/.test(message) || isSettingsConflict(failure) ? 409 : 400, { error: message })
}

export async function verify(llm: LlmRuntime, attachments: AttachmentStore, service: ModelManagerService, ref: ModelRef, kind: Verification['kind'], signal: AbortSignal): Promise<Verification> {
  const model = service.model(ref)
  if (!model) throw new Error('模型未加载')
  const messages: GenerateOptions['messages'] = [{ id: randomUUID() as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: kind === 'image' ? '图片是什么颜色？只回答颜色。' : kind === 'tools' ? '调用提供的工具。' : '只回答 OK。' }] }]
  const config = service.snapshot().config
  const effort = kind === 'reasoning' ? genericProviderAdapter.reasoningEffort(model, config.models[modelKey(ref)], config.auto.main) : undefined
  const tools = kind === 'tools' ? [{ name: 'model_manager_probe', description: '测试工具，请调用', parameters: { type: 'object', properties: {} } }] : undefined
  let output = ''
  let usedTool = false
  let requestCount = 0
  let thrown: unknown
  let finish: Extract<StreamChunk, { type: 'finish' }> | undefined
  try {
    await llm.resolveModelInfo(ref.providerId, ref.modelId, signal)
    if (kind === 'image') {
      const attachment = await attachments.saveImage({ data: probePng(), mediaType: 'image/png' })
      messages[0].content.push({ type: 'image', attachment })
    }
    requestCount = 1
    for await (const chunk of llm.stream({ provider: ref.providerId, model: ref.modelId, messages, tools, reasoningEffort: effort as never, signal })) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (chunk.type === 'tool-call-delta' || chunk.type === 'block-end' && chunk.block.type === 'tool-call') usedTool = true
      if (chunk.type === 'finish') finish = chunk
    }
  } catch (error) { thrown = error }
  if (!finish && !thrown) thrown = new Error('模型流未返回结束状态')
  const failed = finish?.reason.kind === 'error' || finish?.reason.kind === 'aborted'
  const result: Verification = {
    model: { providerId: ref.providerId, modelId: ref.modelId }, kind, status: signal.aborted ? 'cancelled' : thrown ? 'network-error' : failed ? 'rejected' : 'accepted',
    checkedAt: new Date().toISOString(), signature: service.signature(ref, kind), requestCount,
    behavior: kind === 'tools' ? usedTool ? 'observed' : 'not-observed' : kind === 'reasoning' ? 'unknown' : kind === 'image' ? /红|red/i.test(output) ? 'observed' : 'not-observed' : output ? 'observed' : 'not-observed',
    detail: thrown ? String(thrown).slice(0, 160) : failed ? finish?.reason.kind : kind === 'image' && !/红|red/i.test(output) ? `图像核对未通过：${output.slice(0, 120) || '无文字输出'}` : undefined,
  }
  await service.saveVerification(result)
  return result
}

export interface ProbeResult {
  verifications: Verification[]
  suggestions: ProbeSuggestion[]
  cancelled: boolean
  /** 宿主声明为「不支持」时是否已临时提权为支持并实测（无论成败都已恢复或尝试恢复）。 */
  elevated: boolean
  /** 探测后恢复宿主原声明失败；面板中该模型的「宿主原生图片」可能停留在「支持」。 */
  restoreFailed: boolean
  notes: string[]
  /**
   * 探测结束时 `llm-pi-ai` 的最新 revision：探测期间可能提权/还原各写一次，
   * 调用方必须用这个 token 发起后续宿主声明写入，否则会带着过期 revision 撞上 SETTINGS_CONFLICT。
   */
  nativeRevision?: number
}

/**
 * 对一个模型执行图片能力探测。宿主在发出请求前会按模型声明把图片投影成文字占位，
 * 因此声明为「不支持」的模型必须先把宿主 input 声明临时提为支持再实测，否则探测永远得出「未观察到」。
 * 提权无论成败都会恢复原声明；提权失败时跳过探测并记录说明，避免把「图片未送达」误判成模型能力。
 */
export async function probeModel(llm: LlmRuntime, attachments: AttachmentStore, service: ModelManagerService, inputBridge: ModelInputBridge, ref: ModelRef, nativeImage: 'yes' | 'no' | 'unknown', signal: AbortSignal): Promise<ProbeResult> {
  const verifications: Verification[] = []
  const notes: string[] = []
  let elevated = false
  let restoreFailed = false
  const needsElevation = nativeImage === 'no'
  let original: readonly string[] | undefined
  if (needsElevation) {
    original = inputBridge.modelInput(ref)
    const revision = inputBridge.currentRevision()
    if (revision === undefined) notes.push('无法读取宿主设置版本，图片探测被跳过。')
    else {
      try { await inputBridge.setInput(ref, ['text', 'image'], revision); elevated = true }
      catch (error) { notes.push(`临时提权宿主声明失败（${String(error)}），图片探测被跳过。`) }
    }
  }
  try {
    if (!signal.aborted && !(needsElevation && !elevated)) verifications.push(await verify(llm, attachments, service, ref, 'image', signal))
  } finally {
    if (elevated) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const revision = inputBridge.currentRevision()
          if (revision === undefined) throw new Error('无法读取宿主设置版本')
          await inputBridge.setInput(ref, original, revision)
          restoreFailed = false
          break
        } catch (error) {
          restoreFailed = true
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 50))
          else notes.push(`恢复宿主声明失败（${String(error)}），请到模型卡片核对「宿主原生图片」。`)
        }
      }
      await service.refresh().catch(() => {})
    }
  }
  return { verifications, suggestions: probeSuggestions(verifications), cancelled: signal.aborted, elevated, restoreFailed, notes, nativeRevision: inputBridge.currentRevision() }
}

export function apply(ctx: Host, entryConfig: Partial<ManagerConfig> = {}): void {
  const baseConfig: ManagerConfig = { ...structuredClone(DEFAULT_CONFIG), ...entryConfig }
  validateConfig(baseConfig)
  const scope = ctx.settings.register(name, Config, { base: baseConfig, applies: 'live', validate: value => validateConfig(migrateConfig(value)) })
  const bridge = new HostModelBridge(ctx.llm, ctx.settings)
  const service = new ModelManagerService(bridge, resolveDataDir(), ctx.settings)
  const vision = new VisionRegistry()
  const adapter = new ManagedAdapter(ctx.llm, service, vision)
  let ready = false
  let officialPreview: OfficialPreview | undefined
  const officialBackup = join(resolveDataDir(), 'official-sync-backup.json')
  void service.init().then(() => { ready = true }).catch(err => ctx.logger?.error?.(`[dsh-model-manager] 初始化失败: ${String(err)}`))
  ctx.effect(() => scope.watch(next => service.onSettingsChanged(next)), 'dsh-model-manager: settings')
  ctx.effect(() => ctx.llm.registerAdapter([MANAGED_PROVIDER], adapter), 'dsh-model-manager: adapter')
  ctx.effect(() => registerManagerTools({ tools: ctx.tools, llm: ctx.llm, attachments: ctx.attachments, service, vision }), 'dsh-model-manager: tools')
  ctx.effect(() => ctx.systemPrompt.section({ name: 'dsh-model-manager', order: 350,
    text: () => {
      const config = service.snapshot().config
      const preferred = Object.entries(config.auto.preferences).filter(([, value]) => value.target).map(([duty, value]) => `${duty}：${typeof value.target === 'string' ? value.target : `${value.target!.providerId}/${value.target!.modelId}`}`)
      return [preferred.length ? `使用 DSH 原生 subagent 执行独立任务时，可参考这些模型偏好（非强制）：${preferred.join('；')}。` : '',
        config.vision.enabled ? '当消息中出现 [图片附件 ID] 时，使用 model_manager_inspect_image 针对具体问题查看原图；不要根据占位文字猜测图片内容。' : ''].filter(Boolean).join('\n')
    },
  }), 'dsh-model-manager: prompt')
  ctx.effect(() => ctx.on('llm/adapters-updated', () => { if (ready) void service.refresh().catch(() => {}) }), 'dsh-model-manager: directory')
  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const current = await next()
    if (!ready) return current
    const session = payload.agent.session.id as string
    if (payload.agent.session.header.parentSession) {
      if (current.provider === MANAGED_PROVIDER) {
        service.markDelegatedSession(session)
        if (current.model === 'auto') {
          const parent = service.latestAutoDecision(payload.agent.session.header.parentSession as string)
          const selected = parent?.candidates[0]
          if (selected) return { ...current, model: managedId(selected) }
        }
      }
      return current
    }
    const selection = service.effectiveSelection(session, payload.turn)
    if (current.provider === MANAGED_PROVIDER) return current
    const config = service.snapshot().config
    const candidates = selection.target ? resolveSelection(config, selection.target) : [{ providerId: current.provider, modelId: current.model }]
    const first = candidates[0]
    if (!first) return current
    const record = service.model(first)
    const effort = record ? genericProviderAdapter.reasoningEffort(record, config.models[modelKey(first)], selection) : undefined
    if ((selection.thinking === 'off' || selection.tier && !['auto', 'inherit'].includes(selection.tier)) && !record) throw new Error('所选模型尚未由宿主加载')
    if (!selection.target && !config.vision.enabled && !effort && selection.maxOutputTokens === undefined) return current
    return { ...current, provider: MANAGED_PROVIDER,
      model: typeof selection.target === 'string' ? `alias:${selection.target.slice(1)}` : managedId(first),
      ...(effort ? { reasoningEffort: effort as never } : {}),
      ...(selection.maxOutputTokens ? { maxTokens: selection.maxOutputTokens } : {}) }
  }, { global: true }), 'dsh-model-manager: selection')
  ctx.effect(() => ctx.on('session/event', (session, event) => { if (event.type === 'turn/end') service.endTurn(session.id as string, event.data.turn) }, { global: true }), 'dsh-model-manager: turn cleanup')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager', handler: async (req, res) => {
    if (!ready) { json(res, 503, { error: '模型管理初始化中' }); return }
    if (req.method === 'GET') { json(res, 200, { ...service.snapshot(), nativeRevision: ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision }); return }
    if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as { config: ManagerConfig; revision: number }
      await service.update(input.config, input.revision)
      // 必须返回完整快照（含 verifications）：客户端保存后会用该响应整体替换渲染状态，缺字段会导致渲染崩溃白屏。
      json(res, 200, { ...service.snapshot(), nativeRevision: ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision })
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: config route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/verify', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    const abort = new AbortController()
    res.on('close', () => { if (!res.writableEnded) abort.abort() })
    try {
      const input = await body(req) as { providerId: string; modelId: string; kind: Verification['kind'] }
      if (!['text', 'image', 'tools', 'reasoning'].includes(input.kind)) throw new Error('无效验证项目')
      const verification = await verify(ctx.llm, ctx.attachments, service, input, input.kind, abort.signal)
      json(res, 200, { verification })
    } catch (err) { if (!res.writableEnded) error(res, err) }
  } }), 'dsh-model-manager: verify route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/probe', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    const abort = new AbortController()
    res.on('close', () => { if (!res.writableEnded) abort.abort() })
    try {
      const input = await body(req) as { providerId: string; modelId: string }
      const ref: ModelRef = { providerId: input.providerId, modelId: input.modelId }
      const record = service.model(ref)
      if (!record) throw new Error('模型未加载')
      const result = await probeModel(ctx.llm, ctx.attachments, service, bridge, ref, record.nativeImage, abort.signal)
      json(res, 200, result)
    } catch (err) { if (!res.writableEnded) error(res, err) }
  } }), 'dsh-model-manager: probe route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/refresh', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try { await service.refresh(); json(res, 200, { ...service.snapshot(), nativeRevision: ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision }) }
    catch (err) { error(res, err) }
  } }), 'dsh-model-manager: refresh route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/subagents', handler: async (req, res) => {
    const namespace = 'subagent-model-selection'
    const revision = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === namespace)?.revision
    if (req.method === 'GET') { json(res, 200, { revision, value: ctx.settings.get(namespace) ?? { enabled: false, allowedModels: [] } }); return }
    if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as { revision: number; enabled: boolean; allowedModels: { provider: string; model: string }[] }
      if (revision === undefined || input.revision !== revision) throw new Error('SETTINGS_CONFLICT')
      if (typeof input.enabled !== 'boolean' || !Array.isArray(input.allowedModels) || input.enabled && !input.allowedModels.length) throw new Error('启用子 Agent 模型选择时至少选择一个模型')
      const keys = new Set<string>()
      for (const route of input.allowedModels) {
        if (!service.model({ providerId: route.provider, modelId: route.model })) throw new Error(`子 Agent 模型尚未加载：${route.provider}/${route.model}`)
        const key = `${route.provider}\0${route.model}`
        if (keys.has(key)) throw new Error('子 Agent 模型重复')
        keys.add(key)
      }
      await ctx.settings.mutate(namespace, [{ op: 'set', path: ['enabled'], value: input.enabled }, { op: 'set', path: ['allowedModels'], value: input.allowedModels }], revision)
      json(res, 200, { revision: ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === namespace)?.revision, value: ctx.settings.get(namespace) })
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: subagents route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/official-preview', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as { sources?: SourceUrls }
      const sources = input.sources ?? OFFICIAL_SOURCES
      if (!sources || Object.keys(OFFICIAL_SOURCES).some(key => typeof sources[key as keyof SourceUrls] !== 'string')) throw new Error('官方资料来源不完整')
      const { pages, fetchedAt } = await fetchOfficial(sources)
      const models = parseOfficialPages(pages)
      const revision = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-deepseek')?.revision
      if (revision === undefined) throw new Error('DSH 未加载 DeepSeek 官方配置')
      officialPreview = { token: randomUUID(), sources, fetchedAt, models, diffs: officialDiffs(service.snapshot().models, models, sources.models), notes: [], revision }
      json(res, 200, officialPreview)
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: official preview')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/official-apply', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as { token: string; selected: string[] }
      const preview = officialPreview
      if (!preview || input.token !== preview.token || !Array.isArray(input.selected) || input.selected.some(id => !preview.diffs.some(diff => diff.id === id))) throw new Error('同步预览已失效，请重新刷新')
      if (!input.selected.length || new Set(input.selected).size !== input.selected.length) throw new Error('请选择不重复的同步差异')
      const revision = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-deepseek')?.revision
      if (revision !== preview.revision) throw new Error('SETTINGS_CONFLICT')
      const section = ctx.settings.get('llm-deepseek') as { models?: { id: string; name?: string; contextWindow?: number; inputModalities?: string[]; [key: string]: unknown }[] } | undefined
      if (!section?.models?.length) throw new Error('DeepSeek 官方模型清单不可编辑')
      const original = structuredClone(section.models)
      const updated = structuredClone(original)
      for (const diff of preview.diffs.filter(item => input.selected.includes(item.id))) {
        if (diff.field === 'id') continue
        if (diff.field === 'addModel') {
          const official = diff.after as (typeof preview.models)[number]
          if (updated.some(item => item.id === official.id)) throw new Error(`模型已存在：${official.id}`)
          updated.push({ id: official.id, name: official.name, contextWindow: official.contextWindow, inputModalities: official.image ? ['text', 'image'] : ['text'], ...(official.id === 'deepseek-flash' ? { systemPromptUpdate: 'in-history' } : {}) })
          continue
        }
        const model = updated.find(item => item.id === diff.id.split(':')[0])
        if (!model) throw new Error(`模型清单已变化：${diff.id}`)
        if (diff.field === 'name') model.name = diff.after as string
        if (diff.field === 'contextWindow') model.contextWindow = diff.after as number
        if (diff.field === 'inputModalities') model.inputModalities = diff.after === 'yes' ? ['text', 'image'] : ['text']
      }
      if (input.selected.includes('deepseek-v4-flash:id') && !updated.some(item => item.id === 'deepseek-flash')) throw new Error('迁移旧 Flash 引用前须先添加新 Flash 模型')
      const originalConfig = service.snapshot()
      await mkdir(resolveDataDir(), { recursive: true })
      const backup = { at: new Date().toISOString(), models: original, config: originalConfig.config, appliedOfficialRevision: undefined as number | undefined, appliedPluginRevision: undefined as number | undefined }
      await writeFile(officialBackup, JSON.stringify(backup), { encoding: 'utf8', mode: 0o600 })
      const changedHost = JSON.stringify(updated) !== JSON.stringify(original)
      if (changedHost) await ctx.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: updated }], revision)
      try {
        const next = structuredClone(originalConfig.config)
        if (input.selected.includes('deepseek-v4-flash:id')) {
          const change = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            if ('providerId' in value && 'modelId' in value && value.providerId === 'deepseek-official' && value.modelId === 'deepseek-v4-flash') value.modelId = 'deepseek-flash'
            for (const item of Object.values(value)) change(item)
          }
          change(next)
        }
        next.official = { checkedAt: preview.fetchedAt, sources: preview.sources }
        await service.update(next, originalConfig.revision)
      } catch (failure) {
        if (changedHost) {
          const rollbackRevision = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-deepseek')?.revision
          if (rollbackRevision !== undefined) await ctx.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: original }], rollbackRevision)
        }
        throw failure
      }
      await service.refresh()
      backup.appliedOfficialRevision = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-deepseek')?.revision
      backup.appliedPluginRevision = service.snapshot().revision
      await writeFile(officialBackup, JSON.stringify(backup), { encoding: 'utf8', mode: 0o600 })
      officialPreview = undefined
      json(res, 200, { applied: input.selected.length, backupAt: new Date().toISOString(), snapshot: service.snapshot() })
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: official apply')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/official-restore', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const backup = JSON.parse(await readFile(officialBackup, 'utf8')) as { models: unknown[]; config: ManagerConfig; appliedOfficialRevision?: number; appliedPluginRevision?: number; restored?: boolean }
      const revision = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-deepseek')?.revision
      if (revision === undefined) throw new Error('DeepSeek 配置不可用')
      if (backup.restored || backup.appliedOfficialRevision === undefined || backup.appliedPluginRevision === undefined || revision !== backup.appliedOfficialRevision || service.snapshot().revision !== backup.appliedPluginRevision) throw new Error('SETTINGS_CONFLICT：同步后配置已有变化，请手动核对备份')
      await ctx.settings.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: backup.models }], revision)
      await service.update(backup.config, service.snapshot().revision)
      await service.refresh()
      await writeFile(officialBackup, JSON.stringify({ ...backup, restored: true }), { encoding: 'utf8', mode: 0o600 })
      json(res, 200, { restored: true, snapshot: service.snapshot() })
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: official restore')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/native', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as ModelRef & { image?: boolean; contextWindow?: number; maxTokens?: number; clear?: ('image' | 'contextWindow' | 'maxTokens')[]; revision: number }
      if (!service.model(input)) throw new Error('模型未加载')
      if (input.clear && (!Array.isArray(input.clear) || !input.clear.length || input.clear.some(field => !['image', 'contextWindow', 'maxTokens'].includes(field)))) throw new Error('无效的清除字段')
      if (input.clear && (input.image !== undefined || input.contextWindow !== undefined || input.maxTokens !== undefined)) throw new Error('清除与设置不能在同一次操作中混用')
      if (input.contextWindow !== undefined && (!Number.isInteger(input.contextWindow) || input.contextWindow < 1)) throw new Error('上下文容量必须为正整数')
      if (input.maxTokens !== undefined && (!Number.isInteger(input.maxTokens) || input.maxTokens < 1)) throw new Error('最大输出能力必须为正整数')
      if (input.clear) await bridge.clearNative(input, input.clear, input.revision)
      else await bridge.applyNative(input, input, input.revision)
      await service.refresh()
      const revision = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision
      json(res, 200, { revision })
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: native route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/logs', handler: async (req, res) => {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json(res, 405, { error: '方法不允许' }); return }
    json(res, 200, { events: await service.logs() })
  } }), 'dsh-model-manager: logs route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/recommend', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    const abort = new AbortController()
    res.on('close', () => { if (!res.writableEnded) abort.abort() })
    try {
      const input = await body(req) as { evaluator?: ModelRef }
      const suggestion = await recommendAuto(ctx.llm, service, input.evaluator, abort.signal)
      json(res, 200, suggestion)
    } catch (err) { if (!res.writableEnded) error(res, err) }
  } }), 'dsh-model-manager: recommend route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/overrides', handler: async (req, res) => {
    if (req.method === 'GET') {
      const sessionId = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('sessionId')
      if (!sessionId) { json(res, 400, { error: '缺少会话 ID' }); return }
      json(res, 200, service.getOverride(sessionId)); return
    }
    if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as { sessionId: string; scope: 'session' | 'nextTurn'; selection?: Selection }
      if (input.scope !== 'session' && input.scope !== 'nextTurn') throw new Error('无效覆盖范围')
      await service.setOverride(input.sessionId, input.scope, input.selection)
      json(res, 200, service.getOverride(input.sessionId))
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: overrides route')
}
