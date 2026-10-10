import { describe, expect, it } from 'vitest'
import { readParameterStream } from '../src/client/parameter-stream.ts'
const preview = { origin: 'parameter', token: '', selectedFields: [], parameterAnalysis: { results: [] } }
const stream = (text: string) => new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } }))
describe('参数 SSE 客户端', () => {
  it('跨中文/事件边界分片，空 token 的正常无建议结果也展示', async () => {
    const progress: any[] = []
    const result = await readParameterStream(stream(`: keepalive\n\nevent: progress\ndata: {"stage":"analyzing","modelIndex":1}\n\nevent: result\ndata: ${JSON.stringify(preview)}\n\n`), p => progress.push(p))
    expect(result).toEqual(preview); expect(progress).toEqual([{ stage: 'analyzing', modelIndex: 1 }])
  })
  it.each([`event: result\ndata: ${JSON.stringify(preview)}\n\nevent: result\ndata: ${JSON.stringify(preview)}\n\n`, 'event: error\ndata: {"error":"已取消"}\n\n', 'event: result\ndata: {}\n\n', ': keepalive\n\n'])('拒绝非法/重复终止或中断 #%#', async text => expect(readParameterStream(stream(text), () => {})).rejects.toThrow())
})
