import type { ModelRecord } from './domain.js'

export const OFFICIAL_SOURCES = {
  models: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  thinking: 'https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/',
  updates: 'https://api-docs.deepseek.com/zh-cn/updates',
}
export type SourceUrls = typeof OFFICIAL_SOURCES
export interface OfficialModel { id: string; name: string; image: boolean; contextWindow: number; efforts: string[] }
export interface OfficialDiff { id: string; oldId?: string; field: 'name' | 'inputModalities' | 'contextWindow' | 'id' | 'addModel'; before: unknown; after: unknown; source: string; reason: string }
export interface OfficialPreview { token: string; sources: SourceUrls; fetchedAt: string; models: OfficialModel[]; diffs: OfficialDiff[]; notes: string[]; revision: number }

function plain(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|lt|gt);/g, match => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' })[match] ?? match)
    .replace(/\s+/g, ' ').trim()
}

export function parseOfficialPages(pages: Record<keyof SourceUrls, string>): OfficialModel[] {
  const table = pages.models.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0]
  if (!table) throw new Error('官方模型页未找到模型表格')
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => plain(cell[1])))
  const row = (label: string) => rows.find(cells => cells.some(cell => cell === label))
  const ids = row('模型')?.slice(-2)
  const names = row('模型版本')?.slice(-2)
  const images = row('图像理解')?.slice(-2)
  const context = row('上下文长度')?.at(-1)
  const efforts = plain(pages.thinking)
  const updates = plain(pages.updates)
  if (!ids || !names || !images || !/^\d+M$/i.test(context ?? '') ||
    !ids.includes('deepseek-flash') || !ids.includes('deepseek-v4-pro') ||
    !efforts.includes('low/high/max') || !updates.includes('DeepSeek-V4.1-Flash')) throw new Error('官方网页内容不足或相互冲突，未生成可应用建议')
  return ids.map((id, index) => ({ id, name: names[index], image: images[index] === '支持', contextWindow: Number.parseInt(context!, 10) * 1_000_000, efforts: ['off', 'low', 'high', 'max'] }))
}

export function officialDiffs(catalog: ModelRecord[], models: OfficialModel[], source: string): OfficialDiff[] {
  const diffs: OfficialDiff[] = []
  for (const official of models) {
    const record = catalog.find(item => item.providerId === 'deepseek-official' && item.modelId === official.id)
    if (!record) {
      diffs.push({ id: `${official.id}:addModel`, field: 'addModel', before: '未配置', after: official, source, reason: `${official.id} 已列入官方模型表` })
      continue
    }
    const fields: [OfficialDiff['field'], unknown, unknown][] = [
      ['name', record.name, official.name], ['inputModalities', record.nativeImage, official.image ? 'yes' : 'no'],
      ['contextWindow', record.contextWindow, official.contextWindow],
    ]
    for (const [field, before, after] of fields) if (before !== after) diffs.push({ id: `${official.id}:${field}`, field, before, after, source,
      reason: `${official.id} 的官方模型表` })
  }
  const old = catalog.find(item => item.providerId === 'deepseek-official' && item.modelId === 'deepseek-v4-flash')
  if (old && models.some(item => item.id === 'deepseek-flash')) diffs.push({ id: 'deepseek-v4-flash:id', oldId: old.modelId, field: 'id', before: old.modelId, after: 'deepseek-flash', source,
    reason: '官方说明旧 Flash ID 已转向新 Flash 模型；引用可迁移，旧入口保留到确认无引用后清理' })
  return diffs
}

export async function fetchOfficial(urls: SourceUrls, signal?: AbortSignal): Promise<{ pages: Record<keyof SourceUrls, string>; fetchedAt: string }> {
  const entries = await Promise.all(Object.entries(urls).map(async ([key, url]) => {
    let parsed = new URL(url)
    const official = (target: URL) => target.protocol === 'https:' && target.hostname === 'api-docs.deepseek.com'
    if (!official(parsed)) throw new Error('资料来源仅支持 DeepSeek 官方文档域名')
    let response: Response | undefined
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(parsed, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000), redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      if (!location) throw new Error(`${key} 页面跳转缺少地址`)
      parsed = new URL(location, parsed)
      if (!official(parsed)) throw new Error(`${key} 页面跳转到了非官方域名`)
      if (redirects === 3) throw new Error(`${key} 页面跳转次数过多`)
    }
    if (!response) throw new Error(`${key} 页面抓取失败`)
    if (!response.ok) throw new Error(`抓取 ${key} 失败：HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 2_000_000) throw new Error(`${key} 页面过大`)
    return [key, text] as const
  }))
  return { pages: Object.fromEntries(entries) as Record<keyof SourceUrls, string>, fetchedAt: new Date().toISOString() }
}
