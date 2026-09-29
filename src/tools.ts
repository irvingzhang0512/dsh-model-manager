import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { managedId, modelKey, resolveSelection, type Role } from './domain.js'
import { genericProviderAdapter } from './provider-adapter.js'
import type { ModelManagerService } from './service.js'
import type { VisionRegistry } from './adapter.js'
import { MANAGED_PROVIDER } from './adapter.js'

const roles: Role[] = ['search', 'coding', 'review', 'strong', 'vision']

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

export function registerManagerTools(deps: { tools: ToolRuntime; subagents: SubagentRuntime; llm: LlmRuntime; attachments: AttachmentStore; service: ModelManagerService; vision: VisionRegistry }): () => void {
  const disposers: (() => void)[] = []
  let running = 0
  const codingByWorkspace = new Map<string, number>()

  disposers.push(deps.tools.register(defineTool({
    name: 'model_manager_delegate',
    description: '按已配置的角色委派独立任务。Search 搜索，Coding 实现，Review 审查，Strong 深度分析，Vision 图像理解。仅在角色已绑定模型时可用。',
    parameters: {
      role: { type: 'string', required: true, enum: roles },
      task: { type: 'string', required: true },
      expected_result: { type: 'string', required: true },
      upgrade_tier: { type: 'string', enum: ['fast', 'balanced', 'deep', 'max'] },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error('缺少父 Agent')
      const config = deps.service.snapshot().config
      if (config.mode !== 'auto') throw new Error('子 Agent 分发只在自动（托管）模式下可用：到「模型管理 → Manual/Auto」把模式切到「自动」')
      const role = args.role as Role
      const roleConfig = config.roles[role]
      if (!roleConfig) throw new Error(`角色 ${role} 不存在`)
      if (!roleConfig.target) throw new Error(`角色 ${role} 未绑定模型：到「模型管理 → Manual/Auto」的角色卡里绑定`)
      let model: ReturnType<typeof resolveSelection>[number]
      try { model = resolveSelection(config, roleConfig.target)[0] } catch (error) { throw new Error(`角色 ${role} 绑定的目标不可用：${error instanceof Error ? error.message : String(error)}`) }
      if (!model || !deps.service.model(model)) throw new Error(`角色 ${role} 未绑定有效模型`)
      const workspace = exec.agent.session.header.cwd?.toLowerCase() ?? `session:${exec.agent.session.id}`
      if (running >= 3 || (role === 'coding' && (codingByWorkspace.get(workspace) ?? 0) >= 1)) throw new Error('并行子任务已达上限')
      const provider = deps.subagents.list().find(name => deps.subagents.getProvider(name)?.capabilities.agentOptions && deps.subagents.getProvider(name)?.capabilities.toolFilter)
      if (!provider) throw new Error('当前宿主未提供支持模型选项和工具限制的子 Agent Provider')
      running++
      if (role === 'coding') codingByWorkspace.set(workspace, (codingByWorkspace.get(workspace) ?? 0) + 1)
      try {
        const record = deps.service.model(model)!
        const effort = genericProviderAdapter.reasoningEffort(record, config.models[modelKey(model)], { ...roleConfig, tier: args.upgrade_tier as typeof roleConfig.tier ?? roleConfig.tier })
        const run = await deps.subagents.start(provider, {
          parent: exec.agent, signal: exec.signal, label: `${role}: ${args.task.slice(0, 40)}`,
          prompt: [{ type: 'text', text: `职责：${role}\n任务：${args.task}\n结果要求：${args.expected_result}` }],
          agentOptions: { provider: MANAGED_PROVIDER, model: managedId(model), ...(effort ? { reasoningEffort: effort as never } : {}) },
          toolFilter: { deny: ['model_manager_delegate'] },
        })
        try {
          const result = await run.result
          await deps.service.log({ action: 'delegate', role, provider: model.providerId, model: model.modelId, status: result.stopReason, session: exec.agent.session.id })
          const output = result.output.filter(b => b.type === 'text').map(b => b.text).join('\n')
          return result.stopReason === 'completed' ? output || '子任务已完成，但没有文字结果。' : `子任务${result.stopReason}：${result.diagnostic ?? output}`
        } finally { await run.dispose() }
      } finally {
        running--
        if (role === 'coding') {
          const remaining = (codingByWorkspace.get(workspace) ?? 1) - 1
          if (remaining) codingByWorkspace.set(workspace, remaining)
          else codingByWorkspace.delete(workspace)
        }
      }
    },
  })))

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
      const target = resolveSelection(config, config.vision.target ?? config.roles.vision.target)[0]
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
