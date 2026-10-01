import { randomUUID } from 'node:crypto'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ModelManagerService } from './service.js'
import type { ModelRef, Selection, TaskGrade } from './domain.js'

export async function recommendAuto(llm: LlmRuntime, service: ModelManagerService, runner: ModelRef | undefined, signal: AbortSignal): Promise<{ grades: Partial<Record<TaskGrade, Selection>>; notes: string[] }> {
  const { models } = service.snapshot()
  runner ??= service.hostDefault()
  if (!runner || !service.model(runner)) throw new Error('请选择用于生成建议的模型，或先设置宿主默认模型')
  const catalog = models.map(model => ({ providerId: model.providerId, modelId: model.modelId, name: model.name,
    image: model.nativeImage, contextWindow: model.contextWindow ?? null, efforts: model.reasoningEfforts.map(e => e.id) }))
  const prompt = `根据已加载模型目录，为简单、常规、复杂任务各推荐一个模型。只依据目录提供的能力，无法确认价格和性能时不要猜测。只返回 JSON，格式：{"simple":{"providerId":"...","modelId":"..."},"normal":{...},"complex":{...}}。\n${JSON.stringify(catalog)}`
  const messages: GenerateOptions['messages'] = [{ id: randomUUID() as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }]
  let output = ''
  for await (const chunk of llm.stream({ provider: runner.providerId, model: runner.modelId, messages, signal })) {
    if (chunk.type === 'text-delta') output += chunk.text
    if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(`推荐请求失败：${chunk.reason.kind}`)
  }
  const start = output.indexOf('{'); const end = output.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('推荐结果不是 JSON')
  const parsed = JSON.parse(output.slice(start, end + 1)) as Partial<Record<TaskGrade, ModelRef>>
  const grades: Partial<Record<TaskGrade, Selection>> = {}
  const notes: string[] = []
  for (const grade of ['simple', 'normal', 'complex'] as const) {
    const ref = parsed[grade]
    if (ref && models.some(model => model.providerId === ref.providerId && model.modelId === ref.modelId)) grades[grade] = { target: ref }
    else notes.push(`${grade} 档没有有效推荐，请手动选择。`)
  }
  return { grades, notes }
}
