import { LlmAdapter, type ContentBlock, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createHash, randomUUID } from 'node:crypto'
import { classifyFailure, fromManagedId, LONG_CONTEXT_ALIAS, managedId, mergeSelection, modelKey, resolveSelection, visionRoute, type ManagerConfig, type ModelRecord, type ModelRef, type Selection } from './domain.js'
import { genericProviderAdapter } from './provider-adapter.js'
import type { ModelManagerService } from './service.js'

export const MANAGED_PROVIDER = 'dsh-model-manager'
/** 选择器里的 AUTO 条目：托管模式，按 auto.main 决定主模型，没配目标时回退到宿主默认模型。 */
export const AUTO_MODEL_ID = 'auto'

export class VisionRegistry {
  private bySession = new Map<string, Map<string, ImageAttachmentRef>>()
  add(session: string, refs: ImageAttachmentRef[]): void {
    const images = this.bySession.get(session) ?? new Map<string, ImageAttachmentRef>()
    for (const ref of refs) images.set(ref.attachmentId as string, ref)
    this.bySession.set(session, images)
  }
  get(session: string, id: string): ImageAttachmentRef | undefined { return this.bySession.get(session)?.get(id) }
  has(session: string, id: string): boolean { return this.bySession.get(session)?.has(id) ?? false }
  clear(session: string): void { this.bySession.delete(session) }
}

/**
 * 解析一次受管理请求的目标候选。
 * `auto` 表示选择器里的 AUTO 条目：按托管配置 auto.main 解析主模型，没配就用宿主默认模型；
 * `alias:x` 是固定模型的按序兜底；其余为受管理 ID 直达具体模型。
 */
function requestedModel(id: string, config: ManagerConfig, fallback?: ModelRef): ModelRef[] {
  if (id === AUTO_MODEL_ID) {
    const target = config.auto.main.target
    if (target) return resolveSelection(config, target)
    return fallback ? [fallback] : []
  }
  if (id.startsWith('alias:')) return resolveSelection(config, `@${id.slice(6)}`)
  return [fromManagedId(id)]
}

/** 解析一次请求生效的兜底策略：别名条目用别名覆盖叠在全局默认上，其余用全局默认。 */
function effectiveReliability(config: ManagerConfig, id: string): ManagerConfig['reliability'] {
  const base = { ...config.reliability }
  if (id.startsWith('alias:')) return { ...base, ...config.aliases[id.slice(6)]?.reliability }
  return base
}

/** 受管理条目参数基线：AUTO 用 auto.main，其余条目是固定模型、不带全局基线。 */
function baseSelection(config: ManagerConfig, id: string): Selection {
  return id === AUTO_MODEL_ID ? config.auto.main : {}
}

export class ManagedAdapter extends LlmAdapter {
  private cooldown = new Map<string, number>()
  constructor(private readonly llm: LlmRuntime, private readonly service: ModelManagerService, private readonly vision: VisionRegistry) { super() }

  providerInfo(): LlmProviderInfo { return { id: MANAGED_PROVIDER, name: '模型管理' } }
  providerRetryPolicy() { return { mode: 'normal' as const, maxRetries: 0, retryableCodes: [], initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } }
  imageRequestPricing() { return undefined }

  async listModels(): Promise<readonly LlmModelInfo[]> {
    const { config } = this.service.snapshot()
    // 只列 AUTO 与别名：逐个具体模型的条目与其余原生 Provider 完全重复，选择器里只会造成噪音。
    // 具体模型仍可用受管理 ID 直接寻址（宿主路由改写、子任务委派都走这条路径）。
    return [
      { provider: MANAGED_PROVIDER, id: AUTO_MODEL_ID, name: 'AUTO', inputModalities: ['text', 'image'] as const },
      ...Object.keys(config.aliases).map(name => ({ provider: MANAGED_PROVIDER, id: `alias:${name}`, name: `@${name}`, inputModalities: ['text', 'image'] as const })),
    ]
  }

  async resolveModel(_provider: string, id: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const config = this.service.snapshot().config
    const candidate = requestedModel(id, config, this.service.hostDefault())[0]
    if (!candidate) throw new Error(id === AUTO_MODEL_ID ? 'AUTO 没有可用目标：请到「AUTO 分工」配置主模型，或设置宿主默认模型' : '未配置可用模型')
    const info = await this.llm.resolveModelInfo(candidate.providerId, candidate.modelId, signal)
    return { ...info, provider: MANAGED_PROVIDER, id, name: id === AUTO_MODEL_ID ? 'AUTO' : id.startsWith('alias:') ? `@${id.slice(6)}` : info.name, inputModalities: ['text', 'image'] }
  }

