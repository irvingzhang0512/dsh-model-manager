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
import { DEFAULT_CONFIG, managedId, mapEffort, modelKey, resolveSelection, validateConfig, type ManagerConfig, type ModelRef, type Selection, type Verification } from './domain.js'
import { HostModelBridge, ModelManagerService, resolveDataDir } from './service.js'
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
  return !origin || (!!host && new URL(origin).host === host)
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
  json(res, /CONFLICT/.test(message) ? 409 : 400, { error: message })
}

async function verify(llm: LlmRuntime, attachments: AttachmentStore, service: ModelManagerService, ref: ModelRef, kind: Verification['kind'], signal: AbortSignal): Promise<Verification> {
  const model = service.model(ref)
  if (!model) throw new Error('模型未加载')
  const info = await llm.resolveModelInfo(ref.providerId, ref.modelId, signal)
  const messages: GenerateOptions['messages'] = [{ id: randomUUID() as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: kind === 'image' ? '图片是什么颜色？只回答颜色。' : kind === 'tools' ? '调用提供的工具。' : '只回答 OK。' }] }]
  if (kind === 'image') {
    const png = probePng()
    const attachment = await attachments.saveImage({ data: png, mediaType: 'image/png' })
    messages[0].content.push({ type: 'image', attachment })
  }
  const config = service.snapshot().config
  const effort = kind === 'reasoning' ? mapEffort(model, config.models[modelKey(ref)], config.manual.tier) : undefined
  const tools = kind === 'tools' ? [{ name: 'model_manager_probe', description: '测试工具，请调用', parameters: { type: 'object', properties: {} } }] : undefined
  let output = ''
  let usedTool = false
  let finish: Extract<StreamChunk, { type: 'finish' }> | undefined
  for await (const chunk of llm.stream({ provider: ref.providerId, model: ref.modelId, messages, tools, reasoningEffort: effort as never, signal })) {
    if (chunk.type === 'text-delta') output += chunk.text
    if (chunk.type === 'tool-call-delta' || chunk.type === 'block-end' && chunk.block.type === 'tool-call') usedTool = true
    if (chunk.type === 'finish') finish = chunk
  }
  const failed = finish?.reason.kind === 'error' || finish?.reason.kind === 'aborted'
  const result: Verification = {
    model: { providerId: ref.providerId, modelId: ref.modelId }, kind, status: signal.aborted ? 'cancelled' : failed ? 'rejected' : 'accepted',
    checkedAt: new Date().toISOString(), signature: service.signature(ref), requestCount: 1,
    behavior: kind === 'tools' ? usedTool ? 'observed' : 'not-observed' : kind === 'reasoning' ? 'unknown' : kind === 'image' ? /红|red/i.test(output) ? 'observed' : 'not-observed' : output ? 'observed' : 'not-observed',
    detail: failed ? finish?.reason.kind : kind === 'image' && !/红|red/i.test(output) ? `图像核对未通过：${output.slice(0, 120) || '无文字输出'}` : undefined,
  }
  await service.saveVerification(result)
  return result
}

export function apply(ctx: Host, entryConfig: Partial<ManagerConfig> = {}): void {
  const baseConfig: ManagerConfig = { ...structuredClone(DEFAULT_CONFIG), ...entryConfig }
  validateConfig(baseConfig)
  const scope = ctx.settings.register(name, Config, { base: baseConfig, applies: 'live', validate: validateConfig })
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
        const item = config.roles[role as keyof typeof config.roles]
        if (!item?.enabled) return false
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
    if (!ready || payload.agent.session.header.parentSession) return current
    const session = payload.agent.session.id as string
    const selection = service.effectiveSelection(session, payload.turn)
    if (current.provider === MANAGED_PROVIDER) return current
    const config = service.snapshot().config
    const candidates = selection.target ? resolveSelection(config, selection.target) : [{ providerId: current.provider, modelId: current.model }]
    const first = candidates[0]
    if (!first) return current
    const record = service.model(first)
    const effort = selection.tier && selection.tier !== 'auto' && selection.tier !== 'inherit'
      ? record ? mapEffort(record, config.models[modelKey(first)], selection.tier) : undefined : undefined
    if (selection.tier && !['auto', 'inherit'].includes(selection.tier) && !record) throw new Error('所选模型尚未由宿主加载')
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
      const revision = await service.update(input.config, input.revision)
      json(res, 200, { revision, config: service.snapshot().config, models: service.snapshot().models, nativeRevision: ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision })
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

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/native', handler: async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: '方法不允许' }); return }
    if (!trusted(req)) { json(res, 403, { error: '跨站请求被拒绝' }); return }
    try {
      const input = await body(req) as ModelRef & { image?: boolean; contextWindow?: number; maxTokens?: number; revision: number }
      if (!service.model(input)) throw new Error('模型未加载')
      if (input.contextWindow !== undefined && (!Number.isInteger(input.contextWindow) || input.contextWindow < 1)) throw new Error('上下文容量必须为正整数')
      if (input.maxTokens !== undefined && (!Number.isInteger(input.maxTokens) || input.maxTokens < 1)) throw new Error('最大输出能力必须为正整数')
      await bridge.applyNative(input, input, input.revision)
      await service.refresh()
      const revision = ctx.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision
      json(res, 200, { revision })
    } catch (err) { error(res, err) }
  } }), 'dsh-model-manager: native route')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/model-manager/logs', handler: async (req, res) => {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json(res, 405, { error: '方法不允许' }); return }
    json(res, 200, { events: await service.logs() })
  } }), 'dsh-model-manager: logs route')

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
