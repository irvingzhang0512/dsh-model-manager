import { randomUUID } from 'node:crypto'
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
import { DEFAULT_CONFIG, LONG_CONTEXT_ALIAS, managedId, migrateConfig, modelKey, probeSuggestions, resolveSelection, validateConfig, type ManagerConfig, type ModelRef, type ProbeSuggestion, type Role, type RoleSettings, type Selection, type Verification } from './domain.js'
import { genericProviderAdapter } from './provider-adapter.js'
import { HostModelBridge, ModelManagerService, isSettingsConflict, resolveDataDir, type ModelInputBridge } from './service.js'
import { ManagedAdapter, MANAGED_PROVIDER, VisionRegistry } from './adapter.js'
import { registerManagerTools } from './tools.js'
import { probePng } from './probe-image.js'

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

export const ROLES: Role[] = ['search', 'coding', 'review', 'strong', 'vision']
const ROLE_DUTIES: Record<Role, string> = { search: '检索与探索', coding: '实现和修复', review: '审查结果及风险', strong: '复杂分析与调试', vision: '图片理解' }
const TIER_VALUES = ['fast', 'balanced', 'deep', 'max', 'auto', 'inherit'] as const

/**
 * 用当前模型目录让一个 LLM 产出 AUTO 分工草案（主模型 + 各角色绑定），交给用户确认后由前端写入草稿。
 * 推荐调用本身用 AUTO 主模型（未配置时回退宿主默认模型）；只输出建议，不直接改配置。
 */