  async prepareCall(provider: string, id: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const snapshot = this.service.snapshot()
    const candidates = requestedModel(id, snapshot.config, this.service.hostDefault())
    if (!candidates.length) throw new Error(id === AUTO_MODEL_ID ? 'AUTO 没有可用目标：请到「AUTO 分工」配置主模型，或设置宿主默认模型' : '未配置可用模型')
    const info = await this.llm.resolveModelInfo(candidates[0].providerId, candidates[0].modelId, signal)
    const model: LlmResolvedModelInfo = { ...info, provider, id, name: id === AUTO_MODEL_ID ? 'AUTO' : id.startsWith('alias:') ? `@${id.slice(6)}` : info.name, inputModalities: ['text', 'image'] }
    return { model, stream: (options: GenerateOptions) => {
      const session = options.sessionId as string || 'one-shot'
      const delegated = this.service.isDelegatedSession(session)
      const override = delegated ? undefined : this.service.activeSelection(session)
      const selection = delegated ? {} : mergeSelection(baseSelection(snapshot.config, id), override)
      return this.streamWithSnapshot(options, snapshot.config, snapshot.models, candidates, selection, effectiveReliability(snapshot.config, id), !!override && (override.thinking === 'off' || !!override.tier && !['auto', 'inherit'].includes(override.tier) || override.maxOutputTokens !== undefined))
    } }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const snapshot = this.service.snapshot()
    const config = snapshot.config
    const session = options.sessionId as string || 'one-shot'
    const delegated = this.service.isDelegatedSession(session)
    const override = delegated ? undefined : this.service.activeSelection(session)
    const selection = delegated ? {} : mergeSelection(baseSelection(config, options.model), override)
    yield* this.streamWithSnapshot(options, config, snapshot.models, requestedModel(options.model, config), selection, effectiveReliability(config, options.model), !!override && (override.thinking === 'off' || !!override.tier && !['auto', 'inherit'].includes(override.tier) || override.maxOutputTokens !== undefined))
  }

