import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AutoTab, SubagentsTab } from './auto-tabs.js'
import type { AliasReliability, ManagerConfig, ModelRecord, ModelRef, ProbeField, ProbeSuggestion, Verification } from '../domain.js'

export const inject = ['slots']
type Snapshot = { revision: number; nativeRevision?: number; config: ManagerConfig; models: ModelRecord[]; verifications: (Verification & { stale: boolean })[] }
type Tab = '模型' | '别名与兜底' | 'AUTO 自动选模型' | '子 Agent' | '视觉' | '日志'
const tabs: Tab[] = ['模型', '别名与兜底', 'AUTO 自动选模型', '子 Agent', '视觉', '日志']
type OfficialPreview = { token: string; sources: { models: string; thinking: string; updates: string }; fetchedAt: string; diffs: { id: string; field: string; before: unknown; after: unknown; source: string; reason: string }[]; notes: string[] }
const probeLabels: Record<ProbeField, string> = { hostImage: '宿主原生图片声明', pluginImage: '插件图片声明' }
type Notice = { id: number; kind: 'info' | 'success' | 'error'; text: string }
type ProbeResponse = { verifications: Verification[]; suggestions: ProbeSuggestion[]; cancelled?: boolean; elevated?: boolean; restoreFailed?: boolean; notes?: string[]; nativeRevision?: number }
/** 探测/验证结果弹出框：有建议时渲染勾选列表，无建议/失败/批量总结时渲染证据与说明。 */
type ProbeDialog = {
  title: string
  model?: ModelRecord
  suggestions: ProbeSuggestion[]
  checked: boolean[]
  elevated?: boolean
  restoreFailed?: boolean
  notes?: string[]
  verifications?: Verification[]
  failure?: string
  applied?: { hostApplied: number; pluginCount: number; skipped: number }
}
type Support = 'yes' | 'no' | 'unknown'
const supportLabels: Record<Support, string> = { yes: '支持', no: '不支持', unknown: '未知' }
/** 归一化所有快照响应：models/verifications 缺失兜底为空数组，避免渲染时 TypeError 白屏；config 缺失说明服务端异常，抛错走失败路径。 */
function asSnapshot(value: any): Snapshot {
  if (!value?.config) throw new Error('模型管理响应不完整，请重试或重启 DSH')
  return { ...value,
    models: Array.isArray(value?.models) ? value.models : [],
    verifications: Array.isArray(value?.verifications) ? value.verifications : [] }
}

