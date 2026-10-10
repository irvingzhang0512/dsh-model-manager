import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../src/domain.js'
import { CatalogPreviewPanel } from '../src/client/catalog-panel.js'
import { SelectModel, VisionSection } from '../src/client/index.js'
import type { CatalogPreview } from '../src/catalog-types.js'

afterEach(() => vi.unstubAllGlobals())
const nodes = (node: any): any[] => node === null || node === undefined || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
const text = (node: any): string => node === null || node === undefined || typeof node === 'boolean' ? '' : typeof node === 'object' ? Array.isArray(node) ? node.map(text).join('') : text(node.props?.children) : String(node)
describe('别名删除与视觉清理界面', () => {
  it('失效别名和被图片筛选排除的真实模型保留选中值及原因，可显式清除', () => {
    const changed = vi.fn()
    for (const value of ['@removed', { providerId: 'p', modelId: 'missing' }]) {
      const tree = SelectModel({ value, models: [], aliases: [], onChange: changed })
      expect(text(tree)).toContain('失效'); expect(nodes(tree).filter(n => n.type === 'option').map(n => n.props.value)).toContain(tree.props.value)
      tree.props.onChange({ target: { value: '' } }); expect(changed).toHaveBeenLastCalledWith(undefined)
    }
  })
  it.each([true, false])('视觉 enabled=%s 时仍可查看旧兜底，并单独清除而保留当前模型', enabled => {
    const draft = structuredClone(DEFAULT_CONFIG); draft.vision = { enabled, policy: 'native-first', target: { providerId: 'p', modelId: 'image' } }; draft.auto.roles.vision = { enabled: false, target: '@old', tier: 'high' }
    const tree = VisionSection({ draft, models: [], aliases: ['old'], edit: fn => fn(draft) })
    expect(text(tree)).toContain('视觉模型'); expect(text(tree)).toContain('旧视觉兜底')
    nodes(tree).find(n => n.type === 'button' && text(n) === '清除旧视觉兜底').props.onClick()
    expect(draft.auto.roles.vision.target).toBeUndefined(); expect(draft.auto.roles.vision.tier).toBeUndefined()
    expect(draft.vision).toEqual({ enabled, policy: 'native-first', target: { providerId: 'p', modelId: 'image' } })
  })
  it('清空当前目标时明确确认旧兜底，取消不修改，确认后不暗中留旧引用', () => {
    const draft = structuredClone(DEFAULT_CONFIG); draft.vision.target = '@old'; draft.auto.roles.vision.target = '@old'
    const confirm = vi.fn(() => false); vi.stubGlobal('window', { confirm })
    const button = nodes(VisionSection({ draft, models: [], aliases: ['old'], edit: fn => fn(draft) })).find(n => n.type === 'button' && text(n) === '清空视觉目标及旧兜底')
    button.props.onClick(); expect(draft.vision.target).toBe('@old')
    confirm.mockReturnValue(true); button.props.onClick()
    expect(draft.vision.target).toBeUndefined(); expect(draft.auto.roles.vision.target).toBeUndefined()
  })
  it('引用预览显示删除别名及中文隐藏用途，未处理引用无法勾选，取消不应用', () => {
    const onResolve = vi.fn(), view = { counts: [], operations: [{ id: 'delete', kind: 'removeAlias', model: { providerId: 'dsh-model-manager', modelId: 'alias:old' }, before: {}, after: null, references: [], attachedSettings: [], conflicts: [], choices: [{ id: 'old-main', kind: 'replacement', path: 'auto.main.target', options: [{ optionId: 'clear', label: '清除旧主模型绑定' }] }], blockedReasons: ['仍被引用'] }] } as unknown as CatalogPreview
    const tree = CatalogPreviewPanel({ view, selected: [], busy: false, onResolve })
    expect(text(tree)).toContain('删除别名：@old'); expect(text(tree)).toContain('旧主模型绑定')
    expect(nodes(tree).find(n => n.type === 'input').props.disabled).toBe(true)
    nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: 'clear' } })
    expect(onResolve).toHaveBeenLastCalledWith([], [{ id: 'old-main', optionId: 'clear' }])
  })
})