export async function recommendAssignment(llm: LlmRuntime, service: ModelManagerService, signal: AbortSignal): Promise<{ main?: Selection; roles?: Partial<Record<Role, RoleSettings>>; notes: string[] }> {
  const notes: string[] = []
  const { config, models } = service.snapshot()
  let runner: ModelRef | undefined
  try { runner = resolveSelection(config, config.auto.main.target)[0] } catch { /* 未配置主模型时回退 */ }
  runner ??= service.hostDefault()
  if (!runner || !service.model(runner)) throw new Error('请先在「AUTO 分工」配置主模型，或设置宿主默认模型，才能发起 AI 推荐')
  const catalog = models.map(model => ({
    id: `${model.providerId}/${model.modelId}`, name: model.name, image: model.nativeImage,
    contextWindow: model.contextWindow ?? null, efforts: model.reasoningEfforts.map(e => e.id),
    textVerified: service.getVerification(model, 'text')?.status ?? null,
  }))
  const prompt = `你在为 DSH 的模型管理插件规划 AUTO（托管）分工。可用模型目录（JSON 数组）：
${JSON.stringify(catalog)}

请按以下要求给出分工建议：
- main：主对话模型，选综合能力最强、上下文够用、已通过验证（若有证据）的模型；
- search：检索与探索，选快且便宜的模型；
- coding：实现和修复，选代码能力强且支持工具调用的模型；
- review：审查结果及风险，选推理深的模型；
- strong：复杂分析与调试，选最强推理模型（可与 main 相同也可不同）；
- vision：图片理解，必须从 image 字段为 "yes" 的模型中选。
规则：只能引用目录中存在的 id；每个角色给 target（{providerId, modelId}）与 tier（fast/balanced/deep/max 之一，主模型可为 auto）；某角色确实无合适模型时给 null。
只输出一个 JSON 对象，不要输出任何其他文字，形如：
{"main":{"target":{"providerId":"...","modelId":"..."},"tier":"auto"},"roles":{"search":{"target":{...},"tier":"fast"},"coding":{...},"review":{...},"strong":{...},"vision":null}}`
  const messages: GenerateOptions['messages'] = [{ id: randomUUID() as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }]
  let text = ''
  for await (const chunk of llm.stream({ provider: runner.providerId, model: runner.modelId, messages, signal })) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(`推荐请求失败：${chunk.reason.kind}`)
  }
  const start = text.indexOf('{'); const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('推荐模型没有返回可解析的 JSON')
  let parsed: { main?: { target?: unknown; tier?: unknown }; roles?: Record<string, { target?: unknown; tier?: unknown } | null> }
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { throw new Error('推荐模型返回的 JSON 无法解析，请重试') }
  const find = (value: unknown): ModelRef | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const target = value as { providerId?: unknown; modelId?: unknown; id?: unknown }
    if (typeof target.providerId === 'string' && typeof target.modelId === 'string') {
      const ref = { providerId: target.providerId, modelId: target.modelId }
      return models.some(model => model.providerId === ref.providerId && model.modelId === ref.modelId) ? ref : undefined
    }
    if (typeof target.id === 'string') {
      const [providerId, modelId] = target.id.split('/')
      return find({ providerId, modelId })
    }
    return undefined
  }
  const tierOf = (value: unknown): Selection['tier'] => TIER_VALUES.includes(value as never) ? value as Selection['tier'] : undefined
  let main: Selection | undefined
  const mainRef = find(parsed.main?.target)
  if (mainRef) main = { target: mainRef, ...(tierOf(parsed.main?.tier) ? { tier: tierOf(parsed.main!.tier) } : {}) }
  else notes.push('推荐结果没有给出有效的主模型，请手动选择。')
  const roles: Partial<Record<Role, RoleSettings>> = {}
  for (const role of ROLES) {
    const entry = parsed.roles?.[role]
    if (!entry) { notes.push(`推荐结果缺少 ${ROLE_DUTIES[role]}（${role}）角色。`); continue }
    const ref = find(entry.target)
    if (!ref) { notes.push(`${role} 角色未获得有效推荐（模型不在目录或不支持图片），保持未绑定。`); continue }
    roles[role] = { target: ref, ...(tierOf(entry.tier) ? { tier: tierOf(entry.tier) } : {}) }
  }
  if (!Object.keys(roles).length && !main) throw new Error('推荐结果没有任何有效分工，请重试或手动配置')
  return { main, roles, notes }
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
  void service.init().then(() => { ready = true }).catch(err => ctx.logger?.error?.(`[dsh-model-manager] 初始化失败: ${String(err)}`))
  ctx.effect(() => scope.watch(next => service.onSettingsChanged(next)), 'dsh-model-manager: settings')
  ctx.effect(() => ctx.llm.registerAdapter([MANAGED_PROVIDER], adapter), 'dsh-model-manager: adapter')
  ctx.effect(() => registerManagerTools({ tools: ctx.tools, subagents: ctx.subagents, llm: ctx.llm, attachments: ctx.attachments, service, vision }), 'dsh-model-manager: tools')
  ctx.effect(() => ctx.systemPrompt.section({ name: 'dsh-model-manager', order: 350,
    text: () => {
      const config = service.snapshot().config
      const descriptions: Record<string, string> = { search: '检索与探索', coding: '实现和修复', review: '审查结果及风险', strong: '复杂分析与调试', vision: '图片理解' }
      const available = Object.entries(descriptions).filter(([role]) => {
        const item = config.auto.roles[role as keyof typeof config.auto.roles]
        if (!item?.target) return false
        try { return resolveSelection(config, item.target).some(ref => !!service.model(ref)) } catch { return false }
      })
      const roleText = available.map(([role, description]) => `${role}：${description}`).join('；')
      return [roleText ? `需要独立完成的任务时，可调用 model_manager_delegate 委派给已配置角色。可用角色：${roleText}。普通任务直接完成；失败后可明确提高档位或选择更强角色，并传递已有结果与失败原因。` : '',
        config.vision.enabled ? '当消息中出现 [图片附件 ID] 时，使用 model_manager_inspect_image 针对具体问题查看原图；不要根据占位文字猜测图片内容。' : ''].filter(Boolean).join('\n')
    },
  }), 'dsh-model-manager: prompt')
  ctx.effect(() => ctx.on('llm/adapters-updated', () => { if (ready) void service.refresh().catch(() => {}) }), 'dsh-model-manager: directory')
  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const current = await next()
    if (!ready) return current
    const session = payload.agent.session.id as string
    if (payload.agent.session.header.parentSession) {
      if (current.provider === MANAGED_PROVIDER) service.markDelegatedSession(session)
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
      const suggestion = await recommendAssignment(ctx.llm, service, abort.signal)
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
