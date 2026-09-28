import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, verify } from '../src/index.ts'
import { DEFAULT_CONFIG } from '../src/domain.ts'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (options: unknown) => options }))

let temporary: string | undefined
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; delete process.env.DSH_HOME })

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
      '/api/model-manager', '/api/model-manager/verify', '/api/model-manager/refresh', '/api/model-manager/native', '/api/model-manager/logs', '/api/model-manager/overrides',
    ])
    expect(new Set(routes.map(route => route.path)).size).toBe(routes.length)
    for (const dispose of disposers.reverse()) dispose()
  })
})
