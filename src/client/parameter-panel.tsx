import React, { useEffect, useRef, useState } from 'react'
import type { ManagerConfig, ModelRecord, ModelRef } from '../domain.js'
import { fromManagedId } from '../domain.js'
import type { CatalogPreview, CatalogResolution } from '../catalog-types.js'
import type { ModelParameterPreview } from '../model-parameters.js'
import type { ParameterProgress } from '../parameter-analysis.js'
import { CatalogPreviewPanel, catalogRequest } from './catalog-panel.js'
import { readParameterStream } from './parameter-stream.js'

const key = (ref: ModelRef) => JSON.stringify([ref.providerId, ref.modelId])
const sources = { user: '用户显式配置', catalog: '内置目录', 'provider-default': 'Provider 默认', 'runtime-default': '宿主兜底默认', unknown: '来源未核实' }
const display = (value: unknown) => value === undefined ? '未声明／未知' : JSON.stringify(value)
export function ParameterPanel({ models, config, revision, defaultModel, backupId, manualBackupId, legacyCount, dirty, externalBusy, onBusyChange, onApplied, onCredentialSaved, notify }: {
  models: ModelRecord[]; config: ManagerConfig; revision: number; defaultModel?: ModelRef; backupId?: string; manualBackupId?: string; legacyCount: number; dirty: boolean; externalBusy: boolean
  onBusyChange: (busy: boolean) => void; onApplied: (snapshot: any) => void; onCredentialSaved: (snapshot: any) => void; notify: (kind: 'info' | 'success' | 'error', text: string) => void
}) {
  const [filter, setFilter] = useState(''), [provider, setProvider] = useState(''), [picked, setPicked] = useState<string[]>([])
  const [analyzer, setAnalyzer] = useState(''), [effort, setEffort] = useState(''), [timeout, setTimeoutValue] = useState('180')
  const [credential, setCredential] = useState(config.parameterCompletion?.searchCredentialName ?? 'WEB_SEARCH_API_KEY')
  const [view, setView] = useState<ModelParameterPreview | null>(null), [cleanup, setCleanup] = useState<CatalogPreview | null>(null)
  const [progress, setProgress] = useState<ParameterProgress | null>(null), [working, setWorking] = useState(false), [error, setError] = useState(''), [now, setNow] = useState(Date.now())
  const abort = useRef<AbortController | null>(null), epoch = useRef(0)
  const busy = working || externalBusy
  const realModels = models.filter(m => m.loaded && m.providerId !== 'dsh-model-manager')
  let realDefault = defaultModel
  if (realDefault?.providerId === 'dsh-model-manager') { try { realDefault = fromManagedId(realDefault.modelId) } catch { realDefault = undefined } }
  const effectiveAnalyzer = realModels.find(m => key(m) === (analyzer || (realDefault ? key(realDefault) : '')))
  const filtered = realModels.filter(m => (!provider || m.providerId === provider) && `${m.modelId} ${m.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const groups = [...new Set(filtered.map(m => m.providerId))]
  const invalidate = () => { epoch.current++; abort.current?.abort(); setView(null); setCleanup(null); setError('') }
  useEffect(() => { invalidate() }, [analyzer, effort, timeout, picked.join('|'), revision, models])
  useEffect(() => { setEffort('') }, [analyzer, defaultModel?.providerId, defaultModel?.modelId])
  useEffect(() => { setCredential(config.parameterCompletion?.searchCredentialName ?? 'WEB_SEARCH_API_KEY') }, [config.parameterCompletion?.searchCredentialName])
  useEffect(() => () => { epoch.current++; abort.current?.abort() }, [])
  useEffect(() => { if (!progress) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [progress])
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setWorking(true); onBusyChange(true); setError('')
    try { await action() } catch (failure) { setError(String(failure)); notify('error', String(failure)) }
    finally { setWorking(false); onBusyChange(false) }
  }
  const analyze = () => void act(async () => {
    invalidate(); const generation = epoch.current, controller = new AbortController(); abort.current = controller
    setProgress({ stage: 'searching', modelIndex: 0, modelCount: picked.length, searchCount: 0, analysisCount: 0 })
    try {
      const response = await fetch('/api/model-manager/model-parameter-preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ models: realModels.filter(m => picked.includes(key(m))).map(({ providerId, modelId }) => ({ providerId, modelId })), analyzer: effectiveAnalyzer ? { providerId: effectiveAnalyzer.providerId, modelId: effectiveAnalyzer.modelId } : null, ...(effort ? { reasoningEffort: effort } : {}), analysisTimeoutSeconds: Number(timeout) }), signal: controller.signal })
      const result = await readParameterStream(response, value => { if (epoch.current === generation && !controller.signal.aborted) setProgress(value) })
      if (controller.signal.aborted || epoch.current !== generation) return
      setView(result); notify('info', '分析完成，请逐字段核对建议与依据；应用后才修改配置。')
    } catch (failure) { if (!controller.signal.aborted) throw failure; setError('分析已取消，配置未修改。') }
    finally { if (abort.current === controller) abort.current = null; setProgress(null) }
  })
  const resolve = (selectedFields: string[], selected = view?.selected ?? [], resolutions?: CatalogResolution[]) => void act(async () => {
    if (!view?.token) return
    const choices = resolutions ?? view.operations.flatMap(o => o.choices.filter(c => c.resolution).map(c => ({ id: c.id, optionId: c.resolution! })))
    const request = { token: view.token, selected, resolutions: choices, ...(selectedFields !== view.selectedFields ? { selectedFields } : {}) }
    setView(await catalogRequest('catalog-resolve', request))
  })
  const restore = (id: string) => void act(async () => { if (dirty) return; invalidate(); const result = await catalogRequest('catalog-restore', { backupId: id }); onApplied(result.snapshot); notify('success', '已恢复本次操作；退役的插件图片声明仍不参与运行。') })
  const toggle = (keys: string[], checked: boolean) => { setPicked(current => checked ? [...new Set([...current, ...keys])] : current.filter(k => !keys.includes(k))) }
  return <div className="dmm-card" id="dmm-parameter-completion">
    <strong>智能补全参数</strong>
    <p className="dmm-muted">搜索平台官方资料，逐字段核对原生图片、上下文、最大输出、推理档位及协议兼容参数；资料不足时知识建议明确标注。分析会产生搜索与 LLM 用量。</p>
    <div className="dmm-row"><label>搜索凭据引用 <input disabled={busy} value={credential} onChange={e => setCredential(e.target.value)} /></label><button disabled={busy || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credential)} onClick={() => void act(async () => { invalidate(); const result = await catalogRequest('parameter-search-credential', { revision, name: credential }); onCredentialSaved(result.snapshot); notify('success', '已保存搜索凭据引用，其他草稿保留。') })}>保存搜索引用</button><span className="dmm-muted">在 DSH 凭据中配置 Agent Plan 专属 Key；这里只填引用名。</span></div>
    <div className="dmm-row"><label>模型 ID／名称 <input value={filter} disabled={busy} onChange={e => setFilter(e.target.value)} /></label><label>Provider <select value={provider} disabled={busy} onChange={e => setProvider(e.target.value)}><option value="">全部 Provider</option>{[...new Set(realModels.map(m => m.providerId))].map(p => <option key={p}>{p}</option>)}</select></label><button disabled={busy} onClick={() => toggle(filtered.map(key), true)}>全选筛选结果</button><button disabled={busy} onClick={() => setPicked([])}>清空选择</button><span>已选 {picked.length} 个</span></div>
    {groups.map(p => <details key={p}><summary>{p} · {filtered.filter(m => m.providerId === p).length} 个</summary><label><input type="checkbox" disabled={busy} checked={filtered.filter(m => m.providerId === p).every(m => picked.includes(key(m)))} onChange={e => toggle(filtered.filter(m => m.providerId === p).map(key), e.target.checked)} />选择本组</label>{filtered.filter(m => m.providerId === p).map(m => <div key={key(m)}><label><input type="checkbox" disabled={busy} checked={picked.includes(key(m))} onChange={e => toggle([key(m)], e.target.checked)} />{m.name} <span className="dmm-muted">{m.modelId}</span></label></div>)}</details>)}
    <div className="dmm-row"><label>本次分析模型 <select disabled={busy} value={analyzer} onChange={e => setAnalyzer(e.target.value)}><option value="">宿主默认：{effectiveAnalyzer?.name ?? '未设置真实模型'}</option>{realModels.map(m => <option key={key(m)} value={key(m)}>{m.name} · {m.providerId}</option>)}</select></label><label>本次推理档位 <select disabled={busy} value={effort} onChange={e => setEffort(e.target.value)}><option value="">模型默认</option>{effectiveAnalyzer?.reasoningEfforts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>每轮分析时限（秒）<input type="number" min="30" max="600" step="1" disabled={busy} value={timeout} onChange={e => setTimeoutValue(e.target.value)} /></label></div>
    <div className="dmm-row"><button className="dmm-primary" disabled={busy || !picked.length || picked.length > 100 || !effectiveAnalyzer || !Number.isInteger(Number(timeout)) || Number(timeout) < 30 || Number(timeout) > 600} onClick={analyze}>分析选中模型</button>{abort.current && <button onClick={() => { epoch.current++; abort.current?.abort(); setView(null) }}>取消分析</button>}{backupId && <button disabled={busy || dirty} onClick={() => restore(backupId)}>恢复最近参数修改</button>}</div>
    {picked.length > 100 && <p className="dmm-error">每批最多 100 个模型，请缩小选择范围。</p>}
    {progress && <p role="status">{({ searching: '搜索官方资料', reading: '读取正文', analyzing: '分析参数', planning: '构建预览' })[progress.stage]}：{progress.modelIndex}/{progress.modelCount} · {progress.model?.modelId} · 搜索 {progress.searchCount} 次、分析 {progress.analysisCount} 次{progress.stage === 'analyzing' && progress.analysisStartedAt ? ` · 第 ${progress.round} 轮 ${Math.max(0, Math.floor((now - Date.parse(progress.analysisStartedAt)) / 1000))}/${progress.analysisTimeoutSeconds} 秒` : ''}</p>}
    {error && <p role="alert" className="dmm-error">{error}</p>}
    {view && <>
      {view.parameterAnalysis.results.map(result => <div className="dmm-card" key={key(result.model)}><strong>{result.model.modelId} · {result.model.providerId}</strong><p>{({ ready: '有待核对建议', 'no-change': '没有需要修改的已知字段', failed: '分析失败，本模型无修改', unsupported: '该平台未适配可写字段' })[result.status]}</p>{result.notes.map((note, i) => <p className="dmm-muted" key={i}>{note}</p>)}
        {result.suggestions.map(s => <div className="dmm-card" key={s.id}><label><input type="checkbox" disabled={busy || !view.token || !s.writable || s.value === undefined || JSON.stringify(s.currentValue) === JSON.stringify(s.value)} checked={view.selectedFields.includes(s.id)} onChange={e => resolve(e.target.checked ? [...view.selectedFields, s.id] : view.selectedFields.filter(id => id !== s.id))} /><strong>{s.label ?? s.field.join('.')}</strong> · {({ official: '官方原文', knowledge: '知识建议（未验证）', unknown: '未知，不修改' })[s.basis]}</label><p>当前：{display(s.currentValue)}（{sources[s.currentSource]}） → 建议：{display(s.value)}</p><p className="dmm-muted">{s.reason}{s.effect ? ` · 修改效果：${s.effect}` : ''}{s.blockedReason ? ` · 不可写：${s.blockedReason}` : ''}</p>{s.evidence.map((e, i) => <details key={i}><summary><a href={e.source} target="_blank" rel="noreferrer">官方证据 {new URL(e.source).hostname}</a></summary><blockquote>{e.quote}</blockquote></details>)}</div>)}
      </div>)}
      {!!view.operations.length && <CatalogPreviewPanel view={view} selected={view.selected} busy={busy} onResolve={(selected, resolutions) => resolve(view.selectedFields, selected, resolutions)} />}
      {dirty && view.writesPlugin && <p className="dmm-dirty">本次包含名称来源或引用修改，请先保存或放弃其他草稿，再重新分析。</p>}
      <button className="dmm-primary" disabled={busy || !view.token || !view.selected.length || dirty && view.writesPlugin || view.operations.some(o => view.selected.includes(o.id) && o.blockedReasons.length)} onClick={() => void act(async () => { const result = await catalogRequest('catalog-apply', { token: view.token, selected: view.selected }); invalidate(); onApplied(result.snapshot); notify('success', '已应用选中参数并刷新目录，可恢复本次操作。') })}>应用选中参数</button>
    </>}
    {legacyCount > 0 && <div className="dmm-card"><strong>旧插件图片声明已停用</strong><p className="dmm-muted">检测到 {legacyCount} 项旧声明，图片能力统一采用宿主原生目录。清理会备份原值，不改变原生图片参数。</p><button disabled={busy || dirty} onClick={() => void act(async () => { invalidate(); setCleanup(await catalogRequest('catalog-preview', { operations: [{ kind: 'clearLegacyImageOverrides' }] })) })}>预览清理旧图片声明</button>{manualBackupId && <button disabled={busy || dirty} onClick={() => restore(manualBackupId)}>恢复最近目录操作</button>}{dirty && <p className="dmm-dirty">请先保存或放弃其他草稿，再预览清理。</p>}</div>}
    {cleanup && <><CatalogPreviewPanel view={cleanup} selected={cleanup.selected} busy={busy || dirty} onResolve={(selected, resolutions) => void act(async () => setCleanup(await catalogRequest('catalog-resolve', { token: cleanup.token, selected, resolutions })))} /><button disabled={busy || dirty || !cleanup.selected.length} onClick={() => void act(async () => { const result = await catalogRequest('catalog-apply', { token: cleanup.token, selected: cleanup.selected }); invalidate(); onApplied(result.snapshot); notify('success', '已清理旧图片声明，可恢复最近目录操作。') })}>应用旧图片声明清理</button><button disabled={busy} onClick={() => setCleanup(null)}>取消清理</button></>}
  </div>
}
