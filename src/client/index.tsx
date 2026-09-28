import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ManagerConfig, ModelRecord, ModelRef, ProbeField, ProbeSuggestion, Role, Tier, Verification } from '../domain.js'

export const inject = ['slots', 'modelDirectories']
type ModelDirectory = { store: { getSnapshot(): { current: { provider: string; model: string } | null }; subscribe(listener: () => void): () => void }; load(): Promise<{ current: { provider: string; model: string } | null }>; select(selection: { provider: string; model: string }): Promise<void> }
type ModelDirectories = { directoryFor(sessionId: string): ModelDirectory }
const managedProvider = 'dsh-model-manager'
function managedModel(target: ModelRef | string): string {
  if (typeof target === 'string') return `alias:${target.slice(1)}`
  const bytes = new TextEncoder().encode(JSON.stringify([target.providerId, target.modelId]))
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function selectManaged(directory: ModelDirectory, target?: ModelRef | string, force = false): Promise<void> {
  const current = (await directory.load()).current
  if (!target && (!force || !current || current.provider === managedProvider)) return
  const model = target ? managedModel(target) : managedModel({ providerId: current!.provider, modelId: current!.model })
  if (current?.provider !== managedProvider || current.model !== model) await directory.select({ provider: managedProvider, model })
}
type Snapshot = { revision: number; nativeRevision?: number; config: ManagerConfig; models: ModelRecord[]; verifications: (Verification & { stale: boolean })[] }
type Tab = '模型' | '别名与推理配置' | 'Manual/Auto' | '视觉' | '可靠性' | '验证' | '日志'
const tabs: Tab[] = ['模型', '别名与推理配置', 'Manual/Auto', '视觉', '可靠性', '验证', '日志']
const roles: Role[] = ['main', 'search', 'coding', 'review', 'strong', 'vision']
const tiers: Tier[] = ['auto', 'fast', 'balanced', 'deep', 'max']
const probeLabels: Record<ProbeField, string> = { hostImage: '宿主原生图片声明', pluginImage: '插件图片声明', pluginTools: '插件工具声明' }
type Notice = { id: number; kind: 'info' | 'success' | 'error'; text: string }
type ProbeResponse = { verifications: Verification[]; suggestions: ProbeSuggestion[]; cancelled?: boolean; elevated?: boolean; restoreFailed?: boolean; notes?: string[] }
type Support = 'yes' | 'no' | 'unknown'
const supportLabels: Record<Support, string> = { yes: '支持', no: '不支持', unknown: '未知' }

const style = `
.dmm-root{padding:20px;max-width:1100px;color:var(--dsw-alias-text-primary,#222)}
.dmm-root h2{margin:0 0 6px;font-size:20px}.dmm-muted{color:var(--dsw-alias-text-secondary,#666);font-size:12px}
.dmm-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0}.dmm-tabs button,.dmm-root button,.dmm-composer{font:inherit}
.dmm-tabs button,.dmm-root button{border:1px solid var(--dsw-alias-border-primary,#ccc);border-radius:7px;background:var(--dsw-alias-fill-surface,#fff);color:inherit;padding:6px 10px;cursor:pointer}
.dmm-tabs button[aria-selected=true],.dmm-root button.dmm-primary{background:var(--dsw-alias-brand-primary,#356dde);color:#fff;border-color:transparent}
.dmm-root button:disabled{cursor:not-allowed;opacity:.5}
.dmm-card{border:1px solid var(--dsw-alias-border-primary,#ddd);border-radius:10px;padding:14px;margin:10px 0;background:var(--dsw-alias-fill-surface,#fff)}
.dmm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.dmm-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0}
.dmm-root input,.dmm-root select,.dmm-root textarea{font:inherit;background:var(--dsw-alias-fill-canvas,#fff);color:inherit;border:1px solid var(--dsw-alias-border-primary,#bbb);border-radius:6px;padding:6px;min-width:110px}
.dmm-root textarea{width:100%;min-height:100px}.dmm-root label{font-size:13px}.dmm-error{color:#b42318}.dmm-composer{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px}
.dmm-dirty{color:#b54708;font-size:12px}
.dmm-empty{border-style:dashed;text-align:center}
.dmm-modal-mask{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:20px}
.dmm-modal{background:var(--dsw-alias-fill-surface,#fff);color:var(--dsw-alias-text-primary,#222);border:1px solid var(--dsw-alias-border-primary,#ccc);border-radius:12px;padding:16px;width:min(620px,94vw);max-height:82vh;overflow:auto;box-shadow:0 16px 48px rgba(0,0,0,.28)}
.dmm-modal h3{margin:0 0 6px;font-size:16px}
.dmm-note{color:#b54708;font-size:12px;margin:6px 0}
.dmm-actions{position:sticky;bottom:0;z-index:6;display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-primary,#ddd);border-radius:10px;background:var(--dsw-alias-fill-surface,#fff);box-shadow:0 -6px 16px rgba(0,0,0,.07)}
.dmm-toasts{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(380px,90vw)}
.dmm-toast{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:9px;font-size:13px;line-height:1.45;background:var(--dsw-alias-fill-surface,#fff);border:1px solid var(--dsw-alias-border-primary,#ccc);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-text-primary,#222)}
.dmm-toast-success{border-color:#2f855a}.dmm-toast-error{border-color:#b42318}.dmm-toast-info{border-color:var(--dsw-alias-brand-primary,#356dde)}
.dmm-root .dmm-toast button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px;line-height:1;padding:0 2px}
`
function injectStyle(): void {
  if (document.querySelector('style[data-dsh-model-manager]')) return
  const node = document.createElement('style'); node.dataset.dshModelManager = ''; node.textContent = style; document.head.appendChild(node)
}
async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`/api/model-manager${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}
function refValue(ref?: ModelRef | string): string { return typeof ref === 'string' ? ref : ref ? JSON.stringify([ref.providerId, ref.modelId]) : '' }
function parseRef(value: string): ModelRef | string | undefined {
  if (!value) return undefined
  if (value.startsWith('@')) return value
  const [providerId, modelId] = JSON.parse(value) as [string, string]
  return { providerId, modelId }
}
/** 配置是否与已保存版本一致：两侧都来自同一份 JSON，因此直接比较序列化结果即可。 */
function sameConfig(a: ManagerConfig, b: ManagerConfig): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function supportsOff(target: ModelRef | string | undefined, config: ManagerConfig, models: ModelRecord[]): boolean {
  if (!target) return false
  const refs = typeof target === 'string' ? config.aliases[target.slice(1)] ?? [] : [target]
  return refs.length > 0 && refs.every(ref => models.some(model => model.providerId === ref.providerId && model.modelId === ref.modelId && model.reasoningEfforts.some(e => e.id === 'off')))
}
function ThinkingSelect({ value, offAvailable, onChange }: { value?: 'inherit' | 'auto' | 'off'; offAvailable: boolean; onChange: (value: 'inherit' | 'auto' | 'off') => void }) {
  return <select aria-label="思考模式" value={value ?? 'inherit'} onChange={event => onChange(event.target.value as 'inherit' | 'auto' | 'off')}><option value="inherit">思考继承</option><option value="auto">思考自动</option><option value="off" disabled={!offAvailable}>关闭思考{offAvailable ? '' : '（模型不支持）'}</option></select>
}
function SelectModel({ value, models, aliases, onChange }: { value?: ModelRef | string; models: ModelRecord[]; aliases: string[]; onChange: (next?: ModelRef | string) => void }) {
  return <select value={refValue(value)} onChange={event => onChange(parseRef(event.target.value))}>
    <option value="">跟随宿主／未设置</option>
    {aliases.map(alias => <option key={alias} value={`@${alias}`}>@{alias}</option>)}
    {models.map(model => <option key={`${model.providerId}:${model.modelId}`} value={JSON.stringify([model.providerId, model.modelId])}>{model.name} · {model.providerId}</option>)}
  </select>
}

function FilterBar({ text, onText, provider, onProvider, providers, matched, total, onReset, children }: {
  text: string; onText: (value: string) => void; provider: string; onProvider: (value: string) => void
  providers: string[]; matched: number; total: number; onReset: () => void; children?: React.ReactNode
}) {
  return <div className="dmm-row">
    <select aria-label="筛选 Provider" value={provider} onChange={event => onProvider(event.target.value)}>
      <option value="">全部 Provider（{providers.length}）</option>
      {providers.map(id => <option key={id} value={id}>{id}</option>)}
    </select>
    <input aria-label="筛选模型" placeholder="筛选模型名或 ID" value={text} onChange={event => onText(event.target.value)} />
    <span className="dmm-muted">匹配 {matched} / 共 {total} 个模型</span>
    {(text || provider) ? <button onClick={onReset}>清除筛选</button> : null}
    {children}
  </div>
}

function NativeEditor({ model, revision, refresh, notify }: { model: ModelRecord; revision?: number; refresh: () => Promise<void>; notify: (kind: Notice['kind'], text: string) => void }) {
  const [image, setImage] = useState(model.nativeImage)
  const [context, setContext] = useState(model.contextWindow?.toString() ?? '')
  const [output, setOutput] = useState(model.defaultMaxTokens?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setImage(model.nativeImage); setContext(model.contextWindow?.toString() ?? ''); setOutput(model.defaultMaxTokens?.toString() ?? '') }, [model.nativeImage, model.contextWindow, model.defaultMaxTokens])
  const save = async () => {
    if (revision === undefined) return
    setBusy(true)
    try {
      const fields: Record<string, unknown> = { providerId: model.providerId, modelId: model.modelId, revision }
      if (image !== 'unknown') fields.image = image === 'yes'
      if (context) fields.contextWindow = Number(context)
      if (output) fields.maxTokens = Number(output)
      await request('/native', { method: 'POST', body: JSON.stringify(fields) })
      await refresh()
      notify('success', `已把宿主声明写入 llm-pi-ai：${model.name}。下一次请求按新声明处理。`)
    } catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  const clear = async (field: 'image' | 'contextWindow' | 'maxTokens') => {
    if (revision === undefined) return
    setBusy(true)
    try {
      await request('/native', { method: 'POST', body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, revision, clear: [field] }) })
      await refresh()
      notify('success', `已清除 ${model.name} 的该项宿主覆盖，后续请求使用宿主默认声明。`)
    } catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  return <div className="dmm-row"><label>宿主原生图片 <select disabled={!model.nativeEditable} value={image} onChange={event => setImage(event.target.value as ModelRecord['nativeImage'])}><option value="unknown">未知</option><option value="yes">支持</option><option value="no">不支持</option></select></label><label>上下文容量 <input disabled={!model.nativeEditable} type="number" min="1" value={context} onChange={event => setContext(event.target.value)} /></label><label>模型最大输出 <input disabled={!model.nativeEditable} type="number" min="1" value={output} onChange={event => setOutput(event.target.value)} /></label><button disabled={busy || revision === undefined || !model.nativeEditable} onClick={() => void save()}>保存到宿主</button>{model.nativeClearable && <><button disabled={busy || revision === undefined} onClick={() => void clear('image')}>清除图片覆盖</button><button disabled={busy || revision === undefined} onClick={() => void clear('contextWindow')}>清除容量覆盖</button><button disabled={busy || revision === undefined} onClick={() => void clear('maxTokens')}>清除输出覆盖</button></>}{!model.nativeEditable && <span className="dmm-muted">{model.nativeEditReason}</span>}</div>
}

function ManagerSection() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<ManagerConfig | null>(null)
  const [tab, setTab] = useState<Tab>('模型')
  const [fatal, setFatal] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [probing, setProbing] = useState('')
  const [probeProgress, setProbeProgress] = useState('')
  const [preview, setPreview] = useState<{ model: ModelRecord; suggestions: ProbeSuggestion[]; checked: boolean[]; elevated?: boolean; restoreFailed?: boolean; notes?: string[] } | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [aliasName, setAliasName] = useState('')
  const [verifyTarget, setVerifyTarget] = useState<ModelRef | string>()
  const [verifyKind, setVerifyKind] = useState<Verification['kind']>('text')
  const [verifyResult, setVerifyResult] = useState<Verification | null>(null)
  const [logs, setLogs] = useState<Record<string, unknown>[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const verifyAbort = useRef<AbortController | null>(null)
  const noticeSeq = useRef(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => { timers.current.forEach(id => window.clearTimeout(id)) }, [])
  const dismiss = useCallback((id: number) => setNotices(list => list.filter(item => item.id !== id)), [])
  const notify = useCallback((kind: Notice['kind'], text: string) => {
    const id = ++noticeSeq.current
    setNotices(list => [...list, { id, kind, text }])
    const ttl = kind === 'error' ? 12000 : 4500
    timers.current.push(window.setTimeout(() => setNotices(list => list.filter(item => item.id !== id)), ttl))
  }, [])

  const load = async () => { const next = await request('') as Snapshot; setSnapshot(next); setDraft(structuredClone(next.config)); setFatal('') }
  useEffect(() => { void load().catch(error => setFatal(String(error))) }, [])
  /** 只刷新宿主目录与证据，不覆盖用户正在编辑的草稿。 */
  const refreshDirectory = async (silent = false): Promise<Snapshot | null> => {
    if (!snapshot) return null
    const before = new Set(snapshot.models.map(model => `${model.providerId}:${model.modelId}`))
    const next = await request('/refresh', { method: 'POST' }) as Snapshot
    const after = new Set(next.models.map(model => `${model.providerId}:${model.modelId}`))
    const added = [...after].filter(key => !before.has(key)).length
    const removed = [...before].filter(key => !after.has(key)).length
    setSnapshot(next)
    if (!silent) notify('success', `目录已刷新：宿主加载 ${next.models.length} 个模型${added || removed ? `（新增 ${added}、移除 ${removed}）` : '（与上次相比没有变化）'}。`)
    return next
  }
  const edit = (fn: (next: ManagerConfig) => void) => setDraft(current => { if (!current) return current; const next = structuredClone(current); fn(next); return next })
  const save = async () => {
    if (!snapshot || !draft) return
    setBusy(true)
    try {
      const next = await request('', { method: 'PUT', body: JSON.stringify({ revision: snapshot.revision, config: draft }) }) as Snapshot
      setSnapshot(next); setDraft(structuredClone(next.config)); window.dispatchEvent(new Event('dmm:config'))
      notify('success', '已保存插件配置（所有标签页），后续请求使用新配置。')
    } catch (error) {
      const text = String(error)
      notify('error', /CONFLICT|冲突/i.test(text) ? `${text}：配置已被别处修改，请点「重新加载」取回最新版本再改。` : text)
    } finally { setBusy(false) }
  }
  const reload = async () => {
    if (dirty && !window.confirm('「重新加载」会放弃所有未保存的修改，改为读取已保存的配置。确定继续？')) return
    try { await load(); notify('info', '已重新加载当前已保存的配置。') } catch (error) { notify('error', String(error)) }
  }
  const verifyOne = async (ref: ModelRef, kind: Verification['kind'], signal?: AbortSignal) => {
    const result = await request('/verify', { method: 'POST', body: JSON.stringify({ ...ref, kind }), signal })
    setVerifyResult(result.verification)
    const fresh = await request('') as Snapshot
    setSnapshot(fresh)
  }
  const verifyBatch = async (models: ModelRecord[], kind: Verification['kind']) => {
    if (!models.length || !window.confirm(`将串行发送 ${models.length} 次 ${kind} 模型验证请求。是否开始？`)) return
    const controller = new AbortController()
    verifyAbort.current = controller
    setBusy(true)
    let completed = 0
    try {
      for (const model of models) {
        if (controller.signal.aborted) break
        await verifyOne(model, kind, controller.signal)
        completed++
        setProbeProgress(`已验证 ${completed}/${models.length} 个模型`)
      }
    } catch (error) { if (!controller.signal.aborted) notify('error', String(error)) }
    finally {
      notify(controller.signal.aborted ? 'info' : 'success', `批量验证结束：${completed}/${models.length} 次请求${controller.signal.aborted ? '，已取消' : ''}。`)
      setProbeProgress(''); setBusy(false); verifyAbort.current = null
    }
  }
  const probeOne = async (model: ModelRecord) => {
    const key = `${model.providerId}:${model.modelId}`
    setProbing(key)
    try {
      const result = await request('/probe', { method: 'POST', body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, items: ['image', 'tools'] }) }) as ProbeResponse
      const next = await refreshDirectory(true)
      const fresh = next?.models.find(item => item.providerId === model.providerId && item.modelId === model.modelId) ?? model
      if (result.restoreFailed) notify('error', `「${model.name}」探测后恢复宿主声明失败，请到模型卡片核对「宿主原生图片」是否被留在「支持」。`)
      for (const note of result.notes ?? []) notify('info', note)
      if (!result.suggestions.length) {
        notify('info', `「${model.name}」探测完成但没有可写入的结论（${result.verifications.map(item => `${item.kind}=${item.status}${item.behavior ? `/${item.behavior}` : ''}`).join('、')}）。证据已记录，可在「验证」标签查看。`)
        return
      }
      setPreview({ model: fresh, suggestions: result.suggestions, checked: result.suggestions.map(item => item.confidence === 'high'), elevated: result.elevated, restoreFailed: result.restoreFailed, notes: result.notes })
    } catch (error) { notify('error', `探测失败：${String(error)}`) }
    finally { setProbing('') }
  }
  const probeBatch = async () => {
    if (!snapshot) return
    const models = filtered
    if (!models.length) return
    if (!window.confirm(`将对当前筛选的 ${models.length} 个模型逐个发出真实探测请求（图片 + 工具，会消耗 token）。只写入高置信结论：图片能力写宿主声明与插件声明，工具能力只写插件声明。是否继续？`)) return
    setBusy(true)
    let revision = snapshot.nativeRevision
    let done = 0, hostApplied = 0, inconclusive = 0, restoreFailedCount = 0
    const pluginEdits: { model: ModelRecord; field: ProbeField; value: Support }[] = []
    try {
      for (const model of models) {
        setProbeProgress(`探测中 ${done + 1}/${models.length}：${model.name}`)
        try {
          const result = await request('/probe', { method: 'POST', body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, items: ['image', 'tools'] }) }) as ProbeResponse
          if (result.restoreFailed) { restoreFailedCount++; notify('error', `「${model.name}」探测后恢复宿主声明失败，请到模型卡片核对「宿主原生图片」。`) }
          const high = result.suggestions.filter(item => item.confidence === 'high')
          if (!high.length) inconclusive++
          for (const item of high) {
            if (item.field === 'hostImage') {
              if (model.nativeEditable && revision !== undefined) {
                await request('/native', { method: 'POST', body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, revision, image: item.value === 'yes' }) })
                hostApplied++
              }
            } else pluginEdits.push({ model, field: item.field, value: item.value })
          }
        } catch (error) { setProbeProgress(`「${model.name}」探测失败：${String(error)}`) }
        const next = await request('/refresh', { method: 'POST' }) as Snapshot
        setSnapshot(next); revision = next.nativeRevision
        done++
      }
      if (pluginEdits.length) edit(next => {
        for (const item of pluginEdits) {
          const key = JSON.stringify([item.model.providerId, item.model.modelId])
          next.models[key] ??= {}
          next.models[key].capability ??= {}
          if (item.field === 'pluginImage') next.models[key].capability!.image = item.value
          if (item.field === 'pluginTools') next.models[key].capability!.tools = item.value
        }
      })
      notify('success', `批量探测完成：${done}/${models.length} 个模型；写宿主 ${hostApplied} 项、插件声明 ${pluginEdits.length} 项、无结论 ${inconclusive} 个。${pluginEdits.length ? '插件声明需再点页面底部「保存设置」落盘。' : ''}${restoreFailedCount ? ` ${restoreFailedCount} 个模型恢复宿主声明失败，请逐一核对。` : ''}`)
    } catch (error) { notify('error', `批量探测中断：${String(error)}`) }
    finally { setProbeProgress(''); setBusy(false) }
  }
  const applyProbe = async () => {
    if (!preview || !snapshot) return
    const chosen = preview.suggestions.filter((_, index) => preview.checked[index])
    if (!chosen.length) { notify('info', '没有勾选任何结论。'); return }
    setBusy(true)
    let hostApplied = 0, skipped = 0
    const pluginChosen = chosen.filter(item => item.field !== 'hostImage')
    try {
      if (chosen.some(item => item.field === 'hostImage')) {
        if (preview.model.nativeEditable && snapshot.nativeRevision !== undefined) {
          await request('/native', { method: 'POST', body: JSON.stringify({ providerId: preview.model.providerId, modelId: preview.model.modelId, revision: snapshot.nativeRevision, image: true }) })
          await refreshDirectory(true)
          hostApplied++
        } else skipped++
      }
      if (pluginChosen.length) edit(next => {
        const key = JSON.stringify([preview.model.providerId, preview.model.modelId])
        next.models[key] ??= {}
        next.models[key].capability ??= {}
        for (const item of pluginChosen) {
          if (item.field === 'pluginImage') next.models[key].capability!.image = item.value
          if (item.field === 'pluginTools') next.models[key].capability!.tools = item.value
        }
      })
      setPreview(null)
      notify('success', `已应用探测结论：宿主声明 ${hostApplied} 项、插件声明 ${pluginChosen.length} 项${skipped ? `，${skipped} 项因宿主不可写被跳过` : ''}。${pluginChosen.length ? '插件声明需再点「保存设置」落盘。' : ''}`)
    } catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  if (!draft || !snapshot) return <div className="dmm-root">{fatal || '正在加载模型管理…'}</div>
  const dirty = !sameConfig(draft, snapshot.config)
  const aliases = Object.keys(draft.aliases)
  const providers = [...new Set(snapshot.models.map(model => model.providerId))].sort()
  const keyword = modelFilter.trim().toLowerCase()
  const filtered = snapshot.models.filter(model => (!providerFilter || model.providerId === providerFilter) && `${model.providerId} ${model.modelId} ${model.name}`.toLowerCase().includes(keyword))
  const resetFilter = () => { setModelFilter(''); setProviderFilter('') }
  const currentSupport = (model: ModelRecord, field: ProbeField): Support => {
    if (field === 'hostImage') return model.nativeImage
    const settings = draft.models[JSON.stringify([model.providerId, model.modelId])]?.capability
    return (field === 'pluginImage' ? settings?.image : settings?.tools) ?? 'unknown'
  }
  return <div className="dmm-root">
    <h2>模型管理</h2><div className="dmm-muted">管理模型声明、别名、角色和视觉辅助。原有附件上传与发送流程保持不变。目录只代表宿主已加载的模型；外部导入若尚未被宿主加载，需要先刷新宿主。</div>
    <div className="dmm-tabs">{tabs.map(item => <button key={item} aria-selected={tab === item} onClick={() => { setTab(item); if (item === '日志') void request('/logs').then(result => setLogs(result.events)).catch(error => notify('error', String(error))) }}>{item}</button>)}</div>
    {tab === '模型' && <>
      <FilterBar text={modelFilter} onText={setModelFilter} provider={providerFilter} onProvider={setProviderFilter} providers={providers} matched={filtered.length} total={snapshot.models.length} onReset={resetFilter}>
        <button disabled={refreshing} onClick={() => { setRefreshing(true); void refreshDirectory().catch(error => notify('error', `刷新目录失败：${String(error)}`)).finally(() => setRefreshing(false)) }}>{refreshing ? '刷新中…' : '刷新目录'}</button>
        <button disabled={busy || probing !== '' || !filtered.length} onClick={() => void probeBatch()}>AI 探测当前筛选（{filtered.length} 个）</button>
        {probeProgress && <span className="dmm-muted">{probeProgress}</span>}
      </FilterBar>
      {filtered.length === 0 && <div className="dmm-card dmm-empty dmm-muted">没有匹配的模型。调整筛选条件，或点「清除筛选」查看全部 {snapshot.models.length} 个模型。</div>}
      {filtered.map(model => <div className="dmm-card" key={`${model.providerId}:${model.modelId}`}>
        <strong>{model.name}</strong> <span className="dmm-muted">{model.providerId} / {model.modelId}</span>
        <div className="dmm-row">原生图片：{model.nativeImage}；工具：{model.nativeTools}；上下文：{model.contextWindow ?? '未知'}；默认输出：{model.defaultMaxTokens ?? '未知'}</div>
        <div className="dmm-muted">{snapshot.verifications.filter(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId).map(item => `${item.kind}: ${item.status} / ${item.behavior ?? '未知'}${item.stale ? '（已过期）' : ''}`).join('；') || '尚无验证证据'}</div>
        <NativeEditor model={model} revision={snapshot.nativeRevision} refresh={async () => { await refreshDirectory(true) }} notify={notify} />
        <div className="dmm-row">
          <button disabled={busy || probing !== ''} onClick={() => void probeOne(model)}>{probing === `${model.providerId}:${model.modelId}` ? '探测中…' : 'AI 探测能力'}</button>
          <span className="dmm-muted">各发一次图片与工具的真实请求，按结果给出可直接写入的结论</span>
        </div>
        <div className="dmm-row"><label>插件图片声明 <select value={draft.models[JSON.stringify([model.providerId, model.modelId])]?.capability?.image ?? 'unknown'} onChange={event => edit(next => { const key = JSON.stringify([model.providerId, model.modelId]); next.models[key] ??= {}; next.models[key].capability ??= {}; next.models[key].capability!.image = event.target.value as 'yes' | 'no' | 'unknown' })}><option value="unknown">未知</option><option value="yes">支持</option><option value="no">不支持</option></select></label></div>
      </div>)}
    </>}
    {tab === '别名与推理配置' && <>
      <div className="dmm-card"><div className="dmm-row"><input placeholder="别名，如 fast" value={aliasName} onChange={event => setAliasName(event.target.value)} /><button onClick={() => { if (!/^[a-z][a-z0-9_-]*$/.test(aliasName) || draft.aliases[aliasName]) return; edit(next => { next.aliases[aliasName] = [] }); setAliasName('') }}>添加别名</button></div><p className="dmm-muted">候选按顺序尝试；每个别名至少添加一个具体模型后才能保存。</p></div>
      {aliases.map(alias => <div className="dmm-card" key={alias}><div className="dmm-row"><strong>@{alias}</strong><button onClick={() => edit(next => { delete next.aliases[alias] })}>删除</button></div>{draft.aliases[alias].map((ref, index) => <div className="dmm-row" key={index}><span>{index + 1}.</span><SelectModel value={ref} models={snapshot.models} aliases={[]} onChange={value => edit(next => { if (value && typeof value !== 'string') next.aliases[alias][index] = value })} /><button onClick={() => edit(next => { next.aliases[alias].splice(index, 1) })}>移除</button></div>)}<button onClick={() => edit(next => { if (snapshot.models[0]) next.aliases[alias].push({ providerId: snapshot.models[0].providerId, modelId: snapshot.models[0].modelId }) })}>添加候选</button></div>)}
      <div className="dmm-card"><strong>推理档位映射</strong><p className="dmm-muted">只有宿主声明的实际档位才能使用。配置按 Provider 和模型隔离。</p>{snapshot.models.filter(m => m.reasoningEfforts.length).map(model => <div className="dmm-row" key={`${model.providerId}:${model.modelId}`}><span>{model.name} · {model.providerId}</span>{(['fast', 'balanced', 'deep', 'max'] as const).map(tier => <label key={tier}>{tier}<select value={draft.models[JSON.stringify([model.providerId, model.modelId])]?.tiers?.[tier] ?? ''} onChange={event => edit(next => { const key = JSON.stringify([model.providerId, model.modelId]); next.models[key] ??= {}; next.models[key].tiers ??= {}; next.models[key].tiers![tier] = event.target.value || undefined })}><option value="">不可选</option>{model.reasoningEfforts.map(e => <option key={e.id} value={e.id}>{e.name} ({e.id})</option>)}</select></label>)}</div>)}</div>
    </>}
    {tab === 'Manual/Auto' && <>
      <div className="dmm-card"><div className="dmm-row"><label>模式 <select value={draft.mode} onChange={event => edit(next => { next.mode = event.target.value as 'manual' | 'auto' })}><option value="manual">Manual</option><option value="auto">Auto</option></select></label></div>
      {(['manual', 'auto'] as const).map(mode => <div className="dmm-row" key={mode}><strong>{mode}</strong><SelectModel value={draft[mode].target} models={snapshot.models} aliases={aliases} onChange={value => edit(next => { next[mode].target = value })} /><ThinkingSelect value={draft[mode].thinking} offAvailable={supportsOff(draft[mode].target, draft, snapshot.models)} onChange={value => edit(next => { next[mode].thinking = value; if (value === 'off') next[mode].tier = 'auto' })} /><select aria-label={`${mode} 推理档位`} value={draft[mode].tier ?? 'inherit'} onChange={event => edit(next => { next[mode].tier = event.target.value as Tier | 'inherit' })}><option value="inherit">继承上层设置</option>{tiers.map(t => <option key={t} disabled={draft[mode].thinking === 'off' && !['auto'].includes(t)}>{t}</option>)}</select><input type="number" min="1" placeholder="输出上限" value={draft[mode].maxOutputTokens ?? ''} onChange={event => edit(next => { next[mode].maxOutputTokens = event.target.value ? Number(event.target.value) : undefined })} /></div>)}
      </div><div className="dmm-card"><strong>Auto 子 Agent 角色</strong>{roles.map(role => <div className="dmm-row" key={role}><label><input type="checkbox" checked={draft.roles[role].enabled} onChange={event => edit(next => { next.roles[role].enabled = event.target.checked })} />{role}</label><SelectModel value={draft.roles[role].target} models={snapshot.models} aliases={aliases} onChange={value => edit(next => { next.roles[role].target = value })} /><ThinkingSelect value={draft.roles[role].thinking} offAvailable={supportsOff(draft.roles[role].target, draft, snapshot.models)} onChange={value => edit(next => { next.roles[role].thinking = value; if (value === 'off') next.roles[role].tier = 'auto' })} /><select value={draft.roles[role].tier ?? 'auto'} onChange={event => edit(next => { next.roles[role].tier = event.target.value as Tier })}>{tiers.map(t => <option key={t} disabled={draft.roles[role].thinking === 'off' && t !== 'auto'}>{t}</option>)}</select></div>)}</div>
    </>}
    {tab === '视觉' && <div className="dmm-card"><div className="dmm-row"><label><input type="checkbox" checked={draft.vision.enabled} onChange={event => edit(next => { next.vision.enabled = event.target.checked })} />启用视觉辅助</label></div><div className="dmm-row"><label>策略 <select value={draft.vision.policy} onChange={event => edit(next => { next.vision.policy = event.target.value as ManagerConfig['vision']['policy'] })}><option value="native-first">Native First</option><option value="sidecar-first">Sidecar First</option><option value="native-only">Native Only</option><option value="sidecar-only">Sidecar Only</option></select></label><label>视觉模型 <SelectModel value={draft.vision.target} models={snapshot.models.filter(m => m.nativeImage === 'yes')} aliases={aliases} onChange={value => edit(next => { next.vision.target = value })} /></label></div><p className="dmm-muted">文字模型使用受管理入口接收原输入框的图片，并通过看图工具查询原图。裁剪区域当前作为关注区域描述。</p></div>}
    {tab === '可靠性' && <div className="dmm-card"><div className="dmm-row"><label>最多实际尝试 <input type="number" min="1" max="3" value={draft.reliability.maxAttempts} onChange={event => edit(next => { next.reliability.maxAttempts = Number(event.target.value) })} /></label><label><input type="checkbox" checked={draft.reliability.retryTransient} onChange={event => edit(next => { next.reliability.retryTransient = event.target.checked })} />网络失败重试一次</label><label><input type="checkbox" checked={draft.reliability.parameterDowngrade} onChange={event => edit(next => { next.reliability.parameterDowngrade = event.target.checked })} />允许推理参数被拒时降级</label></div><strong>上下文溢出专用候选</strong>{(draft.reliability.longContextCandidates ?? []).map((ref, index) => <div className="dmm-row" key={index}><SelectModel value={ref} models={snapshot.models} aliases={[]} onChange={value => edit(next => { if (value && typeof value !== 'string') next.reliability.longContextCandidates![index] = value })} /><button onClick={() => edit(next => { next.reliability.longContextCandidates?.splice(index, 1) })}>移除</button></div>)}<button onClick={() => edit(next => { const candidate = snapshot.models.filter(model => model.contextWindow).sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))[0]; if (candidate) { next.reliability.longContextCandidates ??= []; next.reliability.longContextCandidates.push({ providerId: candidate.providerId, modelId: candidate.modelId }) } })}>添加长上下文候选</button><p className="dmm-muted">已有输出不会重播；认证错误跳过同 Provider，429 暂时冷却。上下文溢出仅尝试此列表；本轮明确覆盖的参数不会静默降级。</p></div>}
    {tab === '验证' && <div className="dmm-card"><FilterBar text={modelFilter} onText={setModelFilter} provider={providerFilter} onProvider={setProviderFilter} providers={providers} matched={filtered.length} total={snapshot.models.length} onReset={resetFilter} /><div className="dmm-row"><SelectModel value={verifyTarget} models={snapshot.models} aliases={[]} onChange={setVerifyTarget} /><select value={verifyKind} onChange={event => setVerifyKind(event.target.value as Verification['kind'])}><option value="text">文字</option><option value="image">图片</option><option value="tools">工具</option><option value="reasoning">推理档位</option></select><button disabled={!verifyTarget || busy} onClick={() => { if (!verifyTarget || typeof verifyTarget === 'string') return; setBusy(true); void verifyOne(verifyTarget, verifyKind).then(() => notify('success', '验证已完成（1 次模型请求）。')).catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证一次</button><button disabled={busy || filtered.length === 0} onClick={() => void verifyBatch(filtered, verifyKind)}>批量验证当前筛选（{filtered.length} 次）</button>{busy && verifyAbort.current && <button onClick={() => verifyAbort.current?.abort()}>取消批量验证</button>}{probeProgress && <span className="dmm-muted">{probeProgress}</span>}</div>{verifyResult && <pre>{JSON.stringify(verifyResult, null, 2)}</pre>}<p className="dmm-muted">批量验证默认串行且需要确认；推理档位仅验证参数是否被接受，不宣称证明内部推理强度。</p></div>}
    {tab === '日志' && <div className="dmm-card"><button onClick={() => void request('/logs').then(result => setLogs(result.events)).catch(error => notify('error', String(error)))}>刷新日志</button><pre>{logs.map(event => JSON.stringify(event)).join('\n')}</pre></div>}
    <div className="dmm-actions">
      <button className="dmm-primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? '处理中…' : '保存设置'}</button>
      <button disabled={busy} onClick={() => void reload()} title="放弃未保存的修改，重新读取已保存的配置">重新加载</button>
      {dirty ? <span className="dmm-dirty">● 有未保存的修改</span> : <span className="dmm-muted">没有未保存的修改</span>}
      <span className="dmm-muted">「保存设置」把全部标签页的插件配置写入 DSH，下一次请求生效；模型卡片里的「保存到宿主」是另一件事：写宿主 llm-pi-ai 的模型声明。</span>
    </div>
    <div className="dmm-toasts">{notices.map(item => <div key={item.id} className={`dmm-toast dmm-toast-${item.kind}`} role="status"><span>{item.text}</span><button aria-label="关闭提示" onClick={() => dismiss(item.id)}>×</button></div>)}</div>
    {preview && <div className="dmm-modal-mask" onClick={() => { if (!busy) setPreview(null) }} role="presentation">
      <div className="dmm-modal" role="dialog" aria-modal="true" aria-label={`探测建议：${preview.model.name}`} onClick={event => event.stopPropagation()}>
        <h3>探测建议：{preview.model.name}</h3>
        <p className="dmm-muted">以下是真实探测请求得出的结论，高置信项已默认勾选。勾选后点「应用选中项」：「宿主原生图片声明」立即写入宿主，「插件声明」需再点页面底部「保存设置」。</p>
        {preview.elevated && <p className="dmm-note">该模型宿主声明为「不支持」，宿主会把图片替换成文字占位，因此探测期间已临时把声明提为「支持」实测，测完已恢复原声明——此处的「支持」结论来自图片真实到达模型的实测。</p>}
        {preview.restoreFailed && <p className="dmm-note">探测后未能恢复宿主原声明，请到模型卡片核对「宿主原生图片」的当前值。</p>}
        {(preview.notes ?? []).map((note, index) => <p className="dmm-note" key={index}>{note}</p>)}
        {preview.suggestions.map((item, index) => {
          const blocked = item.field === 'hostImage' && !preview.model.nativeEditable
          return <div className="dmm-row" key={`${item.field}-${index}`}>
            <label><input type="checkbox" disabled={blocked} checked={preview.checked[index] && !blocked} onChange={event => setPreview(current => current && { ...current, checked: current.checked.map((value, at) => at === index ? event.target.checked : value) })} />{probeLabels[item.field]}：{supportLabels[currentSupport(preview.model, item.field)]} → <strong>{supportLabels[item.value]}</strong></label>
            <span className="dmm-muted">{item.confidence === 'high' ? '高置信' : '低置信'} · {item.reason}{blocked ? ` · 无法写入宿主：${preview.model.nativeEditReason ?? '该 Provider 未公开可写模型字段'}` : ''}</span>
          </div>
        })}
        <div className="dmm-row"><button className="dmm-primary" disabled={busy} onClick={() => void applyProbe()}>应用选中项</button><button disabled={busy} onClick={() => setPreview(null)}>关闭</button></div>
      </div>
    </div>}
  </div>
}

function ComposerStatus({ sessionId, modelDirectories }: { sessionId?: string; modelDirectories: ModelDirectories }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selection, setSelection] = useState<ModelRef | string>()
  const [thinking, setThinking] = useState<'inherit' | 'auto' | 'off'>('inherit')
  const [tier, setTier] = useState<Tier | 'inherit'>('inherit')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [scope, setScope] = useState<'session' | 'nextTurn'>('nextTurn')
  const [state, setState] = useState('')
  useEffect(() => {
    let active = true
    let stopDirectory: (() => void) | undefined
    let syncing = false
    let configured: ModelRef | string | undefined
    let visionEnabled = false
    const synchronize = async (directory: ModelDirectory) => {
      if (syncing || !active || !configured && !visionEnabled) return
      syncing = true
      try { await selectManaged(directory, configured, visionEnabled) }
      finally { syncing = false }
    }
    const refresh = async () => {
      const next = await request('') as Snapshot
      if (!active) return
      setSnapshot(next)
      if (!sessionId) return
      configured = next.config[next.config.mode].target
      visionEnabled = next.config.vision.enabled
      const directory = modelDirectories.directoryFor(sessionId)
      if (!stopDirectory) stopDirectory = directory.store.subscribe(() => {
        if (directory.store.getSnapshot().current?.provider !== managedProvider) void synchronize(directory).catch(error => { if (active) setState(String(error)) })
      })
      await synchronize(directory)
    }
    void refresh().catch(error => { if (active) setState(String(error)) })
    const onConfig = () => { void refresh().catch(error => { if (active) setState(String(error)) }) }
    window.addEventListener('dmm:config', onConfig)
    return () => { active = false; stopDirectory?.(); window.removeEventListener('dmm:config', onConfig) }
  }, [sessionId, modelDirectories])
  if (!snapshot) return <span className="dmm-composer">模型管理…</span>
  const aliases = Object.keys(snapshot.config.aliases)
  const save = async (clear = false) => {
    if (!sessionId) { setState('无法获取会话 ID'); return }
    try {
      await request('/overrides', { method: 'PUT', body: JSON.stringify({ sessionId, scope, ...(clear ? {} : { selection: { target: selection, thinking, tier, ...(maxOutputTokens ? { maxOutputTokens: Number(maxOutputTokens) } : {}) } }) }) })
      if (!clear) await selectManaged(modelDirectories.directoryFor(sessionId), selection ?? snapshot.config[snapshot.config.mode].target, true)
      setState(clear ? '已清除' : scope === 'nextTurn' ? '本轮覆盖已设置' : '会话覆盖已设置')
    } catch (error) { setState(String(error)) }
  }
  return <details className="dmm-composer"><summary>模型管理 · {snapshot.config.mode}{state ? ` · ${state}` : ''}</summary><div className="dmm-card"><div className="dmm-row"><SelectModel value={selection} models={snapshot.models} aliases={aliases} onChange={setSelection} /><ThinkingSelect value={thinking} offAvailable={supportsOff(selection, snapshot.config, snapshot.models)} onChange={value => { setThinking(value); if (value === 'off') setTier('auto') }} /><select aria-label="本轮推理档位" value={tier} onChange={event => setTier(event.target.value as Tier | 'inherit')}><option value="inherit">推理继承</option>{tiers.map(item => <option key={item} disabled={thinking === 'off' && item !== 'auto'}>{item}</option>)}</select><input aria-label="本轮输出上限" type="number" min="1" placeholder="输出上限" value={maxOutputTokens} onChange={event => setMaxOutputTokens(event.target.value)} /><select value={scope} onChange={event => setScope(event.target.value as 'session' | 'nextTurn')}><option value="nextTurn">本轮</option><option value="session">会话</option></select><button onClick={() => void save()}>应用</button><button onClick={() => void save(true)}>清除</button></div></div></details>
}

export function apply(ctx: { modelDirectories: ModelDirectories; slots: { inject(name: string, register: () => () => void): void; register(options: { name: string; id: string; order: number; label?: () => string; inject?: (sessionId: string) => { sessionId: string } }, component: (props: any) => React.ReactElement): () => void } }): void {
  injectStyle()
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'model-manager', order: 12, label: () => '模型管理' }, ManagerSection))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'model-manager-status', order: 60, label: () => '模型管理模式', inject: (sessionId: string) => ({ sessionId }) }, (props: { sessionId?: string }) => <ComposerStatus {...props} modelDirectories={ctx.modelDirectories} />))
}
