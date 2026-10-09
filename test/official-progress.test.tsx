import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OfficialProgress } from '../src/official-types.ts'

const hooks = vi.hoisted(() => ({ now: 0, effects: [] as (() => void | (() => void))[] }))
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useState: () => [hooks.now, (value: number) => { hooks.now = value }],
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect) },
}))
import { OfficialProgressStatus } from '../src/client/official-progress.tsx'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); hooks.effects = [] })
const text = (node: any): string => node === null || node === undefined || typeof node === 'boolean' ? '' : typeof node === 'object' ? Array.isArray(node) ? node.map(text).join('') : text(node.props?.children) : String(node)

describe('官方分析本轮计时', () => {
  it('从宿主开始时间计时，轮次切换重置，读取／完成／取消卸载不遗留计时器', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
    vi.stubGlobal('window', { setInterval, clearInterval })
    hooks.now = Date.now()
    const progress: OfficialProgress = { stage: 'analyzing', round: 1, pageCount: 1, analysisStartedAt: new Date(Date.now() - 5000).toISOString(), analysisTimeoutSeconds: 180 }
    expect(text(OfficialProgressStatus({ progress }))).toContain('本轮已用 5 秒 / 时限 180 秒')
    const cleanup = hooks.effects.pop()!() as () => void
    vi.advanceTimersByTime(3000)
    expect(text(OfficialProgressStatus({ progress }))).toContain('本轮已用 8 秒')
    cleanup(); hooks.effects = []
    const second = { ...progress, round: 2, pageCount: 4, analysisStartedAt: new Date().toISOString(), analysisTimeoutSeconds: 60 }
    expect(text(OfficialProgressStatus({ progress: second }))).toContain('第 2 轮，本轮已用 0 秒 / 时限 60 秒')
    const secondCleanup = hooks.effects.pop()!() as () => void
    expect(vi.getTimerCount()).toBe(1)
    secondCleanup() // React 在轮次切换、完成、取消和卸载时调用 effect 清理。
    for (const next of [{ stage: 'reading', round: 3, pageCount: 4 } as OfficialProgress, null]) {
      expect(text(OfficialProgressStatus({ progress: next }))).not.toContain('本轮已用')
      expect(hooks.effects.pop()!()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0)
    }
  })
  it('旧宿主进度不含计时字段时保留原提示，不启动本地截止', () => {
    vi.useFakeTimers()
    expect(text(OfficialProgressStatus({ progress: { stage: 'analyzing', round: 2, pageCount: 4 } }))).toBe('分析资料… 已读取 4 页，第 2 轮')
    expect(hooks.effects.pop()!()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0)
  })
})
