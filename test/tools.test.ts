import { describe, expect, it, vi } from 'vitest'
import { registerManagerTools } from '../src/tools.ts'
import { VisionRegistry } from '../src/adapter.ts'
import { DEFAULT_CONFIG } from '../src/domain.ts'
import sharp from 'sharp'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (options: unknown) => options }))

describe('视觉工具', () => {
  it('区域参数实际裁剪像素，并让视觉模型收到裁剪附件', async () => {
    const registered = new Map<string, any>()
    const config = structuredClone(DEFAULT_CONFIG)
    config.vision = { enabled: true, policy: 'sidecar-only', target: { providerId: 'vision', modelId: 'v' } }
    const vision = new VisionRegistry()
    vision.add('session-crop', [{ attachmentId: 'original', mediaType: 'image/png', bytes: 1 } as never])
    const original = await sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
    let cropped: Buffer | undefined
    let sentId = ''
    const dispose = registerManagerTools({
      tools: { register: (tool: any) => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } },
      subagents: {},
      llm: {
        resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
        stream: (request: any) => (async function* () {
          sentId = request.messages[0].content[1].attachment.attachmentId
          yield { type: 'text-delta', text: '红色' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })(),
      },
      attachments: {
        readImage: async () => ({ data: original }),
        saveImage: async (input: { data: Buffer }) => { cropped = input.data; return { attachmentId: 'cropped', mediaType: 'image/png', bytes: input.data.length } },
      },
      service: { snapshot: () => ({ config, revision: 1 }), signature: () => 'version-1', getVisionCache: () => undefined, putVisionCache: async () => {}, log: async () => {} },
      vision,
    } as never)
    const tool = registered.get('model_manager_inspect_image')
    const exec = { agent: { session: { id: 'session-crop' } }, signal: new AbortController().signal }
    await expect(tool.execute({ attachment_id: 'original', question: '颜色？', region: '0.5,0,0.5,1' }, exec)).resolves.toBe('红色')
    expect(await sharp(cropped!).metadata()).toMatchObject({ width: 2, height: 2 })
    expect(sentId).toBe('cropped')
    await expect(tool.execute({ attachment_id: 'original', question: '颜色？', region: '0.9,0,0.5,1' }, exec)).rejects.toThrow('裁剪区域超出图片范围')
    dispose()
  })
  it('视觉请求失败不缓存答案，并记录失败；取消时标记为中断', async () => {
    const registered = new Map<string, any>()
    const config = structuredClone(DEFAULT_CONFIG)
    config.vision = { enabled: true, policy: 'sidecar-only', target: { providerId: 'vision', modelId: 'v' } }
    const log = vi.fn(async () => {})
    const cache = vi.fn(async () => {})
    const vision = new VisionRegistry()
    vision.add('session-1', [{ attachmentId: 'image-1', mediaType: 'image/png', bytes: 1 } as never])
    let aborted = false
    const dispose = registerManagerTools({
      tools: { register: (tool: any) => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } },
      subagents: {},
      llm: {
        resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
        stream: () => (async function* () {
          yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error' } }
        })(),
      },
      attachments: { readImage: async () => ({ data: Buffer.from([1]) }) },
      service: { snapshot: () => ({ config, revision: 1 }), signature: () => 'version-1', getVisionCache: () => undefined, putVisionCache: cache, log },
      vision,
    } as never)
    const tool = registered.get('model_manager_inspect_image')
    const controller = new AbortController()
    const execute = () => tool.execute({ attachment_id: 'image-1', question: '颜色？' }, { agent: { session: { id: 'session-1' } }, signal: controller.signal })
    await expect(execute()).rejects.toThrow('视觉调用失败：error')
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'vision', status: 'error', managedRequestId: expect.any(String) }))
    aborted = true
    controller.abort()
    await expect(execute()).rejects.toThrow('视觉调用失败：aborted')
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'vision', status: 'aborted' }))
    expect(cache).not.toHaveBeenCalled()
    dispose()
  })
})

describe('native subagent boundary', () => {
  it('registers only the image inspection tool', () => {
    const registered: string[] = []
    registerManagerTools({ tools: { register: (tool: { name: string }) => { registered.push(tool.name); return () => {} } }, llm: {}, attachments: {}, service: {}, vision: new VisionRegistry() } as never)
    expect(registered).toEqual(['model_manager_inspect_image'])
  })
})
