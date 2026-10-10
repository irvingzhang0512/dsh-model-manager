import type { ModelParameterPreview } from '../model-parameters.js'
import type { ParameterProgress } from '../parameter-analysis.js'

export async function readParameterStream(response: Response, progress: (value: ParameterProgress) => void): Promise<ModelParameterPreview> {
  if (!response.ok) { const value = await response.json(); throw new Error(value.error ?? `HTTP ${response.status}`) }
  if (!response.body) throw new Error('浏览器无法读取分析进度')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', result: ModelParameterPreview | undefined
  const consume = (frame: string) => {
    const lines = frame.split('\n'), event = lines.find(l => l.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
    if (!data) return
    const value = JSON.parse(data)
    if (result && ['result', 'error', 'progress'].includes(event ?? '')) throw new Error('参数分析返回多个终止事件')
    if (event === 'progress') progress(value)
    if (event === 'error') throw new Error(value.error ?? '参数分析失败')
    if (event === 'result') {
      if (typeof value?.token !== 'string' || !Array.isArray(value.parameterAnalysis?.results) || !Array.isArray(value.selectedFields) || value.origin !== 'parameter') throw new Error('参数分析结果无效')
      result = value
    }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let index: number
      while ((index = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2) }
      if (buffer.length > 8_000_000) throw new Error('参数预览响应过大')
      if (chunk.done) break
    }
    if (buffer.trim() || !result) throw new Error('参数分析连接不完整，请重新分析')
    return result
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