  private async *streamWithSnapshot(options: GenerateOptions, config: ManagerConfig, models: ModelRecord[], candidates: ModelRef[], selection: ReturnType<ModelManagerService['activeSelection']>, reliability: ManagerConfig['reliability'], lockedParams: boolean): AsyncIterable<StreamChunk> {
    const session = options.sessionId as string || 'one-shot'
    const managedRequestId = randomUUID()
    const turn = this.service.activeTurn(session)
    const collect = (blocks: ContentBlock[]): ImageAttachmentRef[] => blocks.flatMap(block => block.type === 'image' ? [block.attachment] : block.type === 'tool-result' ? collect(block.content) : [])
    const allImages = options.messages.flatMap(m => collect(m.content))
    const lastUser = [...options.messages].reverse().find(message => message.role === 'user')
    const currentUserImages = lastUser ? collect(lastUser.content) : []
    const historicalOnly = currentUserImages.length === 0 || currentUserImages.every(ref => this.vision.has(session, ref.attachmentId as string))
    this.vision.add(session, allImages)
    let attempt = 0
    let previousProvider: string | undefined
    let contextOnly = false
    const queue = selection?.target ? resolveSelection(config, selection.target) : [...candidates]
    const longContextCandidates = config.aliases[LONG_CONTEXT_ALIAS]?.candidates ?? []
    const tried = new Set<string>()
    for (const candidate of queue) {
      if (attempt >= reliability.maxAttempts) break
      if (tried.has(modelKey(candidate))) continue
      if (contextOnly && !longContextCandidates.some(ref => modelKey(ref) === modelKey(candidate))) continue
      if ((this.cooldown.get(modelKey(candidate)) ?? 0) > Date.now()) continue
      if (previousProvider === candidate.providerId) continue
      const model = models.find(item => modelKey(item) === modelKey(candidate))
      if (!model) continue
      tried.add(modelKey(candidate))
      const nativeImage = config.models[modelKey(candidate)]?.capability?.image ?? model.nativeImage
      const route = allImages.length && config.vision.enabled ? visionRoute(config.vision.policy, nativeImage, !!config.vision.target) : nativeImage === 'yes' ? 'native' : allImages.length ? historicalOnly ? 'history' : 'error' : 'native'
      if (route === 'error') throw new Error('当前模型不支持图片，且视觉辅助不可用')
      const effort = this.service.isDelegatedSession(session) ? options.reasoningEffort : genericProviderAdapter.reasoningEffort(model, config.models[modelKey(candidate)], selection ?? {})
      const prepared = route === 'sidecar' || route === 'history' ? this.sidecarMessages(options.messages, route === 'history') : options.messages
      const toWire = new Map<string, string>()
      const fromWire = new Map<string, string>()
      const names = [...(options.tools?.map(tool => tool.name as string) ?? []), ...options.messages.flatMap(message => message.content.filter(block => block.type === 'tool-call').map(block => block.name))]
      const reserved = new Set(names)
      for (const name of names) {
        if (/^[a-zA-Z0-9_-]+$/.test(name)) continue
        if (toWire.has(name)) continue
        let wire = `dmm_${createHash('sha256').update(name).digest('hex').slice(0, 24)}`
        while (reserved.has(wire)) wire += '_'
        reserved.add(wire)
        toWire.set(name, wire)
        fromWire.set(wire, name)
      }
      if (toWire.size) await this.service.log({ session, turn, managedRequestId, action: 'tool-name-mapping', provider: candidate.providerId, model: candidate.modelId, names: [...toWire.keys()] })
      const remapMessages = (messages: GenerateOptions['messages']) => messages.map(message => ({ ...message, content: message.content.map(block => block.type === 'tool-call' && toWire.has(block.name) ? { ...block, name: toWire.get(block.name)! } : block) }))
      const request = { ...options, provider: candidate.providerId, model: candidate.modelId, messages: prepared,
        tools: options.tools?.map(tool => toWire.has(tool.name as string) ? { ...tool, name: toWire.get(tool.name as string)! as never, description: `宿主工具 ${tool.name}。${tool.description}` } : tool),
        reasoningEffort: effort as GenerateOptions['reasoningEffort'] ?? options.reasoningEffort,
        maxTokens: selection?.maxOutputTokens ?? options.maxTokens }
      request.messages = remapMessages(request.messages)
      let retryThis = false
      let retried = false
      let downgraded = false
      do {
        retryThis = false
        attempt++
        let visible = false
        let failure: Extract<StreamChunk, { type: 'finish' }> | undefined
        let usage: Extract<StreamChunk, { type: 'usage' }>['usage'] | undefined
        const started = Date.now()
        try {
          for await (const chunk of this.llm.stream(request)) {
            if (chunk.type === 'usage') usage = chunk.usage
            if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
              failure = chunk
              break
            }
            if (chunk.type === 'block-start' || chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta' || chunk.type === 'block-end') visible = true
            if (chunk.type === 'tool-call-delta' && chunk.name && fromWire.has(chunk.name)) yield { ...chunk, name: fromWire.get(chunk.name)! }
            else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call' && fromWire.has(chunk.block.name)) yield { ...chunk, block: { ...chunk.block, name: fromWire.get(chunk.block.name)! } }
            else yield chunk
          }
        } catch (error) {
          failure = { type: 'finish', reason: { kind: options.signal?.aborted ? 'aborted' : 'error', failure: { code: 'NETWORK', message: error instanceof Error ? error.message : String(error) } } } as Extract<StreamChunk, { type: 'finish' }>
        }
        const failedReason = failure?.reason
        const failureInfo = failedReason && 'failure' in failedReason ? failedReason.failure : undefined
        await this.service.log({ session, turn, managedRequestId, logicalProvider: MANAGED_PROVIDER, logicalModel: options.model, provider: candidate.providerId,
          model: candidate.modelId, attempt, route, effort: request.reasoningEffort, durationMs: Date.now() - started, status: failedReason?.kind ?? 'success',
          failureCode: failureInfo?.code, httpStatus: failureInfo?.status, requestId: failureInfo?.requestId, usage })
        if (!failure) return
        if (visible || failedReason?.kind === 'aborted' || attempt >= reliability.maxAttempts) { yield failure; return }
        const classification = classifyFailure(failureInfo?.status, failureInfo?.code)
        if (classification === 'cooldown') this.cooldown.set(modelKey(candidate), Date.now() + 30000)
        if (classification === 'auth') previousProvider = candidate.providerId
        if (classification === 'context') {
          if (!longContextCandidates.length) { yield failure; return }
          contextOnly = true
          for (const ref of longContextCandidates) if (!queue.some(item => modelKey(item) === modelKey(ref))) queue.push(ref)
        }
        if (classification === 'parameter' && reliability.parameterDowngrade && !lockedParams && !downgraded && request.reasoningEffort && /reasoning|effort|thinking/i.test(failureInfo?.message ?? '') && attempt < reliability.maxAttempts) {
          request.reasoningEffort = undefined
          downgraded = true
          retryThis = true
        } else if (classification === 'retry' && reliability.retryTransient && !retried && attempt < reliability.maxAttempts) { retryThis = true; retried = true }
        else if (!['cooldown', 'auth', 'retry', 'context'].includes(classification)) { yield failure; return }
      } while (retryThis)
    }
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'NO_CANDIDATE', message: '模型候选均不可用或已达到尝试上限' } } }
  }

  private sidecarMessages(messages: GenerateOptions['messages'], historyOnly = false): GenerateOptions['messages'] {
    const transform = (blocks: ContentBlock[]): ContentBlock[] => {
      const result: ContentBlock[] = []
      for (const block of blocks) {
        if (block.type === 'image') result.push({ type: 'text', text: historyOnly ? `[历史图片附件 ${block.attachment.attachmentId}] 当前视觉辅助已关闭，无法重新查看原图。` : `[图片附件 ${block.attachment.attachmentId}] 请使用 model_manager_inspect_image 工具查看此原图；可对同一附件继续追问。` })
        else if (block.type === 'tool-result') result.push({ ...block, content: transform(block.content) })
        else result.push(block)
      }
      return result
    }
    return messages.map(message => ({ ...message, content: transform(message.content) }))
  }
}
