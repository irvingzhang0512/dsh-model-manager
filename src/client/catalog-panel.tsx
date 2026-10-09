import React, { useEffect, useState } from 'react'
import type { ManagerConfig, ModelRecord, ModelRef } from '../domain.js'
import type { CatalogCapability, CatalogOperation, CatalogPreview, CatalogResolution } from '../catalog-types.js'

export async function catalogRequest(path: string, value: unknown): Promise<any> {
  const response = await fetch(`/api/model-manager/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  const body = await response.json()
  if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { existingModel: body.existingModel })
  return body
}
export function CatalogPreviewPanel({ view, selected, busy, onResolve }: { view: CatalogPreview; selected: string[]; busy: boolean; onResolve: (selected: string[], resolutions: CatalogResolution[]) => void }) {
  const resolutions = view.operations.flatMap(operation => operation.choices.filter(c => c.resolution).map(c => ({ id: c.id, optionId: c.resolution! })))
  const labels = { add: '新增模型', rename: '修改显示名称', remove: '删除模型', update: '更新声明', migrate: '整体合并迁移' }
  return <div>
    <p className="dmm-muted">只在应用时写入；处理冲突和引用不会调用 LLM。删除或迁移是一组整体操作。</p>
    {view.counts.filter(c => c.operationCount || view.operations.some(o => o.model.providerId === c.providerId)).map(c => <p key={c.providerId}>{c.providerId}：本地 {c.before} 个 → 选中操作后 {c.after} 个；{c.operationCount} 项选中操作</p>)}
    {view.operations.map(operation => <div className="dmm-card" key={operation.id}>
      <label><input type="checkbox" disabled={busy || (!!operation.blockedReasons.length && !selected.includes(operation.id))} checked={selected.includes(operation.id)} onChange={e => onResolve(e.target.checked ? [...selected, operation.id] : selected.filter(id => id !== operation.id), resolutions)} />{labels[operation.kind]}：<strong>{operation.model.modelId}</strong> · {operation.model.providerId}</label>
      <p className="dmm-muted">{JSON.stringify(operation.before)} → {JSON.stringify(operation.after)}</p>
      {!!operation.referenceChanges?.length && <details open><summary>引用与视觉开关变化</summary>{operation.referenceChanges.map(change => <p className="dmm-muted" key={change.path}>{change.path}：{JSON.stringify(change.before)} → {JSON.stringify(change.after)}</p>)}</details>}
      {!!operation.references.filter(r => r.type === 'usage').length && <details><summary>使用引用</summary>{operation.references.filter(r => r.type === 'usage').map((r, i) => <p className="dmm-muted" key={i}>{r.chain?.join(' → ') ?? r.path}</p>)}</details>}
      {!!operation.attachedSettings.length && <details open><summary>附属设置（将随明确确认的删除清理并备份）</summary>{operation.attachedSettings.map(path => <p className="dmm-muted" key={path}>{path}</p>)}</details>}
      {operation.choices.map(choice => <div className="dmm-row" key={choice.id}><label>{choice.kind === 'vision' ? '图片辅助模型：替换／关闭辅助并删除／取消删除' : choice.path}<select disabled={busy} value={choice.resolution ?? ''} onChange={e => {
        const next = resolutions.filter(r => r.id !== choice.id)
        if (e.target.value) next.push({ id: choice.id, optionId: e.target.value })
        onResolve(selected, next)
      }}><option value="">请选择处理方式</option>{choice.options.map(option => <option key={option.optionId} value={option.optionId}>{option.label}</option>)}</select></label>{choice.kind === 'vision' && <span className="dmm-muted">取消删除：不勾选本组；共享别名等其他引用仍需处理。</span>}</div>)}
      {operation.kind === 'remove' && <button disabled={busy} onClick={() => onResolve(selected.filter(id => id !== operation.id), resolutions)}>取消删除（保留原配置）</button>}
      {operation.blockedReasons.map((reason, i) => <p className="dmm-error" key={i}>{reason}</p>)}
    </div>)}
  </div>
}

export interface CatalogEditor { kind: 'add' | 'rename' | 'remove'; model?: ModelRef }
export function CatalogManager({ models, capabilities, editor, setEditor, dirty, externalBusy, backupId, backupWritesPlugin, onApplied, notify }: {
  models: ModelRecord[]; capabilities: CatalogCapability[]; editor: CatalogEditor | null; setEditor: (value: CatalogEditor | null) => void
  dirty: boolean; externalBusy: boolean; backupId?: string; backupWritesPlugin?: boolean; onApplied: (snapshot: { config: ManagerConfig; [key: string]: unknown }) => void
  notify: (kind: 'info' | 'success' | 'error', message: string) => void
}) {
  const [provider, setProvider] = useState(''), [id, setId] = useState(''), [name, setName] = useState('')
  const [image, setImage] = useState(''), [context, setContext] = useState(''), [output, setOutput] = useState('')
  const [view, setView] = useState<CatalogPreview | null>(null), [working, setBusy] = useState(false)
  const busy = working || externalBusy
  const [existing, setExisting] = useState<ModelRef>()
  useEffect(() => {
    setView(null); setExisting(undefined)
    setProvider(editor?.model?.providerId ?? capabilities.find(c => c.canAdd)?.providerId ?? '')
    setId(editor?.model?.modelId ?? '')
    setName(models.find(m => m.providerId === editor?.model?.providerId && m.modelId === editor?.model?.modelId)?.name ?? '')
    setImage(''); setContext(''); setOutput('')
  }, [editor])
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } catch (error) { const ref = (error as any)?.existingModel; if (ref) setExisting(ref); notify('error', String(error)) } finally { setBusy(false) } }
  const invalidate = () => { setView(null); setExisting(undefined) }
  const preview = () => void act(async () => {
    setView(null)
    const model = { providerId: provider, modelId: id }
    const operation: CatalogOperation = editor?.kind === 'rename' ? { kind: 'rename', model, name } : editor?.kind === 'remove' ? { kind: 'remove', model } : { kind: 'add', model, ...(name ? { name } : {}), ...(image ? { image: image === 'yes' } : {}), ...(context ? { contextWindow: Number(context) } : {}), ...(output ? { maxTokens: Number(output) } : {}) }
    setView(await catalogRequest('catalog-preview', { operations: [operation] }))
  })
  const resolve = (selected: string[], resolutions: CatalogResolution[]) => void act(async () => {
    if (!view) return
    const next = await catalogRequest('catalog-resolve', { token: view.token, selected, resolutions }); setView(next.catalog ?? next)
  })
  const apply = () => void act(async () => {
    if (!view || dirty && view.writesPlugin) return
    const result = await catalogRequest('catalog-apply', { token: view.token, selected: view.selected })
    setView(null); setEditor(null); onApplied(result.snapshot); notify('success', '已应用本次目录修改，可恢复本次操作。')
  })
  const restore = () => void act(async () => {
    if (dirty && backupWritesPlugin !== false) return
    const result = await catalogRequest('catalog-restore', { backupId }); onApplied(result.snapshot); setView(null); notify('success', '已恢复本次目录操作。')
  })
  return <div className="dmm-card" id="dmm-catalog-editor">
    <div className="dmm-row"><strong>模型目录管理</strong><button disabled={busy || !capabilities.some(c => c.canAdd)} onClick={() => setEditor({ kind: 'add' })}>新增模型</button>{backupId && <button disabled={busy || dirty && backupWritesPlugin !== false} onClick={restore}>恢复本次目录操作</button>}</div>
    <p className="dmm-muted">API ID 用于调用；显示名称用于 DSH 展示。修改名称不改变实际模型。新增不会自动请求 API。</p>
    {editor && <>
      <div className="dmm-row"><label>Provider <select disabled={busy || editor.kind !== 'add'} value={provider} onChange={e => { setProvider(e.target.value); invalidate() }}>{capabilities.filter(c => c.canAdd).map(c => <option key={c.providerId}>{c.providerId}</option>)}</select></label><label>API 模型 ID <input disabled={busy || editor.kind !== 'add'} value={id} onChange={e => { setId(e.target.value); invalidate() }} /></label></div>
      {editor.kind !== 'remove' && <div className="dmm-row"><label>显示名称 <input disabled={busy} value={name} onChange={e => { setName(e.target.value); invalidate() }} /></label></div>}
      {editor.kind === 'add' && <div className="dmm-row"><label>图片声明 <select value={image} disabled={busy} onChange={e => { setImage(e.target.value); invalidate() }}><option value="">使用 Provider 默认</option><option value="yes">支持图片</option><option value="no">仅文本</option></select></label><label>上下文 <input type="number" min="1" disabled={busy} value={context} onChange={e => { setContext(e.target.value); invalidate() }} /></label><label>输出上限 <input type="number" min="1" disabled={busy} value={output} onChange={e => { setOutput(e.target.value); invalidate() }} /></label></div>}
      <div className="dmm-row"><button disabled={busy || !id || !provider} onClick={preview}>{editor.kind === 'remove' ? '预览删除及引用处理' : '预览本次修改'}</button><button disabled={busy} onClick={() => { setEditor(null); setView(null) }}>取消</button>{existing && <button disabled={busy} onClick={() => setEditor({ kind: 'rename', model: existing })}>编辑已有模型</button>}</div>
    </>}
    {view && <><CatalogPreviewPanel view={view} selected={view.selected} busy={busy} onResolve={resolve} /><button className="dmm-primary" disabled={busy || dirty && view.writesPlugin || !view.selected.length || view.operations.some(o => view.selected.includes(o.id) && o.blockedReasons.length)} onClick={apply}>应用本次修改</button></>}
    {dirty && <p className="dmm-dirty">有其他未保存插件草稿。仅更改宿主目录可直接应用；涉及插件设置时，先保存或放弃草稿，再重新预览。处理选项无需保存。</p>}
  </div>
}
