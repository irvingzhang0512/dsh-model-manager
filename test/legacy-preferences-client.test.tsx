import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../src/domain.js'
import { CatalogPreviewPanel, LegacyPreferencesManager } from '../src/client/catalog-panel.js'

const hooks = vi.hoisted(() => ({ states: [] as any[], cursor: 0 }))
vi.mock('react', async () => {
  const actual = await vi.importActual<any>('react')
  return { ...actual, useEffect: () => {}, useState: (initial: any) => {
    const index = hooks.cursor++
    if (!(index in hooks.states)) hooks.states[index] = initial
    return [hooks.states[index], (value: any) => { hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value }]
  } }
})
const nodes = (n: any): any[] => n == null || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)]
const text = (n: any): string => n == null || typeof n === 'boolean' ? '' : typeof n === 'object' ? Array.isArray(n) ? n.map(text).join('') : text(n.props?.children) : String(n)
beforeEach(() => { hooks.states = []; hooks.cursor = 0 })
afterEach(() => vi.unstubAllGlobals())

describe('旧偏好清理界面', () => {
  it('配置预览无模型主体和数量，必须明确勾选', () => {
    const resolve = vi.fn(), view = { counts: [], operations: [{ id: 'clearLegacyPreferences', kind: 'clearLegacyPreferences', path: 'auto.preferences', before: { research: { target: '@old' } }, after: null, blockedReasons: [], choices: [], references: [], attachedSettings: [] }] } as any
    const tree = CatalogPreviewPanel({ view, selected: [], busy: false, onResolve: resolve })
    expect(text(tree)).toContain('清理旧分工偏好'); expect(text(tree)).not.toContain('本地')
    const check = nodes(tree).find(n => n.type === 'input')
    expect(check.props.checked).toBe(false)
    check.props.onChange({ target: { checked: true } })
    expect(resolve).toHaveBeenCalledWith(['clearLegacyPreferences'], [])
  })
  it('缺失无卡片，有备份仍显示恢复；空对象可清理且草稿阻止操作', () => {
    const config = structuredClone(DEFAULT_CONFIG), props = { config, dirty: false, externalBusy: false, notify: vi.fn(), onApplied: vi.fn(), onBusyChange: vi.fn() }
    const render = (extra = {}) => { hooks.cursor = 0; return LegacyPreferencesManager({ ...props, ...extra }) }
    expect(render()).toBeNull()
    expect(text(render({ backupId: 'backup' }))).toContain('恢复最近操作')
    config.auto.preferences = {}
    expect(text(render())).toContain('旧分工偏好已停用')
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const dirty = render({ dirty: true })
    const button = nodes(dirty).find(n => n.type === 'button' && text(n) === '预览清理')
    expect(button.props.disabled).toBe(true); button.props.onClick()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('预览可取消而无写入，应用后回传完整状态；失败持久显示', async () => {
    const config = structuredClone(DEFAULT_CONFIG); config.auto.preferences = { research: { target: '@old' } }
    const onApplied = vi.fn(), props = { config, dirty: false, externalBusy: false, notify: vi.fn(), onApplied, onBusyChange: vi.fn() }
    const render = () => { hooks.cursor = 0; return LegacyPreferencesManager(props) }
    const view = { token: 'token', selected: ['clearLegacyPreferences'], operations: [], counts: [] }
    const cleaned = structuredClone(config); delete cleaned.auto.preferences
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(_url.endsWith('catalog-apply') ? { snapshot: { config: cleaned, revision: 2 } } : view)))
    vi.stubGlobal('fetch', fetch)
    const click = async (label: string) => { nodes(render()).find(n => n.type === 'button' && text(n) === label).props.onClick(); await new Promise(r => setTimeout(r, 0)) }
    await click('预览清理'); await click('取消清理')
    expect(fetch).toHaveBeenCalledTimes(1); expect(onApplied).not.toHaveBeenCalled()
    await click('预览清理'); await click('应用清理')
    expect(onApplied).toHaveBeenCalledWith({ config: cleaned, revision: 2 })
    fetch.mockImplementation(async () => new Response(JSON.stringify({ error: 'SETTINGS_CONFLICT' }), { status: 409 }))
    await click('预览清理')
    expect(text(render())).toContain('SETTINGS_CONFLICT')
  })
})
