import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { modelKey, resolveSelection } from './domain.js'
import type { ModelManagerService } from './service.js'
import type { VisionRegistry } from './adapter.js'

async function cropImage(data: Uint8Array, region: string): Promise<Buffer> {
  const parts = region.split(',').map(value => Number(value.trim()))
  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value))) throw new Error('裁剪区域须为 x,y,width,height，数值范围 0 到 1')
  const [x, y, width, height] = parts
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw new Error('裁剪区域超出图片范围')
  const source = Buffer.from(data)
  const dimensions = await sharp(source).metadata()
  if (!dimensions.width || !dimensions.height) throw new Error('无法读取图片尺寸')
  const left = Math.floor(x * dimensions.width)
  const top = Math.floor(y * dimensions.height)
  const right = Math.min(dimensions.width, Math.ceil((x + width) * dimensions.width))
  const bottom = Math.min(dimensions.height, Math.ceil((y + height) * dimensions.height))
  return sharp(source).extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }).png().toBuffer()
}

export function registerManagerTools(deps: { tools: ToolRuntime; llm: LlmRuntime; attachments: AttachmentStore; service: ModelManagerService; vision: VisionRegistry }): () => void {
  const disposers: (() => void)[] = []

  disposers.push(deps.tools.register(defineTool({
    name: 'model_manager_inspect_image',
    description: '查看当前会话中图片附件的原图，可继续针对同一附件追问。仅使用模型管理提供的附件 ID。',
    parameters: {
      attachment_id: { type: 'string', required: true },
      question: { type: 'string', required: true },
      region: { type: 'string', description: '可选裁剪区域：归一化 x,y,width,height，例如 0.25,0.25,0.5,0.5。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      const session = exec.agent?.session.id as string || 'one-shot'
      const ref = deps.vision.get(session, args.attachment_id)
      if (!ref) throw new Error('附件不属于当前会话或引用已过期')
      const config = deps.service.snapshot().config
      if (!config.vision.enabled) throw new Error('视觉辅助未启用')
      const target = resolveSelection(config, config.vision.target ?? config.auto.roles.vision.target)[0]
      if (!target) throw new Error('尚未绑定视觉模型')
      const info = await deps.llm.resolveModelInfo(target.providerId, target.modelId, exec.signal)
      if (!info.inputModalities?.includes('image')) throw new Error('视觉模型未声明原生图片能力')
      const image = await deps.attachments.readImage(ref, exec.signal)
      const imageHash = createHash('sha256').update(image.data).digest('hex')
      const key = createHash('sha256').update(JSON.stringify([session, imageHash, args.question, args.region ?? '', modelKey(target), deps.service.snapshot().revision, deps.service.signature(target)])).digest('hex')
      const cached = deps.service.getVisionCache(key)
      if (cached) {
        await deps.service.log({ action: 'vision', session, provider: target.providerId, model: target.modelId, status: 'cache-hit' })
        return cached
      }
      const managedRequestId = randomUUID()
      const started = Date.now()
      try {
        const visualRef = args.region ? await deps.attachments.saveImage({ data: await cropImage(image.data, args.region), mediaType: 'image/png' }) : ref
        const prompt = `${args.question}${args.region ? '\n这张图是原图指定区域的裁剪。' : ''}`
        const messages: GenerateOptions['messages'] = [{ id: `model-manager:${Date.now()}` as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }, { type: 'image', attachment: visualRef }] }]
        let result = ''
        for await (const chunk of deps.llm.stream({ provider: target.providerId, model: target.modelId, messages, signal: exec.signal, sessionId: session as never })) {
          if (chunk.type === 'text-delta') result += chunk.text
          if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(`视觉调用失败：${chunk.reason.kind}`)
        }
        if (!result) throw new Error('视觉模型未返回可用文字')
        await deps.service.putVisionCache(key, result)
        await deps.service.log({ action: 'vision', session, managedRequestId, provider: target.providerId, model: target.modelId, status: 'success', durationMs: Date.now() - started })
        return result
      } catch (error) {
        await deps.service.log({ action: 'vision', session, managedRequestId, provider: target.providerId, model: target.modelId, status: exec.signal.aborted ? 'aborted' : 'error', durationMs: Date.now() - started })
        throw error
      }
    },
  })))

  return () => { for (const dispose of disposers.reverse()) dispose() }
}
