import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, probeModel, verify } from '../src/index.ts'
import { DEFAULT_CONFIG } from '../src/domain.ts'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (options: unknown) => options }))

let temporary: string | undefined
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; delete process.env.DSH_HOME })

function fakeRequest(payload: unknown) {
  const text = JSON.stringify(payload)
  return {
    method: 'POST',
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(text) },
  }
}

function fakeResponse() {
  const result = { status: 0, body: '', ended: false }
  const res = {
    get writableEnded() { return result.ended },
    setHeader: () => {},
    on: () => {},
    writeHead: (status: number) => { result.status = status },
    end: (text: string) => { result.body = text; result.ended = true },
  }
  return { res, result }
}

describe('宿主装配', () => {
  it('验证传输异常与取消产生独立证据，不改变能力声明', async () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm' }
    const saved: any[] = []
    const service = {
      model: () => model,
      snapshot: () => ({ config: structuredClone(DEFAULT_CONFIG) }),
      signature: () => 'sig',
      saveVerification: async (result: unknown) => { saved.push(result) },
    }
    const llm = {
      resolveModelInfo: async () => model,
      stream: () => (async function* () { throw new Error('connection reset') })(),
    }
    const controller = new AbortController()
    const failed = await verify(llm as never, {} as never, service as never, model, 'text', controller.signal)
    expect(failed).toMatchObject({ status: 'network-error', requestCount: 1 })
    controller.abort()
    const cancelled = await verify(llm as never, {} as never, service as never, model, 'text', controller.signal)
    expect(cancelled.status).toBe('cancelled')
    expect(saved).toHaveLength(2)
    expect(model).not.toHaveProperty('nativeImage')
  })
  it('路由按 path 唯一注册，受管理模型与工具同时可用', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'dmm-test-'))
    process.env.DSH_HOME = temporary
    const routes: { path: string; handler: Function }[] = []
    const toolNames: string[] = []
    const adapters: string[][] = []
    const prompts: string[] = []
    const disposers: (() => void)[] = []
    const fake = {
      settings: {
        register: () => ({ watch: () => () => {} }),
        get: (ns: string) => ns === 'dsh-model-manager' ? structuredClone(DEFAULT_CONFIG) : undefined,
        describe: () => [{ ns: 'dsh-model-manager', revision: 0 }],
      },
      llm: { listProviders: () => [], listModels: async () => [], registerAdapter: (ids: string[]) => { adapters.push(ids); return () => {} } },
      tools: { register: (tool: { name: string }) => { toolNames.push(tool.name); return () => {} } },
      subagents: {}, attachments: {},
      systemPrompt: { section: (section: { name: string }) => { prompts.push(section.name); return () => {} } },
      webServer: { register: (route: { path: string; handler: Function }) => { routes.push(route); return () => {} } },
      on: () => () => {},
      effect: (register: () => () => void) => { disposers.push(register()) },
      logger: { error: () => {} },
    }
    apply(fake as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(adapters).toEqual([['dsh-model-manager']])
    expect(toolNames).toContain('model_manager_delegate')
    expect(toolNames).toContain('model_manager_inspect_image')
    expect(prompts).toContain('dsh-model-manager')
    expect(routes.map(route => route.path)).toEqual([
      '/api/model-manager', '/api/model-manager/verify', '/api/model-manager/probe', '/api/model-manager/refresh', '/api/model-manager/native', '/api/model-manager/logs', '/api/model-manager/overrides',
    ])
    expect(new Set(routes.map(route => route.path)).size).toBe(routes.length)
    for (const dispose of disposers.reverse()) dispose()
  })
  it('探测路由发出真实请求并把证据映射成建议', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'dmm-probe-'))
    process.env.DSH_HOME = temporary
    const routes: { path: string; handler: Function }[] = []
    const model = { providerId: 'p', modelId: 'm', name: 'm', inputModalities: ['text', 'image'] }
    const asked: string[] = []
    const fake = {
      settings: {
        register: () => ({ watch: () => () => {} }),
        get: (ns: string) => ns === 'dsh-model-manager' ? structuredClone(DEFAULT_CONFIG) : undefined,
        describe: () => [{ ns: 'dsh-model-manager', revision: 0 }],
      },
      llm: {
        listProviders: () => [{ id: 'p' }],
        listConfigurableProviders: () => [],
        listModels: async () => [{ id: 'm', name: 'm' }],
        resolveModelInfo: async () => model,
        registerAdapter: () => () => {},
        stream: (options: { messages: { content: { type: string }[] }[] }) => (async function* () {
          asked.push(options.messages[0].content.some(part => part.type === 'image') ? 'image' : 'text')
          yield { type: 'text-delta', text: '红色' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })(),
      },
      tools: { register: () => () => {} },
      subagents: {},
      attachments: { saveImage: async () => ({ id: 'probe-image' }) },
      systemPrompt: { section: () => () => {} },
      webServer: { register: (route: { path: string; handler: Function }) => { routes.push(route); return () => {} } },
      on: () => () => {},
      effect: (register: () => () => void) => { register() },
      logger: { error: () => {} },
    }
    apply(fake as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    const probe = routes.find(route => route.path === '/api/model-manager/probe')!
    const { res, result } = fakeResponse()
    await probe.handler(fakeRequest({ providerId: 'p', modelId: 'm', items: ['image'] }), res)
    const payload = JSON.parse(result.body) as { verifications: { kind: string; status: string; behavior?: string }[]; suggestions: { field: string; value: string; confidence: string }[] }
    expect(result.status).toBe(200)
    expect(asked).toEqual(['image'])
    expect(payload.verifications[0]).toMatchObject({ kind: 'image', status: 'accepted', behavior: 'observed' })
    expect(payload.suggestions.map(item => `${item.field}:${item.value}:${item.confidence}`)).toEqual(['hostImage:yes:high', 'pluginImage:yes:high'])
  })
  it('探测路由拒绝未加载的模型与非法探测项', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'dmm-probe-bad-'))
    process.env.DSH_HOME = temporary
    const routes: { path: string; handler: Function }[] = []
    const fake = {
      settings: {
        register: () => ({ watch: () => () => {} }),
        get: (ns: string) => ns === 'dsh-model-manager' ? structuredClone(DEFAULT_CONFIG) : undefined,
        describe: () => [{ ns: 'dsh-model-manager', revision: 0 }],
      },
      llm: { listProviders: () => [], listConfigurableProviders: () => [], listModels: async () => [], registerAdapter: () => () => {}, resolveModelInfo: async () => ({}), stream: () => (async function* () {})() },
      tools: { register: () => () => {} },
      subagents: {}, attachments: {},
      systemPrompt: { section: () => () => {} },
      webServer: { register: (route: { path: string; handler: Function }) => { routes.push(route); return () => {} } },
      on: () => () => {},
      effect: (register: () => () => void) => { register() },
      logger: { error: () => {} },
    }
    apply(fake as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    const probe = routes.find(route => route.path === '/api/model-manager/probe')!
    const missing = fakeResponse()
    await probe.handler(fakeRequest({ providerId: 'p', modelId: 'ghost', items: ['image'] }), missing.res)
    expect(missing.result.status).toBe(400)
    expect(JSON.parse(missing.result.body).error).toContain('模型未加载')
    const invalid = fakeResponse()
    await probe.handler(fakeRequest({ providerId: 'p', modelId: 'm', items: ['reasoning'] }), invalid.res)
    expect(invalid.result.status).toBe(400)
    expect(JSON.parse(invalid.result.body).error).toContain('无效探测项')
  })
  it('探测对声明不支持的模型临时提权实测并恢复原声明', async () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm' }
    const service = {
      model: () => model,
      snapshot: () => ({ config: structuredClone(DEFAULT_CONFIG) }),
      signature: () => 'sig',
      saveVerification: async () => {},
      refresh: async () => [],
    }
    const llm = {
      resolveModelInfo: async () => model,
      stream: (options: { tools?: unknown[] }) => (async function* () {
        if (options.tools?.length) yield { type: 'tool-call-delta', name: 'model_manager_probe' }
        yield { type: 'text-delta', text: '红色' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    }
    const bridge = {
      modelInput: vi.fn(() => undefined),
      setInput: vi.fn(async () => {}),
      currentRevision: vi.fn(() => 5),
    }
    const attachments = { saveImage: async () => ({ id: 'probe-image' }) }
    const controller = new AbortController()
    const result = await probeModel(llm as never, attachments as never, service as never, bridge as never, model, ['image', 'tools'], 'no', controller.signal)
    expect(bridge.setInput.mock.calls.map(call => call[1])).toEqual([['text', 'image'], undefined])
    expect(result.elevated).toBe(true)
    expect(result.restoreFailed).toBe(false)
    expect(result.notes).toEqual([])
    expect(result.suggestions.map(item => `${item.field}:${item.value}:${item.confidence}`)).toEqual(['hostImage:yes:high', 'pluginImage:yes:high', 'pluginTools:yes:high'])
  })
  it('探测恢复宿主声明时写回原值而不是固定值', async () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm' }
    const service = {
      model: () => model,
      snapshot: () => ({ config: structuredClone(DEFAULT_CONFIG) }),
      signature: () => 'sig',
      saveVerification: async () => {},
      refresh: async () => [],
    }
    const llm = {
      resolveModelInfo: async () => model,
      stream: () => (async function* () {
        yield { type: 'text-delta', text: '红色' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    }
    const bridge = {
      modelInput: vi.fn(() => ['text']),
      setInput: vi.fn(async () => {}),
      currentRevision: vi.fn(() => 5),
    }
    const attachments = { saveImage: async () => ({ id: 'probe-image' }) }
    const controller = new AbortController()
    await probeModel(llm as never, attachments as never, service as never, bridge as never, model, ['image'], 'no', controller.signal)
    expect(bridge.setInput.mock.calls.map(call => call[1])).toEqual([['text', 'image'], ['text']])
  })
  it('提权失败时跳过图片探测并记录说明', async () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm' }
    const service = {
      model: () => model,
      snapshot: () => ({ config: structuredClone(DEFAULT_CONFIG) }),
      signature: () => 'sig',
      saveVerification: async () => {},
      refresh: async () => [],
    }
    const llm = {
      resolveModelInfo: async () => model,
      stream: () => (async function* () {
        yield { type: 'text-delta', text: '红色' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    }
    const bridge = {
      modelInput: () => undefined,
      setInput: vi.fn(async () => { throw new Error('SETTINGS_CONFLICT') }),
      currentRevision: () => 5,
    }
    const attachments = { saveImage: async () => ({ id: 'probe-image' }) }
    const controller = new AbortController()
    const result = await probeModel(llm as never, attachments as never, service as never, bridge as never, model, ['image', 'tools'], 'no', controller.signal)
    expect(result.elevated).toBe(false)
    expect(result.notes[0]).toContain('临时提权宿主声明失败')
    expect(result.verifications.map(item => item.kind)).toEqual(['tools'])
  })
  it('探测后恢复宿主声明失败时给出警告', async () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm' }
    const service = {
      model: () => model,
      snapshot: () => ({ config: structuredClone(DEFAULT_CONFIG) }),
      signature: () => 'sig',
      saveVerification: async () => {},
      refresh: async () => [],
    }
    const llm = {
      resolveModelInfo: async () => model,
      stream: () => (async function* () {
        yield { type: 'text-delta', text: '红色' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    }
    let calls = 0
    const bridge = {
      modelInput: () => undefined,
      setInput: vi.fn(async () => { calls++; if (calls > 1) throw new Error('SETTINGS_CONFLICT') }),
      currentRevision: () => 5,
    }
    const attachments = { saveImage: async () => ({ id: 'probe-image' }) }
    const controller = new AbortController()
    const result = await probeModel(llm as never, attachments as never, service as never, bridge as never, model, ['image'], 'no', controller.signal)
    expect(calls).toBe(3)
    expect(result.restoreFailed).toBe(true)
    expect(result.notes.join()).toContain('恢复宿主声明失败')
  })
  it('保存设置的响应包含完整快照，避免客户端渲染崩溃白屏', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'dmm-put-'))
    process.env.DSH_HOME = temporary
    const routes: { path: string; handler: Function }[] = []
    const fake = {
      settings: {
        register: () => ({ watch: () => () => {} }),
        get: (ns: string) => ns === 'dsh-model-manager' ? structuredClone(DEFAULT_CONFIG) : undefined,
        describe: () => [{ ns: 'dsh-model-manager', revision: 1 }],
        replace: async () => {},
      },
      llm: { listProviders: () => [], listConfigurableProviders: () => [], listModels: async () => [], registerAdapter: () => () => {}, resolveModelInfo: async () => ({}), stream: () => (async function* () {})() },
      tools: { register: () => () => {} },
      subagents: {}, attachments: {},
      systemPrompt: { section: () => () => {} },
      webServer: { register: (route: { path: string; handler: Function }) => { routes.push(route); return () => {} } },
      on: () => () => {},
      effect: (register: () => () => void) => { register() },
      logger: { error: () => {} },
    }
    apply(fake as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    const config = routes.find(route => route.path === '/api/model-manager')!
    const put = fakeRequest({ config: structuredClone(DEFAULT_CONFIG), revision: 1 })
    put.method = 'PUT'
    const { res, result } = fakeResponse()
    await config.handler(put, res)
    const payload = JSON.parse(result.body) as { revision: number; config?: unknown; models: unknown[]; verifications: unknown[] }
    expect(result.status).toBe(200)
    expect(payload.revision).toBe(1)
    expect(payload.config).toBeTruthy()
    expect(Array.isArray(payload.models)).toBe(true)
    expect(Array.isArray(payload.verifications)).toBe(true)
  })
})
