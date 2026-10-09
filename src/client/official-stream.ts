import type { OfficialPreview, OfficialProgress } from '../official-types.js'

/** POST SSE：网络分片可切在任何字符或事件边界，result 必须是唯一终止结果。 */
export async function readOfficialStream(response: Response, progress: (value: OfficialProgress) => void): Promise<OfficialPreview> {
  if (!response.ok) { const value = await response.json(); throw new Error(value.error ?? `HTTP ${response.status}`) }
  if (!response.body) throw new Error('浏览器无法读取分析进度')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', result: OfficialPreview | undefined
  const consume = (frame: string) => {
    const lines = frame.split('\n'), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    const value = JSON.parse(data)
    if (event === 'progress') progress(value)
    if (event === 'error') throw new Error(value.error ?? '资料分析失败')
    if (event === 'result') { if (result || !value?.token || !value.analysis?.complete) throw new Error('同步结果无效'); result = value }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let index: number
      while ((index = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2) }
      if (buffer.length > 2_000_000) throw new Error('同步响应过大')
      if (chunk.done) break
    }
    if (buffer.trim()) throw new Error('分析进度连接不完整')
    if (!result) throw new Error('分析中断，请重新刷新')
    return result
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
