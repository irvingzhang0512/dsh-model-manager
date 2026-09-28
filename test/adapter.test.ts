import { describe, expect, it, vi } from 'vitest'
import { ManagedAdapter, VisionRegistry } from '../src/adapter.ts'
import { DEFAULT_CONFIG, managedId, type ModelRecord } from '../src/domain.ts'

const model: ModelRecord = { providerId: 'provider-a', modelId: 'text', name: 'Text', nativeImage: 'no', nativeTools: 'unknown', reasoningEfforts: [{ id: 'low', name: 'Low' }], source: 'host', loaded: true }
const fallbackModel: ModelRecord = { ...model, providerId: 'provider-b' }
function harness(config = structuredClone(DEFAULT_CONFIG), chunks?: (provider: string, request: any) => AsyncIterable<any>) {
  const calls: any[] = []
  const llm = {
    resolveModelInfo: async (provider: string, id: string) => ({ provider, id, name: id, inputModalities: ['text'] }),
    stream: (request: any) => { calls.push({ ...request }); return chunks?.(request.provider, request) ?? (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })() },
  }
  const service = {
    snapshot: () => ({ config: structuredClone(config), models: [model, fallbackModel], revision: 1 }),
    model: (ref: any) => [model, fallbackModel].find(item => item.providerId === ref.providerId && item.modelId === ref.modelId),
    activeSelection: () => undefined,
    log: vi.fn(async () => {}),
  }
  return { adapter: new ManagedAdapter(llm as never, service as never, new VisionRegistry()), calls, service }
}

describe('受管理请求', () => {
  it('准备后修改别名不影响已捕获的请求', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.aliases.fast = [{ providerId: 'provider-a', modelId: 'text' }]
    const { adapter, calls } = harness(config)
    const prepared = await adapter.prepareCall('dsh-model-manager', 'alias:fast')
    config.aliases.fast = [{ providerId: 'new-provider', modelId: 'new-model' }]
    const output = []
    for await (const chunk of prepared.stream({ provider: 'dsh-model-manager', model: 'alias:fast', messages: [] })) output.push(chunk)
    expect(calls[0].provider).toBe('provider-a')
    expect(output.at(-1).reason.kind).toBe('stop')
  })
  it('图片通过 sidecar 时保留原始附件引用并交给文字模型文字提示', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.vision = { enabled: true, policy: 'sidecar-only', target: { providerId: 'vision', modelId: 'v' } }
    const registry = new VisionRegistry()
    const { adapter, calls } = harness(config)
    const attachment = { attachmentId: 'abc', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
    const message = { id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment }] }
    for await (const _ of adapter.stream({ provider: 'dsh-model-manager', model: managedId(model), sessionId: 's' as never, messages: [message] as never })) { /* drain */ }
    expect(calls[0].messages[0].content[0].text).toContain('abc')
    expect(calls[0].messages[0].content[0].type).toBe('text')
    registry.add('s', [attachment as never])
    expect(registry.get('s', 'abc')).toEqual(attachment)
  })
  it('已有输出后失败不换模型重播', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.aliases.fast = [{ providerId: 'provider-a', modelId: 'text' }, { providerId: 'provider-b', modelId: 'text' }]
    const { adapter, calls } = harness(config, () => (async function* () {
      yield { type: 'text-delta', index: 0, text: '半段' }
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', status: 503, message: 'failed' } } }
    })())
    const output = []
    for await (const chunk of adapter.stream({ provider: 'dsh-model-manager', model: 'alias:fast', messages: [] })) output.push(chunk)
    expect(calls).toHaveLength(1)
    expect(output.at(-1).reason.kind).toBe('error')
  })
  it('无输出的临时失败只重试一次，再按别名顺序切换', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.aliases.fast = [{ providerId: 'provider-a', modelId: 'text' }, { providerId: 'provider-b', modelId: 'text' }]
    const { adapter, calls } = harness(config, provider => (async function* () {
      if (provider === 'provider-a') yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', status: 503, message: 'failed' } } }
      else yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    const output = []
    for await (const chunk of adapter.stream({ provider: 'dsh-model-manager', model: 'alias:fast', messages: [] })) output.push(chunk)
    expect(calls.map(call => call.provider)).toEqual(['provider-a', 'provider-a', 'provider-b'])
    expect(output.at(-1).reason.kind).toBe('stop')
  })
  it('请求准备后修改覆盖不会改变该请求参数', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    const { adapter, calls, service } = harness(config)
    service.activeSelection = () => ({ maxOutputTokens: 128 })
    const prepared = await adapter.prepareCall('dsh-model-manager', managedId(model))
    const stream = prepared.stream({ provider: 'dsh-model-manager', model: managedId(model), sessionId: 's' as never, messages: [] })
    service.activeSelection = () => ({ maxOutputTokens: 512 })
    for await (const _ of stream) { /* drain */ }
    expect(calls[0].maxTokens).toBe(128)
  })
  it('关闭视觉辅助后仍可继续包含历史图片的文字会话', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.vision = { enabled: true, policy: 'sidecar-only', target: { providerId: 'vision', modelId: 'v' } }
    const { adapter, calls } = harness(config)
    const image = { type: 'image', attachment: { attachmentId: 'old', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }
    const oldMessage = { id: 'old', role: 'user', source: { kind: 'user' }, content: [image] }
    for await (const _ of adapter.stream({ provider: 'dsh-model-manager', model: managedId(model), sessionId: 'same' as never, messages: [oldMessage] as never })) { /* drain */ }
    config.vision.enabled = false
    const newMessage = { id: 'new', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }
    for await (const _ of adapter.stream({ provider: 'dsh-model-manager', model: managedId(model), sessionId: 'same' as never, messages: [oldMessage, newMessage] as never })) { /* drain */ }
    expect(calls[1].messages[0].content[0].text).toContain('视觉辅助已关闭')
    expect(calls[1].messages[1].content[0].text).toBe('继续')
  })
  it('上下文溢出只切到明确配置的长上下文候选', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.aliases.fast = [{ providerId: 'provider-a', modelId: 'text' }]
    config.reliability.longContextCandidates = [{ providerId: 'provider-b', modelId: 'text' }]
    const { adapter, calls } = harness(config, provider => (async function* () {
      if (provider === 'provider-a') yield { type: 'finish', reason: { kind: 'error', failure: { code: 'context_length_exceeded', status: 400, message: 'too long' } } }
      else yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    const output = []
    for await (const chunk of adapter.stream({ provider: 'dsh-model-manager', model: 'alias:fast', messages: [] })) output.push(chunk)
    expect(calls.map(call => call.provider)).toEqual(['provider-a', 'provider-b'])
    expect(output.at(-1).reason.kind).toBe('stop')
  })
  it('参数拒绝仅在允许时去掉推理参数并重试', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.manual.tier = 'fast'
    config.models['["provider-a","text"]'] = { tiers: { fast: 'low' } }
    config.reliability.parameterDowngrade = true
    const { adapter, calls } = harness(config, (_provider, request) => (async function* () {
      yield request.reasoningEffort ? { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', status: 400, message: 'reasoning effort rejected' } } } : { type: 'finish', reason: { kind: 'stop' } }
    })())
    const output = []
    for await (const chunk of adapter.stream({ provider: 'dsh-model-manager', model: managedId(model), messages: [] })) output.push(chunk)
    expect(calls.map(call => call.reasoningEffort)).toEqual(['low', undefined])
    expect(output.at(-1).reason.kind).toBe('stop')
  })
})
