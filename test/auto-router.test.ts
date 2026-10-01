import { describe, expect, it, vi } from 'vitest'
import { candidateForGrade, evaluateTask } from '../src/auto-router.ts'
import { DEFAULT_CONFIG, type ModelRecord } from '../src/domain.ts'

const makeModel = (modelId: string, image: ModelRecord['nativeImage'] = 'no', contextWindow = 10000): ModelRecord => ({ providerId: 'p', modelId, name: modelId, nativeImage: image, reasoningEfforts: [{ id: 'high', name: 'High' }], contextWindow, source: 'host', loaded: true })
const message = (text: string, image = false) => ({ id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }, ...(image ? [{ type: 'image', attachment: { id: 'img' } }] : [])] })

describe('AUTO 任务选择', () => {
  it('只调用一次独立评估器，结果为复杂档', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.auto.evaluator = { providerId: 'p', modelId: 'eval' }
    const stream = vi.fn(() => (async function* () { yield { type: 'text-delta', text: '{"grade":"complex","reason":"需要多步推理"}' }; yield { type: 'finish', reason: { kind: 'stop' } } })())
    const result = await evaluateTask({ stream } as never, config, { messages: [message('分析缺陷')] } as never)
    expect(result).toMatchObject({ grade: 'complex', fallback: false })
    expect(stream).toHaveBeenCalledTimes(1)
    expect(stream.mock.calls[0][0]).toMatchObject({ provider: 'p', model: 'eval' })
    expect(stream.mock.calls[0][0]).not.toHaveProperty('tools')
  })
  it('无效评估只回退常规档，图片与上下文约束跳到更高兼容档', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.auto.evaluator = { providerId: 'p', modelId: 'eval' }
    config.auto.simple.target = { providerId: 'p', modelId: 'short' }
    config.auto.normal.target = { providerId: 'p', modelId: 'text' }
    config.auto.complex.target = { providerId: 'p', modelId: 'vision' }
    const stream = vi.fn(() => (async function* () { yield { type: 'text-delta', text: 'invalid' } })())
    expect(await evaluateTask({ stream } as never, config, { messages: [message('继续')] } as never)).toMatchObject({ grade: 'normal', fallback: true })
    const models = [makeModel('short', 'no', 10), makeModel('text'), makeModel('vision', 'yes')]
    expect(candidateForGrade(config, models, 'simple', { messages: [message('x'.repeat(100), true)] } as never)).toMatchObject({ grade: 'complex', fallback: true })
    expect(candidateForGrade(config, models.slice(0, 2), 'simple', { messages: [message('图片', true)] } as never)).toBeUndefined()
  })
})
