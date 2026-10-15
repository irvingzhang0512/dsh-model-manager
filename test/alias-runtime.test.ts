import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { ManagedAdapter, VisionRegistry } from '../src/adapter.js'
import { ALIAS_BUFFER_BYTES } from '../src/alias-runtime.js'
import { DEFAULT_CONFIG, managedId, modelKey, type ModelRecord } from '../src/domain.js'

afterEach(() => vi.useRealTimers())
const stop = { type: 'finish', reason: { kind: 'stop' } }
const fail = (code: string, status?: number) => ({ type: 'finish', reason: { kind: 'error', failure: { code, message: `${code} rejected`, ...(status ? { status } : {}) } } })
const drain = async (stream: AsyncIterable<any>) => { const output = []; for await (const chunk of stream) output.push(chunk); return output }
function setup(run: (request: any, count: number) => AsyncIterable<any>, count = 3) {
  const config = structuredClone(DEFAULT_CONFIG)
  const records: ModelRecord[] = Array.from({ length: count }, (_, i) => ({ providerId: `p${i}`, modelId: 'flash', name: `m${i}`, nativeImage: 'no', reasoningEfforts: [{ id: 'high', name: 'high' }], source: 'host', loaded: true }))
  config.aliases.flash = { candidates: records.map(({ providerId, modelId }) => ({ providerId, modelId })) }
  const calls: any[] = [], times: number[] = []
  const runtime = { resolveModelInfo: vi.fn(async (provider: string, id: string) => ({ provider, id, name: id, inputModalities: ['text'] })),
    stream: (request: any) => { calls.push(request); times.push(Date.now()); return run(request, calls.length) } }
  const service = {aliasCandidateAvailable:async()=>true,recordActualModel:vi.fn(),aliasLifecycle:()=>undefined, snapshot: () => ({ config: structuredClone(config), models: structuredClone(records), revision: 1 }), hostDefault: () => undefined,
    activeSelection: (): any => undefined, activeTurn: () => 1, isDelegatedSession: () => false, log: vi.fn(async () => {}),
    autoDecision: (): any => undefined, saveAutoDecision: vi.fn(), getVerification: () => undefined }
  const adapter = new ManagedAdapter(runtime as never, service as never, new VisionRegistry())
  const options: any = { provider: 'dsh-model-manager', model: 'alias:flash', messages: [], sessionId: 'test' }
  return { adapter, config, records, runtime, service, calls, times, options }
}
describe('别名按序恢复与完整提交', () => {
  it('无 status 的 RATE_LIMIT／QUOTA 后实际访问第三候选，旧总限制不起作用', async () => {
    const f = setup(request => (async function* () { yield request.provider === 'p0' ? fail('RATE_LIMIT') : request.provider === 'p1' ? fail('QUOTA') : stop })())
    f.config.reliability.maxAttempts = 1
    f.config.aliases.flash.reliability = { maxAttempts: 1, retryTransient: false, parameterDowngrade: true }
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop])
    expect(f.calls.map(c => c.provider)).toEqual(['p0', 'p1', 'p2'])
    expect(f.service.log.mock.calls.map(([e]) => [e.candidateIndex, e.candidateAttempt, e.attempt])).toEqual([[1, 1, 1], [2, 1, 2], [3, 1, 3]])
  })
  it.each(['AUTH', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'PI_AI_ERROR', 'UNKNOWN'])('%s 无 status 不阻止后续候选', async code => {
    const f = setup(request => (async function* () { yield request.provider === 'p0' ? fail(code) : stop })())
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop]); expect(f.calls).toHaveLength(2)
  })
  it('同平台认证失败仍尝试下个不同模型，超过三个候选也可达且重复模型只进入一次', async () => {
    const f = setup(request => (async function* () { yield request.model === 'last' ? stop : fail('AUTH') })(), 5)
    f.records.forEach((r, i) => { r.providerId = 'same'; r.modelId = i === 4 ? 'last' : `m${i}` })
    f.config.aliases.flash.candidates = [...f.records, f.records[0]]
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop]); expect(f.calls).toHaveLength(5)
  })
  it('第五次成功，退避精确为 0.5、1、2、4 秒', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const f = setup((_request, count) => (async function* () { yield count === 5 ? stop : fail('TIMEOUT') })())
    const task = drain(f.adapter.stream(f.options)); await vi.runAllTimersAsync()
    expect(await task).toEqual([stop]); expect(f.times).toEqual([0, 500, 1500, 3500, 7500])
  })
  it('缺 finish 的半段流最多五次，随后换候选，失败内容不发布', async () => {
    vi.useFakeTimers()
    const f = setup(request => (async function* () { if (request.provider === 'p0') yield { type: 'text-delta', index: 0, text: 'discard' }; else yield stop })())
    const task = drain(f.adapter.stream(f.options)); await vi.runAllTimersAsync()
    expect(await task).toEqual([stop]); expect(f.calls).toHaveLength(6)
  })
  it('结构化 LlmError 保留限流码、HTTP 与请求 ID，不原地重试', async () => {
    const f = setup(request => (async function* () { if (request.provider === 'p0') throw new LlmError('quota', 'RATE_LIMIT', { status: 429, requestId: 'provider-request' }); yield stop })())
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop])
    expect(f.calls).toHaveLength(2); expect(f.service.log).toHaveBeenCalledWith(expect.objectContaining({ failureCode: 'RATE_LIMIT', httpStatus: 429, requestId: 'provider-request' }))
  })
  it.each(['text-delta', 'reasoning-delta', 'tool-call-delta'])('失败 %s 丢弃，成功工具只提交一次，完整历史保留', async type => {
    const f = setup(request => (async function* () {
      if (request.provider === 'p0') { yield { type, index: 0, text: 'discard', id: 'discard', name: 'unsafe', argumentsDelta: '{}' }; yield fail('INVALID_REQUEST') }
      else { yield { type: 'tool-call-delta', index: 0, id: 'only', name: request.tools[0].name, argumentsDelta: '{}' }; yield { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: 'success' } } }
    })())
    f.options.messages = [{ id: 'history', role: 'tool', source: { kind: 'tool', toolCallId: 'done' }, content: [{ type: 'tool-result', toolCallId: 'done', content: [{ type: 'text', text: 'already completed' }] }] }]
    f.options.tools = [{ name: 'write.file', description: 'write', parameters: {} }]
    const output = await drain(f.adapter.stream(f.options))
    expect(output).toHaveLength(2); expect(output[0]).toMatchObject({ type: 'tool-call-delta', id: 'only', name: 'write.file' }); expect(output[1].replayState).toMatchObject({response:{$dmm:1,state:'success'}})
    expect(f.calls[0].messages).toEqual(f.calls[1].messages)
  })
  it.each(['stop', 'tool-calls', 'max-tokens'])('%s 正常结束保留原块与 usage', async kind => {
    const chunks = [{ type: 'text-delta', index: 4, text: 'answer' }, { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }, { type: 'finish', reason: { kind } }]
    const f = setup(() => (async function* () { yield* chunks })())
    expect(await drain(f.adapter.stream(f.options))).toEqual(chunks)
  })
  it('32 MiB 限制切下一候选且不发布超限输出', async () => {
    const f = setup(request => (async function* () { if (request.provider === 'p0') yield { type: 'text-delta', index: 0, text: 'x'.repeat(ALIAS_BUFFER_BYTES) }; else yield stop })())
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop]); expect(f.calls).toHaveLength(2)
    expect(f.service.log).toHaveBeenCalledWith(expect.objectContaining({ failureCode: 'BUFFER_LIMIT' }))
  })
  it('首候选元数据失败仍可准备别名；候选缺失／参数无效跳过并记录准备原因', async () => {
    const f = setup(() => (async function* () { yield stop })())
    f.runtime.resolveModelInfo.mockImplementation(async (provider, id) => { if (provider === 'p0') throw new LlmError('missing', 'NO_ADAPTER'); return { provider, id, name: id, inputModalities: ['text'] } })
    const prepared = await f.adapter.prepareCall('dsh-model-manager', 'alias:flash')
    expect(await drain(prepared.stream(f.options))).toEqual([stop]); expect(f.calls[0].provider).toBe('p1')
    expect(f.service.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'alias-candidate-preparation', candidateAttempt: 0, candidateIndex: 1 }))
  })
  it('图片不兼容及别名档位准备失败逐个跳过', async () => {
    const f = setup(() => (async function* () { yield stop })())
    f.records[1].nativeImage = 'yes'; f.records[2].nativeImage = 'yes'
    f.config.aliases.flash.efforts = { [modelKey(f.records[1])]: 'impossible' }
    f.options.messages = [{ id: 'image', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'new', mediaType: 'image/png', bytes: 1 } }] }]
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop]); expect(f.calls[0].provider).toBe('p2')
  })
  it('会话覆盖到别名、旧 AUTO 别名及视觉内部请求使用新规则', async () => {
    for (const entry of ['override', 'auto', 'vision']) {
      const f = setup(request => (async function* () { yield request.provider === 'p0' ? fail('QUOTA') : stop })())
      f.records.forEach(r => { r.nativeImage = 'yes' })
      if (entry === 'override') { f.service.activeSelection = () => ({ target: '@flash' }); f.options.model = managedId(f.records[0]) }
      if (entry === 'auto') { f.config.auto.main.target = '@flash'; f.options.model = 'auto' }
      const output = await drain(entry === 'vision' ? f.adapter.streamAlias('flash', f.options, true) : f.adapter.stream(f.options))
      expect(output).toEqual([stop]); expect(f.calls.map(c => c.provider)).toEqual(['p0', 'p1'])
    }
  })
  it('AUTO 缓存等级选中别名后恢复原有候选顺序，执行期间不重新评估', async () => {
    const f = setup(request => (async function* () { yield request.provider === 'p0' ? fail('QUOTA') : stop })())
    f.config.auto.enabled = true; f.config.auto.normal.target = '@flash'; f.options.model = 'auto'
    f.service.autoDecision = () => ({ grade: 'normal', selection: { target: '@flash' }, candidates: [f.records[1]], reason: 'cached', fallback: false })
    expect(await drain(f.adapter.stream(f.options))).toEqual([stop]); expect(f.calls.map(c => c.provider)).toEqual(['p0', 'p1'])
    expect(f.service.saveAutoDecision).not.toHaveBeenCalled()
  })
  it('输出在成功前不可见；失败计费仅写日志，成功 usage 与 replayState 完整提交', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const f = setup(request => (async function* () {
      yield { type: 'text-delta', index: 0, text: request.provider }
      yield { type: 'usage', usage: { inputTokens: request.provider === 'p0' ? 100 : 1, outputTokens: 2, totalTokens: 3 } }
      if (request.provider === 'p0') yield fail('QUOTA')
      else { await held; yield { ...stop, replayState: { response: { id: 'success' }, blocks: [{}] } } }
    })())
    const output: any[] = [], task = (async () => { for await (const chunk of f.adapter.stream(f.options)) output.push(chunk) })()
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(output).toEqual([]); release(); await task
    expect(output[0].text).toBe('p1'); expect(output[1].usage.inputTokens).toBe(1); expect(output[2].replayState.response.state.id).toBe('success')
    expect(f.service.log).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 100 }) }))
  })
  it('视觉别名跳过非原生图片候选，不继承主会话目标覆盖', async () => {
    const f = setup(() => (async function* () { yield stop })())
    f.records[1].nativeImage = 'yes'; f.service.activeSelection = () => ({ target: f.records[0] })
    expect(await drain(f.adapter.streamAlias('flash', f.options, true))).toEqual([stop]); expect(f.calls[0].provider).toBe('p1')
  })
  it('全部候选失败只发布一次聚合错误并脱敏', async () => {
    const f = setup(() => (async function* () { yield { ...fail('QUOTA'), reason: { kind: 'error', failure: { code: 'QUOTA', message: 'api_key=private Bearer private' } } } })())
    const output = await drain(f.adapter.stream(f.options))
    expect(output).toHaveLength(1); expect(output[0].reason.failure.code).toBe('ALL_CANDIDATES_FAILED')
    expect(output[0].reason.failure.message).toContain('p2/flash'); expect(JSON.stringify(output)).not.toContain('private')
  })
  it.each(['read', 'prepare', 'delay', 'dispose'])('%s 期间取消及时结束，迟到内容不提交', async phase => {
    const f = setup(() => phase === 'delay' ? (async function* () { yield fail('SERVER') })() : (async function* () { await new Promise(() => {}); yield stop })())
    const controller = new AbortController(); f.options.signal = controller.signal
    if (phase === 'prepare') f.runtime.resolveModelInfo.mockImplementation(() => new Promise(() => {}))
    const task = drain(f.adapter.stream(f.options))
    for (let i = 0; i < 30; i++) await Promise.resolve()
    if (phase === 'dispose') f.adapter.dispose(); else controller.abort()
    const output = await task
    expect(output).toHaveLength(1); expect(output[0].reason.kind).toBe('aborted'); expect(f.calls.length).toBeLessThanOrEqual(1)
  })
  it('暂存文字期间停止立即返回，忽略信号的迟到内容不发布', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const f = setup(() => (async function* () { yield { type: 'text-delta', index: 0, text: 'buffered' }; await held; yield { type: 'text-delta', index: 0, text: 'late' }; yield stop })())
    const controller = new AbortController(); f.options.signal = controller.signal
    const output: any[] = [], task = (async () => { for await (const chunk of f.adapter.stream(f.options)) output.push(chunk) })()
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(output).toEqual([]); controller.abort(); await task
    expect(output).toHaveLength(1); expect(output[0].reason.kind).toBe('aborted'); expect(f.calls[0].signal.aborted).toBe(true)
    release(); for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(output).toHaveLength(1); expect(f.calls).toHaveLength(1)
  })
  it('完整结果提交过程中停止，不发布剩余内容或启动新的候选', async () => {
    const f = setup(() => (async function* () { yield { type: 'text-delta', index: 0, text: 'first' }; yield { type: 'text-delta', index: 0, text: 'second' }; yield stop })())
    const controller = new AbortController(); f.options.signal = controller.signal
    const iterator = f.adapter.stream(f.options)[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ text: 'first' }); controller.abort()
    expect((await iterator.next()).value.reason.kind).toBe('aborted'); expect((await iterator.next()).done).toBe(true)
    expect(f.calls).toHaveLength(1)
  })
  it('准备快照后外部改候选不改变本次请求', async () => {
    const f = setup(() => (async function* () { yield stop })())
    const prepared = await f.adapter.prepareCall('dsh-model-manager', 'alias:flash')
    f.config.aliases.flash.candidates = []
    expect(await drain(prepared.stream(f.options))).toEqual([stop]); expect(f.calls[0].provider).toBe('p0')
  })
})