const style = `
.dmm-root{padding:20px;max-width:1100px;color:var(--dsw-alias-text-primary,#222)}
.dmm-root h2{margin:0 0 6px;font-size:20px}.dmm-muted{color:var(--dsw-alias-text-secondary,#666);font-size:12px}
.dmm-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0}.dmm-tabs button,.dmm-root button,.dmm-composer{font:inherit}
.dmm-tabs button,.dmm-root button{border:1px solid var(--dsw-alias-border-primary,#ccc);border-radius:7px;background:var(--dsw-alias-fill-surface,#fff);color:inherit;padding:6px 10px;cursor:pointer}
.dmm-tabs button[aria-selected=true],.dmm-root button.dmm-primary{background:var(--dsw-alias-brand-primary,#356dde);color:#fff;border-color:transparent}
.dmm-root button:disabled{cursor:not-allowed;opacity:.5}
.dmm-card{border:1px solid var(--dsw-alias-border-primary,#ddd);border-radius:10px;padding:14px;margin:10px 0;background:var(--dsw-alias-fill-surface,#fff)}
.dmm-group{border:1px solid var(--dsw-alias-border-primary,#ddd);border-radius:10px;margin:10px 0;background:var(--dsw-alias-fill-surface,#fff)}
.dmm-group-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 14px;cursor:pointer;user-select:none}
.dmm-group-body{border-top:1px solid var(--dsw-alias-border-primary,#eee);padding:4px 14px 10px}
.dmm-badge{font-size:12px;border-radius:6px;padding:2px 7px;background:var(--dsw-alias-fill-canvas,#f0f2f5)}
.dmm-badge-warn{color:#b42318;background:rgba(180,35,24,.08)}
.dmm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.dmm-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0}
.dmm-root input:not([type=checkbox]),.dmm-root select,.dmm-root textarea{font:inherit;background:var(--dsw-alias-fill-canvas,#fff);color:inherit;border:1px solid var(--dsw-alias-border-primary,#bbb);border-radius:6px;padding:6px;min-width:110px}
.dmm-root input[type=checkbox]{width:16px;height:16px;margin:0 6px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-brand-primary,#356dde)}
.dmm-switch-row{display:flex;align-items:center;justify-content:space-between;gap:14px}.dmm-switch-row strong{display:block}.dmm-switch-row input{flex:none}.dmm-log-row{border-bottom:1px solid var(--dsw-alias-border-primary,#ddd);padding:8px 0}.dmm-log-row:last-child{border-bottom:0}
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
.dmm-steps{margin:6px 0;padding-left:20px;list-style:disc}.dmm-steps li{margin:5px 0;font-size:13px;line-height:1.65}
.dmm-hint{border-left:3px solid var(--dsw-alias-brand-primary,#356dde);background:var(--dsw-alias-fill-canvas,#f6f7f9);border-radius:0 8px 8px 0;padding:8px 12px;margin:8px 0;font-size:12px;color:var(--dsw-alias-text-secondary,#555);line-height:1.7}
.dmm-composer summary{cursor:pointer;user-select:none}
.dmm-popcard{padding:10px 12px;box-shadow:0 10px 28px rgba(0,0,0,.14)}
.dmm-guide{background:var(--dsw-alias-fill-canvas,#f7f8fa);border:1px solid var(--dsw-alias-border-primary,#e3e6eb);border-radius:10px;padding:12px 14px;margin:10px 0}
.dmm-guide>strong{display:block;font-size:14px;margin-bottom:6px}
.dmm-guide p{margin:6px 0;font-size:13px;line-height:1.7}
.dmm-guide .dmm-steps{margin:6px 0 2px}
.dmm-guide summary{cursor:pointer;user-select:none;font-weight:600;font-size:14px;list-style:revert}
.dmm-guide[open]>summary{margin-bottom:6px}
.dmm-root pre{white-space:pre-wrap;word-break:break-all;max-height:420px;overflow:auto}
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
function EffortSelect({ target, value, models, aliases, onChange }: { target?: ModelRef | string; value?: string; models: ModelRecord[]; aliases: ManagerConfig['aliases']; onChange: (value?: string) => void }) {
  const refs = typeof target === 'string' ? aliases[target.slice(1)]?.candidates ?? [] : target ? [target] : []
  const selected = refs.map(ref => models.find(model => model.providerId === ref.providerId && model.modelId === ref.modelId)).filter((model): model is ModelRecord => !!model)
  const efforts = selected.length ? selected[0].reasoningEfforts.filter(e => selected.every(model => model.reasoningEfforts.some(item => item.id === e.id))) : []
  return <select aria-label="推理档位" value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">使用模型默认</option>{efforts.map(e => <option key={e.id} value={e.id}>{e.id === 'off' ? '关闭思考' : e.name}（{e.id}）</option>)}
  </select>
}
function SelectModel({ value, models, aliases, disabled, onChange }: { value?: ModelRef | string; models: ModelRecord[]; aliases: string[]; disabled?: boolean; onChange: (next?: ModelRef | string) => void }) {
  return <select disabled={disabled} value={refValue(value)} onChange={event => onChange(parseRef(event.target.value))}>
    <option value="">未设置</option>
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

/** 各视觉策略的一句话取舍说明，随下拉框选中项动态展示。 */
const policyHelp: Record<ManagerConfig['vision']['policy'], string> = {
  'native-first': '当前模型支持看图：图片直接发给它本人，不绕道、不产生额外调用；不支持：自动改用看图工具请视觉模型代看；两边都没有：带图片的请求会报错。日常推荐，能力强就少绕路，不够也有兜底。',
  'sidecar-first': '只要下方配置了视觉模型，哪怕当前模型自己能看图，也一律由视觉模型代看、只把文字结论交给对话模型；未配置视觉模型时退回直接看图。适合想让看图统一走固定便宜模型的场景。',
  'native-only': '只允许当前模型直接看图，绝不调用视觉模型。当前模型不支持图片时，带图片的请求直接报错。',
  'sidecar-only': '所有图片一律经看图工具由视觉模型代看；必须配置视觉模型，否则带图片的请求直接报错。',
}

function VisionSection({ draft, models, aliases, edit }: { draft: ManagerConfig; models: ModelRecord[]; aliases: string[]; edit: (fn: (next: ManagerConfig) => void) => void }) {
  return <>
    <details className="dmm-guide">
      <summary>视觉辅助是做什么的？（点开查看说明）</summary>
      <p className="dmm-muted" style={{ margin: '6px 0' }}>你把图片粘贴或拖入输入框发送后，图片需要随消息交给当前对话模型。DSH 默认不加工图片：模型声明「支持图片」就发原图；声明「不支持」则图片到不了模型——它只能看到一行占位文字，或直接收到报错。</p>
      <p style={{ margin: '6px 0', fontSize: 13 }}>开启「视觉辅助」后，插件在每次请求发出前接管图片路由：</p>
      <ul className="dmm-steps">
        <li><strong>当前模型自己支持看图</strong>：图片原样随消息发给它，效果最直接，也不产生额外调用。</li>
        <li><strong>当前模型不支持看图</strong>：消息里的图片被替换成文字占位，模型改用 model_manager_inspect_image 工具看图——插件把原图发给下方配置的「视觉模型」，再把视觉模型的文字结论交回对话模型。</li>
      </ul>
      <p className="dmm-muted">附件上传与发送流程保持不变；历史消息里的旧图片不会反复重看，只有本轮新发的图片才触发看图。关闭开关立即恢复 DSH 默认行为。</p>
    </details>
    <div className="dmm-card">
      <div className="dmm-switch-row"><div><strong>视觉辅助</strong><span className="dmm-muted">当前模型看不了图时，交给辅助模型理解图片。</span></div><label aria-label="启用视觉辅助"><input type="checkbox" checked={draft.vision.enabled} onChange={event => edit(next => { next.vision.enabled = event.target.checked })} />{draft.vision.enabled ? '已开启' : '已关闭'}</label></div>
      {draft.vision.enabled && <>
      <div className="dmm-row"><label>策略 <select value={draft.vision.policy} onChange={event => edit(next => { next.vision.policy = event.target.value as ManagerConfig['vision']['policy'] })}><option value="native-first">原生优先（推荐）</option><option value="sidecar-first">看图工具优先</option><option value="native-only">仅原生直读</option><option value="sidecar-only">仅看图工具</option></select></label><span className="dmm-muted">决定「当前模型直接看图」与「交给视觉模型代看」如何取舍。</span></div>
      <div className="dmm-hint">{policyHelp[draft.vision.policy]}</div>
      <div className="dmm-row"><label>视觉模型 <SelectModel value={draft.vision.target} models={models.filter(m => m.nativeImage === 'yes')} aliases={aliases} onChange={value => edit(next => { next.vision.target = value })} /></label></div>
      <details className="dmm-guide"><summary>何时使用辅助模型？</summary><p>当前模型不能直接看图时，辅助模型先理解图片，再把文字结果交给当前模型。未选择辅助模型且当前模型不支持图片时，请求会报错。</p></details>
      </>}
    </div>
    <div className="dmm-guide">
      <strong>看图工具的工作方式</strong>
      <ul className="dmm-steps">
        <li>对话模型收到的不是原图，而是形如「[图片附件 ID] 请使用 model_manager_inspect_image 工具查看此原图」的文字占位，由它决定何时、带着什么问题去看图。</li>
        <li>模型看图时可以附带裁剪区域（x,y,width,height，取值 0–1），插件只把这一块裁剪图发给视觉模型，方便放大看局部细节；不带区域就看整张原图。</li>
        <li>相同图片、相同问题、相同区域的看图结果会被缓存，重复追问不重复消耗视觉模型用量。</li>
      </ul>
    </div>
  </>
}

function TierMapping({ name, models, draft, edit }: { name: string; models: ModelRecord[]; draft: ManagerConfig; edit: (fn: (next: ManagerConfig) => void) => void }) {
  if (!models.length) return null
  return <div><strong>候选模型推理档位</strong><p className="dmm-muted">每个候选只显示它自己支持的档位；留空使用模型默认。</p>
    {models.map(model => {
      const key = JSON.stringify([model.providerId, model.modelId])
      return <div className="dmm-row" key={key}><span>{model.name} · {model.providerId}</span>
        <select value={draft.aliases[name].efforts?.[key] ?? ''} onChange={event => edit(next => { next.aliases[name].efforts ??= {}; if (event.target.value) next.aliases[name].efforts![key] = event.target.value; else delete next.aliases[name].efforts![key] })}>
          <option value="">使用模型默认</option>{model.reasoningEfforts.map(e => <option key={e.id} value={e.id}>{e.id === 'off' ? '关闭思考' : e.name}（{e.id}）</option>)}
        </select>
      </div>
    })}</div>
}

/** 别名卡：候选顺序兜底 + 可选的别名级兜底覆盖 + 候选模型的档位映射。 */
function AliasCard({ name, draft, models, edit, notify, removeAlias }: {
  name: string; draft: ManagerConfig; models: ModelRecord[]; edit: (fn: (next: ManagerConfig) => void) => void
  notify: (kind: Notice['kind'], text: string) => void; removeAlias: (name: string) => void
}) {
  const alias = draft.aliases[name]
  if (!alias) return null
  const candidates = alias.candidates ?? []
  const isLongContext = name === 'long-context'
  const rel = alias.reliability ?? {}
  const setRel = (fn: (next: AliasReliability) => void) => edit(next => {
    const target = next.aliases[name] ?? { candidates: [] }
    const value: AliasReliability = { ...(target.reliability ?? {}) }
    fn(value)
    for (const key of ['maxAttempts', 'retryTransient', 'parameterDowngrade'] as const) if (value[key] === undefined) delete value[key]
    target.reliability = Object.keys(value).length ? value : undefined
  })
  const referenced = [...new Map(candidates.map(ref => [JSON.stringify([ref.providerId, ref.modelId]), models.find(model => model.providerId === ref.providerId && model.modelId === ref.modelId)] as const).values()).values()].filter((item): item is ModelRecord => !!item)
  return <div className="dmm-card">
    <div className="dmm-row">
      <strong>@{name}</strong>
      {isLongContext && <span className="dmm-badge">内置：上下文溢出兜底</span>}
      <button onClick={() => removeAlias(name)}>删除</button>
    </div>
    {isLongContext && <p className="dmm-muted">请求报「上下文溢出」时改用这里的候选重试，平时不参与；删除后溢出将直接失败。修改候选顺序与普通别名相同。</p>}
    {candidates.map((ref, index) => <div className="dmm-row" key={index}>
      <span>{index + 1}.</span>
      <SelectModel value={ref} models={models} aliases={[]} onChange={value => edit(next => { if (value && typeof value !== 'string') next.aliases[name].candidates[index] = value })} />
      <button onClick={() => edit(next => { next.aliases[name].candidates.splice(index, 1) })}>移除</button>
    </div>)}
    <button onClick={() => edit(next => { if (models[0]) next.aliases[name].candidates.push({ providerId: models[0].providerId, modelId: models[0].modelId }) })}>添加候选</button>
    {!candidates.length && <p className="dmm-note">每个别名至少要有一个具体模型才能保存。</p>}
    <div className="dmm-row">
      <label>最多尝试 <input type="number" min="1" max="3" placeholder="全局默认" value={rel.maxAttempts ?? ''} onChange={event => setRel(next => { next.maxAttempts = event.target.value ? Number(event.target.value) : undefined })} /></label>
      <label>网络失败重试 <select value={rel.retryTransient === undefined ? '' : String(rel.retryTransient)} onChange={event => setRel(next => { next.retryTransient = event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">跟随全局</option><option value="true">开</option><option value="false">关</option></select></label>
      <label>参数降级 <select value={rel.parameterDowngrade === undefined ? '' : String(rel.parameterDowngrade)} onChange={event => setRel(next => { next.parameterDowngrade = event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">跟随全局</option><option value="true">允许</option><option value="false">不允许</option></select></label>
    </div>
    <TierMapping name={name} models={referenced} draft={draft} edit={edit} />
    {!referenced.some(model => model.reasoningEfforts.length) && <p className="dmm-muted">候选模型都没有公开推理档位，无需映射。</p>}
  </div>
}

function ManagerSection() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<ManagerConfig | null>(null)
  const [tab, setTab] = useState<Tab>('模型')
  const [fatal, setFatal] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [probing, setProbing] = useState('')
  const [preview, setPreview] = useState<ProbeDialog | null>(null)
  const [officialSources, setOfficialSources] = useState({ models: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', thinking: 'https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/', updates: 'https://api-docs.deepseek.com/zh-cn/updates' })
  const [official, setOfficial] = useState<OfficialPreview | null>(null)
  const [officialChecked, setOfficialChecked] = useState<string[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [aliasName, setAliasName] = useState('')
  const [logs, setLogs] = useState<Record<string, unknown>[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [verifyTarget, setVerifyTarget] = useState<ModelRef | string>()
  const [verifyKind, setVerifyKind] = useState<Verification['kind']>('text')
  const [verifyResult, setVerifyResult] = useState<Verification | null>(null)
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

  const load = async () => {
    const next = asSnapshot(await request(''))
    // 插件 host 改动需要重启 DSH：旧 host 返回 v1 配置（别名是数组、无 auto 字段），新页面渲染必然崩溃，这里给出明确指引。
    if (next.config.version !== 3) throw new Error(`检测到旧版插件服务（配置格式 v${next.config.version}）：请重启 DSH 让新版 host 生效后刷新本页`)
    setSnapshot(next); setDraft(structuredClone(next.config)); setFatal('')
    setExpanded(new Set())
  }
  useEffect(() => { void load().catch(error => setFatal(String(error))) }, [])
  /** 只刷新宿主目录与证据，不覆盖用户正在编辑的草稿。 */
  const refreshDirectory = async (silent = false): Promise<Snapshot | null> => {
    if (!snapshot) return null
    const before = new Set(snapshot.models.map(model => `${model.providerId}:${model.modelId}`))
    const next = asSnapshot(await request('/refresh', { method: 'POST' }))
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
      const next = asSnapshot(await request('', { method: 'PUT', body: JSON.stringify({ revision: snapshot.revision, config: draft }) }))
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
  /** 验证一个模型（文字/图片/工具/推理档位）；图片验证通过时直接给出可一键写入的声明建议。 */
  const verifyOne = async (ref: ModelRef, kind: Verification['kind']) => {
    const result = await request('/verify', { method: 'POST', body: JSON.stringify({ ...ref, kind }) }) as { verification: Verification }
    setVerifyResult(result.verification)
    const fresh = asSnapshot(await request(''))
    setSnapshot(fresh)
    const suggestions = kind === 'image' ? imageSuggestions([result.verification]) : []
    if (suggestions.length) {
      const model = fresh.models.find(item => item.providerId === ref.providerId && item.modelId === ref.modelId)
      setPreview({ title: `验证建议：${model?.name ?? ref.modelId}`, model, suggestions, checked: suggestions.map(item => item.confidence === 'high'), verifications: [result.verification] })
    } else notify('success', `验证完成：${kind} ${result.verification.status}${result.verification.behavior ? ` / ${result.verification.behavior}` : ''}。`)
  }
  const imageSuggestions = (verifications: Verification[]): ProbeSuggestion[] => {
    const result: ProbeSuggestion[] = []
    for (const item of verifications) {
      if (item.kind !== 'image') continue
      if (item.status === 'accepted' && item.behavior === 'observed') {
        result.push({ field: 'hostImage', value: 'yes', confidence: 'high', reason: '图片验证通过：模型正确识别了探测图的颜色' })
        result.push({ field: 'pluginImage', value: 'yes', confidence: 'high', reason: '图片验证通过：模型正确识别了探测图的颜色' })
      } else if (item.status === 'accepted' && item.behavior === 'not-observed') {
        result.push({ field: 'pluginImage', value: 'no', confidence: 'low', reason: `图片验证未通过：${item.detail ?? '模型未识别出探测图颜色'}` })
      } else if (item.status === 'rejected') {
        result.push({ field: 'pluginImage', value: 'no', confidence: 'low', reason: `图片请求被拒绝：${item.detail ?? '宿主或模型拒绝了图片参数'}` })
      }
    }
    return result
  }
  const refreshOfficial = async () => {
    setBusy(true)
    try { const result = await request('/official-preview', { method: 'POST', body: JSON.stringify({ sources: officialSources }) }) as OfficialPreview; setOfficial(result); setOfficialChecked(result.diffs.map(item => item.id)); notify('info', `已读取 ${result.diffs.length} 项差异，请核对来源和字段。`) }
    catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  const applyOfficial = async () => {
    if (!official) return
    setBusy(true)
    try { await request('/official-apply', { method: 'POST', body: JSON.stringify({ token: official.token, selected: officialChecked }) }); setOfficial(null); await refreshDirectory(true); await load(); notify('success', '已应用选中的官方资料，可使用“恢复上次同步”撤回。') }
    catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  const probeOne = async (model: ModelRecord) => {
    const key = `${model.providerId}:${model.modelId}`
    setProbing(key)
    try {
      const result = await request('/probe', { method: 'POST', body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, items: ['image', 'tools'] }) }) as ProbeResponse
      const next = await refreshDirectory(true)
      const fresh = next?.models.find(item => item.providerId === model.providerId && item.modelId === model.modelId) ?? model
      const shared = { model: fresh, elevated: result.elevated, restoreFailed: result.restoreFailed, notes: result.notes }
      if (!result.suggestions.length) {
        setPreview({ title: `探测结果：${fresh.name}`, ...shared, suggestions: [], checked: [], verifications: result.verifications })
        return
      }
      setPreview({ title: `探测建议：${fresh.name}`, ...shared, suggestions: result.suggestions, checked: result.suggestions.map(item => item.confidence === 'high') })
    } catch (error) { setPreview({ title: `探测失败：${model.name}`, model, suggestions: [], checked: [], failure: String(error) }) }
    finally { setProbing('') }
  }
  const applyProbe = async () => {
    if (!preview || !snapshot || !preview.model) return
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
        const key = JSON.stringify([preview.model!.providerId, preview.model!.modelId])
        next.models[key] ??= {}
        next.models[key].capability ??= {}
        for (const item of pluginChosen) {
          if (item.field === 'pluginImage') next.models[key].capability!.image = item.value
        }
      })
      setPreview({ ...preview, title: '已应用结论', suggestions: [], checked: [], applied: { hostApplied, pluginCount: pluginChosen.length, skipped } })
    } catch (error) { setPreview(current => current && { ...current, failure: String(error) }) }
    finally { setBusy(false) }
  }
  if (!draft || !snapshot) return <div className="dmm-root">{fatal || '正在加载模型管理…'}</div>
  const dirty = !sameConfig(draft, snapshot.config)
  const aliases = Object.keys(draft.aliases)
  const providers = [...new Set(snapshot.models.map(model => model.providerId))].sort()
  const keyword = modelFilter.trim().toLowerCase()
  const filtered = snapshot.models.filter(model => (!providerFilter || model.providerId === providerFilter) && `${model.providerId} ${model.modelId} ${model.name}`.toLowerCase().includes(keyword))
  const resetFilter = () => { setModelFilter(''); setProviderFilter('') }
  const filtering = !!(keyword || providerFilter)
  const currentSupport = (model: ModelRecord, field: ProbeField): Support => {
    if (field === 'hostImage') return model.nativeImage
    return draft.models[JSON.stringify([model.providerId, model.modelId])]?.capability?.image ?? 'unknown'
  }
  /** 按 Provider 分组；组默认全部收起（点组头展开）；筛选生效时只显示匹配的组并全部展开。 */
  const attention = (group: ModelRecord[]) => group.some(model => snapshot.verifications.some(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId && (item.stale || item.status === 'rejected' || item.status === 'network-error')))
  const verifiedCount = (group: ModelRecord[]) => group.filter(model => snapshot.verifications.some(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId && item.status === 'accepted' && !item.stale)).length
  const warnCount = (group: ModelRecord[]) => group.filter(model => snapshot.verifications.some(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId && (item.stale || item.status === 'rejected' || item.status === 'network-error'))).length
  const groups = providers.map(id => ({ id, models: filtered.filter(model => model.providerId === id) })).filter(group => group.models.length)
  const groupOpen = (id: string) => filtering ? true : expanded.has(id)
  return <div className="dmm-root">
    <h2>模型管理</h2>
    <details className="dmm-guide">
      <summary>这个插件是干什么的？（点开查看说明）</summary>
      <p>查看已加载模型及能力，配置别名、AUTO 自动选模型和视觉辅助。子 Agent 模型选择使用 DSH 原生设置。</p>
      <ul className="dmm-steps">
        <li><strong>推荐顺序</strong>：核对模型 → 配置别名 → 配置 AUTO 的评估模型与三个执行档 → 按需配置子 Agent 和视觉辅助。</li>
        <li><strong>模型选择</strong>：选具体模型或 @别名直接使用；选 AUTO 才会逐轮评估任务等级。</li>
        <li><strong>看不到刚导入的模型</strong>：目录只代表宿主已加载的模型，点「刷新目录」即可，不必重启 DSH。</li>
      </ul>
    </details>
    <div className="dmm-tabs">{tabs.map(item => <button key={item} aria-selected={tab === item} onClick={() => { setTab(item); if (item === '日志') void request('/logs').then(result => setLogs(result.events)).catch(error => notify('error', String(error))) }}>{item}</button>)}</div>
    {tab === '模型' && <>
      <div className="dmm-card"><strong>同步 DeepSeek 官方配置</strong><p className="dmm-muted">点击后读取以下官方网页，先预览差异再应用。网页不一致或解析失败时不会写入。</p>
        {(['models', 'thinking', 'updates'] as const).map(key => <div className="dmm-row" key={key}><label>{key} <input style={{ minWidth: 440, maxWidth: '100%' }} value={officialSources[key]} onChange={event => setOfficialSources(current => ({ ...current, [key]: event.target.value }))} /></label></div>)}
        <div className="dmm-row"><button disabled={busy} onClick={() => void refreshOfficial()}>刷新并预览</button><button disabled={busy} onClick={() => { setBusy(true); void request('/official-restore', { method: 'POST', body: '{}' }).then(async () => { await load(); notify('success', '已恢复上次同步前的配置。') }).catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>恢复上次同步</button></div>
        {official && <><p className="dmm-muted">抓取时间：{official.fetchedAt}；模型来源：<a href={official.sources.models} target="_blank" rel="noreferrer">打开官方网页</a></p>
          {official.diffs.map(diff => <div className="dmm-row" key={diff.id}><label><input type="checkbox" checked={officialChecked.includes(diff.id)} onChange={event => setOfficialChecked(current => event.target.checked ? [...current, diff.id] : current.filter(id => id !== diff.id))} />{diff.id}：{typeof diff.before === 'object' ? JSON.stringify(diff.before) : String(diff.before)} → <strong>{typeof diff.after === 'object' ? JSON.stringify(diff.after) : String(diff.after)}</strong></label><span className="dmm-muted">{diff.reason} · <a href={diff.source} target="_blank" rel="noreferrer">依据网页</a></span></div>)}
          {!official.diffs.length && <p className="dmm-muted">当前官方模型声明已与网页一致。</p>}
          <button className="dmm-primary" disabled={busy || !officialChecked.length} onClick={() => void applyOfficial()}>应用选中差异</button>
        </>}
      </div>
      <details className="dmm-guide">
        <summary>这一页是干什么的？（点开查看说明）</summary>
        <p>按 Provider 分组列出宿主已加载的模型，核对并修正能力声明、实测验证。组默认全部收起，点组头展开：</p>
        <ul className="dmm-steps">
          <li><strong>模型能力</strong>：优先看已加载模型目录及官方资料；需要确认当前账号是否能调用时再发真实验证请求。</li>
          <li><strong>验证证据</strong>：与能力声明分开显示，不自动修改配置。</li>
          <li><strong>「验证失败/过期」徽标</strong>：表示该组里有模型的验证证据是失败或已过期（配置改过后旧证据作废）。它只是提示「值得再测一次」，不代表模型不可调用——没验证过的模型本来就没有证据。</li>
          <li><strong>宿主声明</strong>：可编辑模型的手动修正需单独保存到宿主；DeepSeek 官方模型可先用上方同步功能预览差异。</li>
        </ul>
      </details>
      <FilterBar text={modelFilter} onText={setModelFilter} provider={providerFilter} onProvider={setProviderFilter} providers={providers} matched={filtered.length} total={snapshot.models.length} onReset={resetFilter}>
        <button disabled={refreshing} onClick={() => { setRefreshing(true); void refreshDirectory().catch(error => notify('error', `刷新目录失败：${String(error)}`)).finally(() => setRefreshing(false)) }}>{refreshing ? '刷新中…' : '刷新目录'}</button>
        <span className="dmm-muted">真实调用验证会消耗用量；结果不自动修改模型声明。</span>
        {!filtering && <>
          <button onClick={() => setExpanded(new Set(groups.map(group => group.id)))}>展开全部</button>
          <button onClick={() => setExpanded(new Set())}>收起全部</button>
        </>}
      </FilterBar>
      {groups.map(group => {
        const open = groupOpen(group.id)
        const warn = attention(group.models)
        return <div className="dmm-group" key={group.id}>
          <div className="dmm-group-head" role="button" aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next })}>
            <strong>{open ? '▾' : '▸'} {group.id}</strong>
            <span className="dmm-badge">{group.models.length} 个模型</span>
            <span className="dmm-badge">已验证 {verifiedCount(group.models)}</span>
            {warn ? <span className="dmm-badge dmm-badge-warn">验证失败/过期 {warnCount(group.models)}（仅提示，不代表不可用）</span> : null}
          </div>
          {open && <div className="dmm-group-body">
            {group.models.map(model => <div className="dmm-card" key={`${model.providerId}:${model.modelId}`}>
              <strong>{model.name}</strong> <span className="dmm-muted">{model.providerId} / {model.modelId}</span>
              <div className="dmm-row">原生图片：{model.nativeImage}；上下文：{model.contextWindow ?? '未知'}；默认输出：{model.defaultMaxTokens ?? '未知'}；推理档位：{model.reasoningEfforts.map(e => e.id).join(' / ') || '未知'}</div>
              <div className="dmm-muted">资料：{model.capabilitySource ?? '未知'}{model.capabilityCheckedAt ? ` · 核对于 ${model.capabilityCheckedAt}` : ''}</div>
              <div className="dmm-muted">{snapshot.verifications.filter(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId).map(item => `${item.kind}: ${item.status} / ${item.behavior ?? '未知'}${item.stale ? '（已过期）' : ''}`).join('；') || '尚无验证证据'}</div>
              <NativeEditor model={model} revision={snapshot.nativeRevision} refresh={async () => { await refreshDirectory(true) }} notify={notify} />
              <div className="dmm-row">
                <button disabled={busy || probing !== ''} onClick={() => void probeOne(model)}>{probing === `${model.providerId}:${model.modelId}` ? '验证中…' : '验证图片能力'}</button>
                <button disabled={busy} onClick={() => { setBusy(true); void verifyOne({ providerId: model.providerId, modelId: model.modelId }, 'text').catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证文字</button>
                <button disabled={busy} onClick={() => { setBusy(true); void verifyOne({ providerId: model.providerId, modelId: model.modelId }, 'image').catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证图片</button>
                <button disabled={busy} onClick={() => { setBusy(true); void verifyOne({ providerId: model.providerId, modelId: model.modelId }, 'tools').catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证工具</button>
              </div>
              <div className="dmm-row"><label>插件图片声明 <select value={draft.models[JSON.stringify([model.providerId, model.modelId])]?.capability?.image ?? 'unknown'} onChange={event => edit(next => { const key = JSON.stringify([model.providerId, model.modelId]); next.models[key] ??= {}; next.models[key].capability ??= {}; next.models[key].capability!.image = event.target.value as 'yes' | 'no' | 'unknown' })}><option value="unknown">未知</option><option value="yes">支持</option><option value="no">不支持</option></select></label></div>
            </div>)}
          </div>}
        </div>
      })}
      {!groups.length && <div className="dmm-card dmm-empty dmm-muted">没有匹配的模型。调整筛选条件，或点「清除筛选」查看全部 {snapshot.models.length} 个模型。</div>}
      {verifyResult && !preview && <details className="dmm-card"><summary className="dmm-composer">查看最近一次验证的原始证据</summary><pre>{JSON.stringify(verifyResult, null, 2)}</pre></details>}
    </>}
    {tab === '别名与兜底' && <>
      <details className="dmm-guide">
        <summary>这一页是干什么的？（点开查看说明）</summary>
        <p style={{ margin: '6px 0', fontSize: 13 }}>别名 = 好记的名字 + 一串按顺序兜底的具体模型 + 可选的兜底策略覆盖：</p>
        <ul className="dmm-steps">
          <li><strong>候选顺序即兜底顺序</strong>：第 1 个请求失败时按规则尝试第 2 个；模型选择器、AUTO 执行档和视觉模型处都能引用 @名字。</li>
          <li><strong>推理档位</strong>：每个候选模型只显示自己支持的真实档位；留空使用模型默认。</li>
          <li><strong>兜底策略</strong>：全局默认（最多尝试 1–3 次、网络失败重试、参数降级）在本页底部；单个别名可覆盖个别字段，例如给关键别名放宽尝试次数。</li>
          <li><strong>内置别名 @long-context</strong>：只在请求报「上下文溢出」时启用的专用候选，把上下文最大的模型放进去即可。</li>
        </ul>
      </details>
      <div className="dmm-card"><div className="dmm-row"><input placeholder="别名，如 fast" value={aliasName} onChange={event => setAliasName(event.target.value)} /><button onClick={() => { if (!/^[a-z][a-z0-9_-]*$/.test(aliasName) || draft.aliases[aliasName]) return; edit(next => { next.aliases[aliasName] = { candidates: [] } }); setAliasName('') }}>添加别名</button></div><p className="dmm-muted">候选按顺序尝试；每个别名至少添加一个具体模型后才能保存。</p></div>
      {aliases.map(alias => <AliasCard key={alias} name={alias} draft={draft} models={snapshot.models} edit={edit} notify={notify} removeAlias={name => edit(next => { delete next.aliases[name] })} />)}
      <div className="dmm-card">
        <strong>全局默认兜底策略</strong>
        <p className="dmm-muted">对走「模型管理」入口的所有请求生效；别名可用上面的覆盖项单独调整。聊天里的表现通常是「卡一下换了个模型继续答」；实际用了哪个模型可去「日志」页核对。</p>
        <div className="dmm-row">
          <label>最多实际尝试（1–3） <input type="number" min="1" max="3" value={draft.reliability.maxAttempts} onChange={event => edit(next => { next.reliability.maxAttempts = Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={draft.reliability.retryTransient} onChange={event => edit(next => { next.reliability.retryTransient = event.target.checked })} />网络失败重试一次</label>
          <label><input type="checkbox" checked={draft.reliability.parameterDowngrade} onChange={event => edit(next => { next.reliability.parameterDowngrade = event.target.checked })} />允许推理参数被拒时降级</label>
        </div>
        <p className="dmm-muted">已有输出不会重播；认证错误跳过同 Provider，429 暂时冷却；本轮明确指定的参数不会被静默降级。上下文溢出只尝试内置别名 @long-context 的候选。</p>
      </div>
    </>}
    {tab === 'AUTO 自动选模型' && <AutoTab draft={draft} models={snapshot.models} aliases={aliases} edit={edit} notify={notify} />}
    {tab === '子 Agent' && <SubagentsTab draft={draft} models={snapshot.models} aliases={aliases} edit={edit} notify={notify} />}
    {tab === '视觉' && <VisionSection draft={draft} models={snapshot.models} aliases={aliases} edit={edit} />}
    {tab === '日志' && <div className="dmm-card"><p className="dmm-muted">查看实际使用的模型、AUTO 选择和看图结果，排查调用失败。</p><button onClick={() => void request('/logs').then(result => setLogs(result.events)).catch(error => notify('error', String(error)))}>刷新日志</button>
      {logs.map((event, index) => <div className="dmm-log-row" key={index}>{event.time ? new Date(String(event.time)).toLocaleString() : '时间未知'} · <strong>{event.action === 'auto-evaluation' ? 'AUTO 评估' : String(event.action ?? '执行调用')}</strong> · {String(event.provider ?? '')}/{String(event.model ?? '')} · {String(event.status ?? '完成')} · {event.durationMs == null ? '耗时未知' : `${event.durationMs} ms`}
        {event.grade != null && <span> · {String(event.grade)}：{String(event.reason ?? '')}</span>}
        <details><summary className="dmm-muted">详情</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></div>)}
      {!logs.length && <p className="dmm-muted">暂无记录。</p>}
    </div>}
    <div className="dmm-actions">
      <button className="dmm-primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? '处理中…' : '保存设置'}</button>
      <button disabled={busy} onClick={() => void reload()} title="放弃未保存的修改，重新读取已保存的配置">重新加载</button>
      {dirty ? <span className="dmm-dirty">● 有未保存的修改</span> : <span className="dmm-muted">没有未保存的修改</span>}
      <span className="dmm-muted">「保存设置」把全部标签页的插件配置写入 DSH，下一次请求生效；模型卡片里的「保存到宿主」是另一件事：写宿主 llm-pi-ai 的模型声明。</span>
    </div>
    <div className="dmm-toasts">{notices.map(item => <div key={item.id} className={`dmm-toast dmm-toast-${item.kind}`} role="status"><span>{item.text}</span><button aria-label="关闭提示" onClick={() => dismiss(item.id)}>×</button></div>)}</div>
    {preview && <div className="dmm-modal-mask" onClick={() => { if (!busy) setPreview(null) }} role="presentation">
      <div className="dmm-modal" role="dialog" aria-modal="true" aria-label={preview.title} onClick={event => event.stopPropagation()}>
        <h3>{preview.title}</h3>
        {preview.failure && <p className="dmm-error">{preview.failure}</p>}
        {preview.applied && <p className="dmm-note">已应用：宿主声明 {preview.applied.hostApplied} 项、插件声明 {preview.applied.pluginCount} 项{preview.applied.skipped ? `，${preview.applied.skipped} 项因宿主不可写被跳过` : ''}。{preview.applied.pluginCount ? '插件声明需再点页面底部「保存设置」落盘。' : ''}</p>}
        {!preview.failure && !preview.applied && preview.suggestions.length > 0 && <p className="dmm-muted">以下是真实请求得出的结论，高置信项已默认勾选。勾选后点「应用选中项」：「宿主原生图片声明」立即写入宿主，「插件声明」需再点页面底部「保存设置」。</p>}
        {!preview.failure && !preview.applied && preview.suggestions.length === 0 && (preview.verifications?.length || 0) > 0 && <p className="dmm-muted">本次请求没有产生可直接写入的结论，以下是原始验证证据：</p>}
        {preview.elevated && <p className="dmm-note">该模型宿主声明为「不支持」，宿主会把图片替换成文字占位，因此探测期间已临时把声明提为「支持」实测，测完已恢复原声明——此处的「支持」结论来自图片真实到达模型的实测。</p>}
        {preview.restoreFailed && <p className="dmm-note">探测后未能恢复宿主原声明，请到模型卡片核对「宿主原生图片」的当前值。</p>}
        {(preview.notes ?? []).map((note, index) => <p className="dmm-note" key={index}>{note}</p>)}
        {preview.model && preview.suggestions.map((item, index) => {
          const blocked = item.field === 'hostImage' && !preview.model!.nativeEditable
          return <div className="dmm-row" key={`${item.field}-${index}`}>
            <label><input type="checkbox" disabled={blocked} checked={preview.checked[index] && !blocked} onChange={event => setPreview(current => current && { ...current, checked: current.checked.map((value, at) => at === index ? event.target.checked : value) })} />{probeLabels[item.field]}：{supportLabels[currentSupport(preview.model!, item.field)]} → <strong>{supportLabels[item.value]}</strong></label>
            <span className="dmm-muted">{item.confidence === 'high' ? '高置信' : '低置信'} · {item.reason}{blocked ? ` · 无法写入宿主：${preview.model!.nativeEditReason ?? '该 Provider 未公开可写模型字段'}` : ''}</span>
          </div>
        })}
        {(preview.verifications ?? []).map((item, index) => <p className="dmm-muted" key={index}>{`${item.kind}: ${item.status}${item.behavior ? ` / ${item.behavior}` : ''}${item.detail ? ` — ${item.detail}` : ''}`}</p>)}
        <div className="dmm-row">
          {preview.suggestions.length > 0 && !preview.applied && <button className="dmm-primary" disabled={busy} onClick={() => void applyProbe()}>应用选中项</button>}
          <button disabled={busy} onClick={() => setPreview(null)}>关闭</button>
        </div>
      </div>
    </div>}
  </div>
}

/** 面板错误边界：渲染异常时显示可重试的错误卡片，而不是让整个设置区白屏。 */
class PanelBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error): { error: Error } { return { error } }
  render() {
    if (this.state.error) return <div className="dmm-root"><div className="dmm-card"><strong>模型管理界面出错</strong><p className="dmm-error">{String(this.state.error)}</p><button onClick={() => this.setState({ error: null })}>重试</button><span className="dmm-muted">若反复出现，请重启 DSH 或反馈此错误文本。</span></div></div>
    return this.props.children
  }
}

export function apply(ctx: { slots: { inject(name: string, register: () => () => void): void; register(options: { name: string; id: string; order: number; label?: () => string }, component: (props: any) => React.ReactElement): () => void } }): void {
  injectStyle()
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'model-manager', order: 12, label: () => '模型管理' }, (props: any) => <PanelBoundary><ManagerSection {...props} /></PanelBoundary>))
}
