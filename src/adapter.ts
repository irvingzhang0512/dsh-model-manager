import { LlmAdapter, type ContentBlock, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { classifyFailure, fromManagedId, managedId, mergeSelection, modelKey, resolveSelection, visionRoute, type ManagerConfig, type ModelRef } from './domain.js'
import { genericProviderAdapter } from './provider-adapter.js'
import type { ModelManagerService } from './service.js'

export const MANAGED_PROVIDER = 'dsh-model-manager'

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

function requestedModel(id: string, config: ManagerConfig): ModelRef[] {
  if (id.startsWith('alias:')) return resolveSelection(config, `@${id.slice(6)}`)
  return [fromManagedId(id)]
}

export class ManagedAdapter extends LlmAdapter {
  private cooldown = new Map<string, number>()
  constructor(private readonly llm: LlmRuntime, private readonly service: ModelManagerService, private readonly vision: VisionRegistry) { super() }

  providerInfo(): LlmProviderInfo { return { id: MANAGED_PROVIDER, name: '模型管理' } }
  providerRetryPolicy() { return { mode: 'normal' as const, maxRetries: 0, retryableCodes: [], initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } }
  imageRequestPricing() { return undefined }

  async listModels(): Promise<readonly LlmModelInfo[]> {
    const { config, models } = this.service.snapshot()
    return [
      ...models.map(m => ({ provider: MANAGED_PROVIDER, id: managedId(m), name: `${m.name} · ${m.providerId}`, inputModalities: ['text', 'image'] as const })),
      ...Object.keys(config.aliases).map(name => ({ provider: MANAGED_PROVIDER, id: `alias:${name}`, name: `@${name}`, inputModalities: ['text', 'image'] as const })),
    ]
  }

  async resolveModel(_provider: string, id: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const config = this.service.snapshot().config
    const candidate = requestedModel(id, config)[0]
    const info = await this.llm.resolveModelInfo(candidate.providerId, candidate.modelId, signal)
    return { ...info, provider: MANAGED_PROVIDER, id, name: id.startsWith('alias:') ? `@${id.slice(6)}` : info.name, inputModalities: ['text', 'image'] }
  }

  async prepareCall(provider: string, id: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const snapshot = this.service.snapshot()
    const candidates = requestedModel(id, snapshot.config)
    if (!candidates.length) throw new Error('未配置可用模型')
    const info = await this.llm.resolveModelInfo(candidates[0].providerId, candidates[0].modelId, signal)
    const model: LlmResolvedModelInfo = { ...info, provider, id, name: id.startsWith('alias:') ? `@${id.slice(6)}` : info.name, inputModalities: ['text', 'image'] }
    return { model, stream: (options: GenerateOptions) => {
      const session = options.sessionId as string || 'one-shot'
      const override = this.service.activeSelection(session)
      const selection = mergeSelection(snapshot.config.mode === 'manual' ? snapshot.config.manual : snapshot.config.auto, override)
      return this.streamWithSnapshot(options, snapshot.config, candidates, selection, !!override && (override.thinking === 'off' || !!override.tier && !['auto', 'inherit'].includes(override.tier) || override.maxOutputTokens !== undefined))
    } }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config = this.service.snapshot().config
    const session = options.sessionId as string || 'one-shot'
    const override = this.service.activeSelection(session)
    const selection = mergeSelection(config.mode === 'manual' ? config.manual : config.auto, override)
    yield* this.streamWithSnapshot(options, config, requestedModel(options.model, config), selection, !!override && (override.thinking === 'off' || !!override.tier && !['auto', 'inherit'].includes(override.tier) || override.maxOutputTokens !== undefined))
  }

  private async *streamWithSnapshot(options: GenerateOptions, config: ManagerConfig, candidates: ModelRef[], selection: ReturnType<ModelManagerService['activeSelection']>, lockedParams: boolean): AsyncIterable<StreamChunk> {
    const session = options.sessionId as string || 'one-shot'
    const collect = (blocks: ContentBlock[]): ImageAttachmentRef[] => blocks.flatMap(block => block.type === 'image' ? [block.attachment] : block.type === 'tool-result' ? collect(block.content) : [])
    const allImages = options.messages.flatMap(m => collect(m.content))
    const lastUser = [...options.messages].reverse().find(message => message.role === 'user')
    const currentUserImages = lastUser ? collect(lastUser.content) : []
    const historicalOnly = currentUserImages.length === 0 || currentUserImages.every(ref => this.vision.has(session, ref.attachmentId as string))
    this.vision.add(session, allImages)
    let attempt = 0
    let previousProvider: string | undefined
    let contextOnly = false
    const queue = [...candidates]
    const longContextCandidates = config.reliability.longContextCandidates ?? []
    const tried = new Set<string>()
    for (const candidate of queue) {
      if (attempt >= config.reliability.maxAttempts) break
      if (tried.has(modelKey(candidate))) continue
      if (contextOnly && !longContextCandidates.some(ref => modelKey(ref) === modelKey(candidate))) continue
      if ((this.cooldown.get(modelKey(candidate)) ?? 0) > Date.now()) continue
      if (previousProvider === candidate.providerId) continue
      const model = this.service.model(candidate)
      if (!model) continue
      tried.add(modelKey(candidate))
      const nativeImage = config.models[modelKey(candidate)]?.capability?.image ?? model.nativeImage
      const route = allImages.length && config.vision.enabled ? visionRoute(config.vision.policy, nativeImage, !!config.vision.target) : nativeImage === 'yes' ? 'native' : allImages.length ? historicalOnly ? 'history' : 'error' : 'native'
      if (route === 'error') throw new Error('当前模型不支持图片，且视觉辅助不可用')
      const effort = genericProviderAdapter.reasoningEffort(model, config.models[modelKey(candidate)], selection ?? {})
      const prepared = route === 'sidecar' || route === 'history' ? this.sidecarMessages(options.messages, route === 'history') : options.messages
      const request = { ...options, provider: candidate.providerId, model: candidate.modelId, messages: prepared,
        reasoningEffort: effort as GenerateOptions['reasoningEffort'] ?? options.reasoningEffort,
        maxTokens: selection?.maxOutputTokens ?? options.maxTokens }
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
        for await (const chunk of this.llm.stream(request)) {
          if (chunk.type === 'usage') usage = chunk.usage
          if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
            failure = chunk
            break
          }
          if (chunk.type === 'block-start' || chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta' || chunk.type === 'block-end') visible = true
          yield chunk
        }
        const failedReason = failure?.reason
        const failureInfo = failedReason && 'failure' in failedReason ? failedReason.failure : undefined
        await this.service.log({ session, logicalProvider: MANAGED_PROVIDER, logicalModel: options.model, provider: candidate.providerId,
          model: candidate.modelId, attempt, route, effort: request.reasoningEffort, durationMs: Date.now() - started, status: failedReason?.kind ?? 'success',
          failureCode: failureInfo?.code, httpStatus: failureInfo?.status, requestId: failureInfo?.requestId, usage })
        if (!failure) return
        if (visible || failedReason?.kind === 'aborted' || attempt >= config.reliability.maxAttempts) { yield failure; return }
        const classification = classifyFailure(failureInfo?.status, failureInfo?.code)
        if (classification === 'cooldown') this.cooldown.set(modelKey(candidate), Date.now() + 30000)
        if (classification === 'auth') previousProvider = candidate.providerId
        if (classification === 'context') {
          if (!longContextCandidates.length) { yield failure; return }
          contextOnly = true
          for (const ref of longContextCandidates) if (!queue.some(item => modelKey(item) === modelKey(ref))) queue.push(ref)
        }
        if (classification === 'parameter' && config.reliability.parameterDowngrade && !lockedParams && !downgraded && request.reasoningEffort && /reasoning|effort|thinking/i.test(failureInfo?.message ?? '') && attempt < config.reliability.maxAttempts) {
          request.reasoningEffort = undefined
          downgraded = true
          retryThis = true
        } else if (classification === 'retry' && config.reliability.retryTransient && !retried && attempt < config.reliability.maxAttempts) { retryThis = true; retried = true }
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
