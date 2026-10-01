import { describe, expect, it } from 'vitest'
import { officialDiffs, parseOfficialPages } from '../src/official-sync.ts'

const pages = {
  models: '<table><tr><td>模型</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr><tr><td>模型版本</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr><tr><td>上下文长度</td><td colspan="2">1M</td></tr><tr><td>图像理解</td><td>支持</td><td>不支持</td></tr></table>',
  thinking: '<p>low/high/max</p>',
  updates: '<p>DeepSeek-V4.1-Flash</p>',
}
describe('DeepSeek 官方资料', () => {
  it('解析官方模型能力并对缺失的新 ID 给出添加与引用迁移差异', () => {
    const models = parseOfficialPages(pages)
    expect(models[0]).toMatchObject({ id: 'deepseek-flash', image: true, contextWindow: 1000000 })
    const catalog = [{ providerId: 'deepseek-official', modelId: 'deepseek-v4-flash', name: 'Old', nativeImage: 'no' as const, reasoningEfforts: [], source: 'host' as const, loaded: true }]
    expect(officialDiffs(catalog, models, 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing').map(item => item.id)).toContain('deepseek-flash:addModel')
    expect(officialDiffs(catalog, models, 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing').map(item => item.id)).toContain('deepseek-v4-flash:id')
  })
  it('证据不足时不生成建议', () => {
    expect(() => parseOfficialPages({ ...pages, thinking: 'unknown' })).toThrow('内容不足')
  })
})
