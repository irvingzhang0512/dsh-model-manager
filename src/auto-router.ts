import { randomUUID } from 'node:crypto'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { modelKey, resolveSelection, type ManagerConfig, type ModelRecord, type ModelRef, type Selection, type TaskGrade, type Verification } from './domain.js'

export interface AutoDecision { grade: TaskGrade; reason: string; selection: Selection; candidates: ModelRef[]; fallback: boolean }
const grades: TaskGrade[] = ['simple', 'normal', 'complex']

export function candidateForGrade(config: ManagerConfig, models: ModelRecord[], grade: TaskGrade, options: GenerateOptions, verification?: (ref: ModelRef) => (Verification & { stale?: boolean }) | undefined): AutoDecision | undefined {
  const flatten = (blocks: GenerateOptions['messages'][number]['content']): typeof blocks => blocks.flatMap(block => block.type === 'tool-result' ? [block, ...flatten(block.content)] : [block])
  const content = options.messages.flatMap(message => flatten(message.content))
  const hasImage = content.some(block => block.type === 'image')
  const textLength = content.filter(block => block.type === 'text').reduce((sum, block) => sum + block.text.length, 0)
  for (const candidateGrade of grades.slice(grades.indexOf(grade))) {
    const selection = config.auto[candidateGrade]
    if (!selection.target) continue
    const refs = resolveSelection(config, selection.target)
    const eligible = refs.filter(ref => {
      const model = models.find(item => modelKey(item) === modelKey(ref))
      if (!model) return false
      if (hasImage && !config.vision.enabled && (config.models[modelKey(ref)]?.capability?.image ?? model.nativeImage) !== 'yes') return false
      const toolEvidence = options.tools?.length ? verification?.(ref) : undefined
      if (toolEvidence && !toolEvidence.stale && toolEvidence.status === 'rejected') return false
      const contextWindow = config.models[modelKey(ref)]?.capability?.contextWindow ?? model.contextWindow
      if (contextWindow && textLength + (selection.maxOutputTokens ?? options.maxTokens ?? model.defaultMaxTokens ?? 1024) > contextWindow) return false
      if (selection.reasoningEffort && !model.reasoningEfforts.some(e => e.id === selection.reasoningEffort)) return false
      return true
    })
    if (eligible.length) return { grade: candidateGrade, reason: '', selection, candidates: eligible, fallback: candidateGrade !== grade }
  }
  return undefined
}

export async function evaluateTask(llm: LlmRuntime, config: ManagerConfig, options: GenerateOptions): Promise<{ grade: TaskGrade; reason: string; fallback: boolean; durationMs: number }> {
  const started = Date.now()
  const evaluator = config.auto.evaluator
  if (!evaluator) throw new Error('AUTO 尚未配置评估模型')
  const latest = [...options.messages].reverse().find(message => message.role === 'user')
  const currentText = latest?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  const latestText = currentText.length <= 5000 ? currentText : `${currentText.slice(0, 2500)}\n[中间内容已省略]\n${currentText.slice(-2500)}`
  const recent = options.messages.filter(message => message.role === 'user' || message.role === 'assistant').slice(-8)
    .map(message => `${message.role}: ${message.content.filter(block => block.type === 'text').map(block => block.text).join(' ').slice(0, 1200)}`).join('\n').slice(-7000)
  const imageUnknown = latest?.content.some(block => block.type === 'image') ?? false
  const prompt = `只判断下面这轮任务适合哪一级模型，不执行任务。输出一个 JSON 对象，grade 只能是 simple、normal、complex，reason 不超过 80 字。短句如“继续”必须结合上下文，信息不足选 normal。图片内容不可见时不要猜图。\n近期上下文：\n${recent}\n本轮请求：\n${latestText}\n图片内容不可见：${imageUnknown}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  try {
    const messages: GenerateOptions['messages'] = [{ id: randomUUID() as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }]
    let output = ''
    for await (const chunk of llm.stream({ provider: evaluator.providerId, model: evaluator.modelId, messages, signal })) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(`评估失败：${chunk.reason.kind}`)
      if (output.length > 2000) throw new Error('评估输出过长')
    }
    const start = output.indexOf('{'); const end = output.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('评估输出不是 JSON')
    const parsed = JSON.parse(output.slice(start, end + 1)) as { grade?: unknown; reason?: unknown }
    if (!grades.includes(parsed.grade as TaskGrade) || typeof parsed.reason !== 'string' || !parsed.reason.trim()) throw new Error('评估结果无效')
    return { grade: parsed.grade as TaskGrade, reason: parsed.reason.trim().slice(0, 80), fallback: false, durationMs: Date.now() - started }
  } catch (error) {
    if (options.signal?.aborted) throw error
    return { grade: 'normal', reason: `评估不可用，使用常规档：${error instanceof Error ? error.message : String(error)}`.slice(0, 120), fallback: true, durationMs: Date.now() - started }
  } finally { clearTimeout(timer) }
}
