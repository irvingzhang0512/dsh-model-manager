import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { DEFAULT_CONFIG } from '../src/domain.ts'

const pages = {
  models: '<table><tr><td>模型</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr><tr><td>模型版本</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr><tr><td>上下文长度</td><td colspan="2">1M</td></tr><tr><td>图像理解</td><td>支持</td><td>不支持</td></tr></table>',
  thinking: '<p>low/high/max</p>', updates: '<p>DeepSeek-V4.1-Flash</p>',
}
function request(value: unknown) {
  return { method: 'POST', headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)) } }
}
function response() {
  const result = { status: 0, body: '' }
  const res = { writeHead(status: number) { result.status = status }, end(body: string) { result.body = body }, setHeader() {} }
  return { result, res }
}

let temporary: string | undefined
afterEach(async () => { vi.unstubAllGlobals(); if (temporary) await rm(temporary, { recursive: true, force: true }); delete process.env.DSH_HOME })

describe('官方同步宿主接口', () => {
  it('预览、版本冲突、应用一次及恢复一次', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'dmm-official-'))
    process.env.DSH_HOME = temporary
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => ({ ok: true, url: String(url), text: async () => String(url).includes('pricing') ? pages.models : String(url).includes('thinking') ? pages.thinking : pages.updates })))
    const routes = new Map<string, Function>()
    let plugin = structuredClone(DEFAULT_CONFIG)
    let models = [{ id: 'deepseek-v4-flash', name: 'Old Flash', contextWindow: 1000000, inputModalities: ['text'] }]
    let officialRevision = 2, pluginRevision = 3
    const settings = {
      register: () => ({ watch: () => () => {} }),
      get: (ns: string) => ns === 'dsh-model-manager' ? plugin : ns === 'llm-deepseek' ? { models } : undefined,
      describe: () => [{ ns: 'dsh-model-manager', revision: pluginRevision }, { ns: 'llm-deepseek', revision: officialRevision }],
      mutate: async (_ns: string, ops: { value: typeof models }[], revision: number) => { if (revision !== officialRevision) throw Error('SETTINGS_CONFLICT'); models = structuredClone(ops[0].value); officialRevision++ },
      replace: async (_ns: string, next: typeof plugin, revision: number) => { if (revision !== pluginRevision) throw Error('SETTINGS_CONFLICT'); plugin = structuredClone(next); pluginRevision++ },
    }
    const fake = {
      settings,
      llm: { listProviders: () => [{ id: 'deepseek-official' }], listConfigurableProviders: () => [], listModels: async () => [{ id: 'deepseek-v4-flash', name: 'Old Flash' }], resolveModelInfo: async () => ({ id: 'deepseek-v4-flash', name: 'Old Flash' }), registerAdapter: () => () => {} },
      tools: { register: () => () => {} }, subagents: {}, attachments: {}, systemPrompt: { section: () => () => {} }, webServer: { register: (route: { path: string; handler: Function }) => { routes.set(route.path, route.handler); return () => {} } }, on: () => () => {}, effect: (register: () => () => void) => { register() }, logger: { error: () => {} },
    }
    apply(fake as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    const call = async (path: string, value: unknown) => { const { result, res } = response(); await routes.get(`/api/model-manager/${path}`)!(request(value), res); return { ...result, json: JSON.parse(result.body) } }
    const preview = await call('official-preview', {})
    expect(preview.status).toBe(200)
    expect(preview.json.diffs.map((diff: { id: string }) => diff.id)).toContain('deepseek-flash:addModel')
    officialRevision++
    expect((await call('official-apply', { token: preview.json.token, selected: ['deepseek-flash:addModel'] })).status).toBe(409)
    const fresh = await call('official-preview', {})
    const applied = await call('official-apply', { token: fresh.json.token, selected: ['deepseek-flash:addModel', 'deepseek-v4-flash:id'] })
    expect(applied.status, JSON.stringify(applied.json)).toBe(200)
    expect(models.some(model => model.id === 'deepseek-flash')).toBe(true)
    expect((await call('official-apply', { token: fresh.json.token, selected: ['deepseek-flash:addModel'] })).status).toBe(400)
    expect((await call('official-restore', {})).status).toBe(200)
    expect(models).toHaveLength(1)
    expect((await call('official-restore', {})).status).toBe(409)
  })
})
