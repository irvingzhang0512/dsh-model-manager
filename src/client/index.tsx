import React, { useEffect, useRef, useState } from 'react'
import type { ManagerConfig, ModelRecord, ModelRef, Role, Tier, Verification } from '../domain.js'

export const inject = ['slots']
type Snapshot = { revision: number; nativeRevision?: number; config: ManagerConfig; models: ModelRecord[]; verifications: (Verification & { stale: boolean })[] }
type Tab = '模型' | '别名与推理配置' | 'Manual/Auto' | '视觉' | '可靠性' | '验证' | '日志'
const tabs: Tab[] = ['模型', '别名与推理配置', 'Manual/Auto', '视觉', '可靠性', '验证', '日志']
const roles: Role[] = ['main', 'search', 'coding', 'review', 'strong', 'vision']
const tiers: Tier[] = ['auto', 'fast', 'balanced', 'deep', 'max']

const style = `
.dmm-root{padding:20px;max-width:1100px;color:var(--dsw-alias-text-primary,#222)}
.dmm-root h2{margin:0 0 6px;font-size:20px}.dmm-muted{color:var(--dsw-alias-text-secondary,#666);font-size:12px}
.dmm-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0}.dmm-tabs button,.dmm-root button,.dmm-composer{font:inherit}
.dmm-tabs button,.dmm-root button{border:1px solid var(--dsw-alias-border-primary,#ccc);border-radius:7px;background:var(--dsw-alias-fill-surface,#fff);color:inherit;padding:6px 10px;cursor:pointer}
.dmm-tabs button[aria-selected=true],.dmm-root button.dmm-primary{background:var(--dsw-alias-brand-primary,#356dde);color:#fff;border-color:transparent}
.dmm-card{border:1px solid var(--dsw-alias-border-primary,#ddd);border-radius:10px;padding:14px;margin:10px 0;background:var(--dsw-alias-fill-surface,#fff)}
.dmm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.dmm-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0}
.dmm-root input,.dmm-root select,.dmm-root textarea{font:inherit;background:var(--dsw-alias-fill-canvas,#fff);color:inherit;border:1px solid var(--dsw-alias-border-primary,#bbb);border-radius:6px;padding:6px;min-width:110px}
.dmm-root textarea{width:100%;min-height:100px}.dmm-root label{font-size:13px}.dmm-error{color:#b42318}.dmm-composer{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px}
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

function NativeEditor({ model, revision, refresh, report }: { model: ModelRecord; revision?: number; refresh: () => Promise<void>; report: (message: string) => void }) {
  const [image, setImage] = useState(model.nativeImage)
  const [context, setContext] = useState(model.contextWindow?.toString() ?? '')
  const [output, setOutput] = useState(model.defaultMaxTokens?.toString() ?? '')
  const [busy, setBusy] = useState(false)
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
      report('宿主模型字段已保存，下一次请求使用更新后的声明。')
    } catch (error) { report(String(error)) }
    finally { setBusy(false) }
  }
  return <div className="dmm-row"><label>宿主原生图片 <select disabled={!model.nativeEditable} value={image} onChange={event => setImage(event.target.value as ModelRecord['nativeImage'])}><option value="unknown">未知</option><option value="yes">支持</option><option value="no">不支持</option></select></label><label>上下文容量 <input disabled={!model.nativeEditable} type="number" min="1" value={context} onChange={event => setContext(event.target.value)} /></label><label>模型最大输出 <input disabled={!model.nativeEditable} type="number" min="1" value={output} onChange={event => setOutput(event.target.value)} /></label><button disabled={busy || revision === undefined || !model.nativeEditable} onClick={() => void save()}>保存到宿主</button>{!model.nativeEditable && <span className="dmm-muted">{model.nativeEditReason}</span>}</div>
}

function ManagerSection() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<ManagerConfig | null>(null)
  const [tab, setTab] = useState<Tab>('模型')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [aliasName, setAliasName] = useState('')
  const [verifyTarget, setVerifyTarget] = useState<ModelRef | string>()
  const [verifyKind, setVerifyKind] = useState<Verification['kind']>('text')
  const [verifyResult, setVerifyResult] = useState<Verification | null>(null)
  const [logs, setLogs] = useState<Record<string, unknown>[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const verifyAbort = useRef<AbortController | null>(null)

  const load = async () => { const next = await request('') as Snapshot; setSnapshot(next); setDraft(structuredClone(next.config)); setMessage('') }
  useEffect(() => { void load().catch(error => setMessage(String(error))) }, [])
  const edit = (fn: (next: ManagerConfig) => void) => { if (!draft) return; const next = structuredClone(draft); fn(next); setDraft(next) }
  const save = async () => {
    if (!snapshot || !draft) return
    setBusy(true)
    try { const next = await request('', { method: 'PUT', body: JSON.stringify({ revision: snapshot.revision, config: draft }) }) as Snapshot; setSnapshot(next); setDraft(structuredClone(next.config)); setMessage('已保存，后续请求使用新配置。') }
    catch (error) { setMessage(`${String(error)}。若配置冲突，请重新加载。`) }
    finally { setBusy(false) }
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
        setMessage(`已验证 ${completed}/${models.length} 个模型`)
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(String(error)) }
    finally { setMessage(`批量验证结束：${completed}/${models.length} 次请求${controller.signal.aborted ? '，已取消' : ''}`); setBusy(false); verifyAbort.current = null }
  }
  if (!draft || !snapshot) return <div className="dmm-root">{message || '正在加载模型管理…'}</div>
  const aliases = Object.keys(draft.aliases)
  const filtered = snapshot.models.filter(model => `${model.providerId} ${model.modelId} ${model.name}`.toLowerCase().includes(modelFilter.toLowerCase()))
  return <div className="dmm-root">
    <h2>模型管理</h2><div className="dmm-muted">管理模型声明、别名、角色和视觉辅助。原有附件上传与发送流程保持不变。目录只代表宿主已加载的模型；外部导入若尚未被宿主加载，需要先刷新宿主。</div>
    <div className="dmm-tabs">{tabs.map(item => <button key={item} aria-selected={tab === item} onClick={() => { setTab(item); if (item === '日志') void request('/logs').then(result => setLogs(result.events)).catch(error => setMessage(String(error))) }}>{item}</button>)}</div>
    {tab === '模型' && <>
      <div className="dmm-row"><input placeholder="筛选 Provider 或模型" value={modelFilter} onChange={event => setModelFilter(event.target.value)} /><button onClick={() => void request('/refresh', { method: 'POST' }).then((next: Snapshot) => { setSnapshot(next); setMessage(`目录已刷新：宿主加载 ${next.models.length} 个模型。`) }).catch(error => setMessage(String(error)))}>刷新目录</button></div>
      {filtered.map(model => <div className="dmm-card" key={`${model.providerId}:${model.modelId}`}>
        <strong>{model.name}</strong> <span className="dmm-muted">{model.providerId} / {model.modelId}</span>
        <div className="dmm-row">原生图片：{model.nativeImage}；工具：{model.nativeTools}；上下文：{model.contextWindow ?? '未知'}；默认输出：{model.defaultMaxTokens ?? '未知'}</div>
        <div className="dmm-muted">{snapshot.verifications.filter(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId).map(item => `${item.kind}: ${item.status} / ${item.behavior ?? '未知'}${item.stale ? '（已过期）' : ''}`).join('；') || '尚无验证证据'}</div>
        <NativeEditor model={model} revision={snapshot.nativeRevision} refresh={load} report={setMessage} />
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
    {tab === '验证' && <div className="dmm-card"><div className="dmm-row"><input placeholder="筛选批量验证模型" value={modelFilter} onChange={event => setModelFilter(event.target.value)} /><SelectModel value={verifyTarget} models={snapshot.models} aliases={[]} onChange={setVerifyTarget} /><select value={verifyKind} onChange={event => setVerifyKind(event.target.value as Verification['kind'])}><option value="text">文字</option><option value="image">图片</option><option value="tools">工具</option><option value="reasoning">推理档位</option></select><button disabled={!verifyTarget || busy} onClick={() => { if (!verifyTarget || typeof verifyTarget === 'string') return; setBusy(true); void verifyOne(verifyTarget, verifyKind).then(() => setMessage('验证已完成（1 次模型请求）。')).catch(error => setMessage(String(error))).finally(() => setBusy(false)) }}>验证一次</button><button disabled={busy || filtered.length === 0} onClick={() => void verifyBatch(filtered, verifyKind)}>批量验证当前筛选（{filtered.length} 次）</button>{busy && verifyAbort.current && <button onClick={() => verifyAbort.current?.abort()}>取消批量验证</button>}</div>{verifyResult && <pre>{JSON.stringify(verifyResult, null, 2)}</pre>}<p className="dmm-muted">批量验证默认串行且需要确认；推理档位仅验证参数是否被接受，不宣称证明内部推理强度。</p></div>}
    {tab === '日志' && <div className="dmm-card"><button onClick={() => void request('/logs').then(result => setLogs(result.events)).catch(error => setMessage(String(error)))}>刷新日志</button><pre>{logs.map(event => JSON.stringify(event)).join('\n')}</pre></div>}
    <div className="dmm-row"><button className="dmm-primary" disabled={busy} onClick={() => void save()}>{busy ? '处理中…' : '保存设置'}</button><button onClick={() => void load().catch(error => setMessage(String(error)))}>重新加载</button><span className={message.includes('冲突') ? 'dmm-error' : 'dmm-muted'}>{message}</span></div>
  </div>
}

function ComposerStatus({ sessionId }: { sessionId?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selection, setSelection] = useState<ModelRef | string>()
  const [thinking, setThinking] = useState<'inherit' | 'auto' | 'off'>('inherit')
  const [tier, setTier] = useState<Tier | 'inherit'>('inherit')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [scope, setScope] = useState<'session' | 'nextTurn'>('nextTurn')
  const [state, setState] = useState('')
  useEffect(() => { void request('').then((next: Snapshot) => setSnapshot(next)).catch(() => {}) }, [])
  if (!snapshot) return <span className="dmm-composer">模型管理…</span>
  const aliases = Object.keys(snapshot.config.aliases)
  const save = async (clear = false) => {
    if (!sessionId) { setState('无法获取会话 ID'); return }
    try {
      await request('/overrides', { method: 'PUT', body: JSON.stringify({ sessionId, scope, ...(clear ? {} : { selection: { target: selection, thinking, tier, ...(maxOutputTokens ? { maxOutputTokens: Number(maxOutputTokens) } : {}) } }) }) })
      setState(clear ? '已清除' : scope === 'nextTurn' ? '本轮覆盖已设置' : '会话覆盖已设置')
    } catch (error) { setState(String(error)) }
  }
  return <details className="dmm-composer"><summary>模型管理 · {snapshot.config.mode}{state ? ` · ${state}` : ''}</summary><div className="dmm-card"><div className="dmm-row"><SelectModel value={selection} models={snapshot.models} aliases={aliases} onChange={setSelection} /><ThinkingSelect value={thinking} offAvailable={supportsOff(selection, snapshot.config, snapshot.models)} onChange={value => { setThinking(value); if (value === 'off') setTier('auto') }} /><select aria-label="本轮推理档位" value={tier} onChange={event => setTier(event.target.value as Tier | 'inherit')}><option value="inherit">推理继承</option>{tiers.map(item => <option key={item} disabled={thinking === 'off' && item !== 'auto'}>{item}</option>)}</select><input aria-label="本轮输出上限" type="number" min="1" placeholder="输出上限" value={maxOutputTokens} onChange={event => setMaxOutputTokens(event.target.value)} /><select value={scope} onChange={event => setScope(event.target.value as 'session' | 'nextTurn')}><option value="nextTurn">本轮</option><option value="session">会话</option></select><button onClick={() => void save()}>应用</button><button onClick={() => void save(true)}>清除</button></div></div></details>
}

export function apply(ctx: { slots: { inject(name: string, register: () => () => void): void; register(options: { name: string; id: string; order: number; label?: () => string; inject?: (sessionId: string) => { sessionId: string } }, component: (props: any) => React.ReactElement): () => void } }): void {
  injectStyle()
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'model-manager', order: 12, label: () => '模型管理' }, ManagerSection))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'model-manager-status', order: 60, label: () => '模型管理模式', inject: (sessionId: string) => ({ sessionId }) }, ComposerStatus))
}
