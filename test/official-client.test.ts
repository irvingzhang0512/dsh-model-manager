import { describe, expect, it } from 'vitest'
import { readOfficialStream } from '../src/client/official-stream.ts'
import { analysis } from './official-fixtures.ts'

const result = { token: 'valid', analysis: analysis(['one']) }
function response(text: string, width = 1) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += width) controller.enqueue(bytes.slice(index, index + width)); controller.close() } }))
}
describe('官方同步 POST 进度流', () => {
  it('UTF-8 字符／CRLF／事件任意分片，忽略 keepalive 并返回唯一完整结果', async () => {
    const text = `: keepalive\r\n\r\nevent: progress\r\ndata: {"stage":"reading","round":1,"pageCount":0}\r\n\r\nevent: result\r\ndata: ${JSON.stringify({ ...result, notes: ['中文证据'] })}\r\n\r\n`
    const progress: unknown[] = []
    expect(await readOfficialStream(response(text), value => progress.push(value))).toMatchObject({ token: 'valid', notes: ['中文证据'] })
    expect(progress).toEqual([{ stage: 'reading', round: 1, pageCount: 0 }])
  })
  it('HTTP 错误、流错误、无结果、中途断开、重复结果均不返回 token', async () => {
    await expect(readOfficialStream(new Response('{"error":"failure"}', { status: 409 }), () => {})).rejects.toThrow('failure')
    for (const text of ['event: error\ndata: {"error":"证据不足"}\n\n', ': heartbeat\n\n', 'event: result\ndata: {"token":', `event: result\ndata: ${JSON.stringify(result)}\n\nevent: result\ndata: ${JSON.stringify(result)}\n\n`]) {
      await expect(readOfficialStream(response(text), () => {})).rejects.toThrow()
    }
  })
})
