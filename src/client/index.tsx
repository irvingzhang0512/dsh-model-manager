import { hostRouteUrl } from "./transport.js"
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AutoTab } from './auto-tabs.js'
import { DEFAULT_OFFICIAL_URL, DEFAULT_ANALYSIS_TIMEOUT_SECONDS, officialAnalysisTimeout, predictedModelCount, type OfficialPreview, type OfficialProgress } from '../official-types.js'
import { readOfficialStream } from './official-stream.js'
import { OfficialProgressStatus } from './official-progress.js'
import { AliasRemovalManager, LegacyPreferencesManager, CatalogManager, CatalogPreviewPanel, catalogRequest, type CatalogEditor } from './catalog-panel.js'
import type { CatalogCapability, CatalogResolution } from '../catalog-types.js'
import type { ManagerConfig, ModelRecord, ModelRef, ProbeField, ProbeSuggestion, Verification } from '../domain.js'
import { probeSuggestions } from '../domain.js'
import { ParameterPanel } from './parameter-panel.js'
import { SourcePanel } from './source-panel.js'
import { AliasHealthPanel } from './alias-health-panel.js'

export const inject = ['slots']
type Snapshot = { revision: number; nativeRevision?: number; config: ManagerConfig; models: ModelRecord[]; catalogCapabilities?: CatalogCapability[]; catalogBackupId?: string; parameterBackupId?: string; sourceBackupId?:string; legacyImageOverrideCount?: number; legacyAliasReliabilityCount?: number; catalogBackupWritesPlugin?: boolean; hostDefault?: ModelRef; verifications: (Verification & { stale: boolean })[] }
type Tab = '模型来源' | '模型' | '别名与兜底' | 'AUTO 自动选模型' | '视觉' | '日志'
const tabs: Tab[] = ['模型来源', '模型', '别名与兜底', 'AUTO 自动选模型', '视觉', '日志']
const probeLabels: Record<ProbeField, string> = { hostImage: '宿主原生图片声明' }
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
  applied?: { hostApplied: number; skipped: number }
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
.dmm-root [hidden]{display:none!important}.dmm-root{font-family:system-ui,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;padding:20px;max-width:1100px;color:var(--dsw-alias-label-primary,#222)}
.dmm-root h2{margin:0 0 6px;font-size:20px}.dmm-muted{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.dmm-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0}.dmm-tabs button,.dmm-root button,.dmm-composer{font:inherit}
.dmm-tabs button,.dmm-root button{border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:7px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;padding:6px 10px;cursor:pointer}
.dmm-tabs button[aria-selected=true],.dmm-root button.dmm-primary{background:var(--dsw-alias-brand-primary,#356dde);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.dmm-root button:disabled{cursor:not-allowed;opacity:.5}
.dmm-card{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;padding:14px;margin:10px 0;background:var(--dsw-alias-bg-layer-2,#fff)}
.dmm-group{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;margin:10px 0;background:var(--dsw-alias-bg-layer-2,#fff)}
.dmm-group-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 14px;cursor:pointer;user-select:none}
.dmm-group-body{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:4px 14px 10px}
.dmm-badge{font-size:12px;border-radius:6px;padding:2px 7px;background:var(--dsw-alias-bg-layer-1,#f0f2f5)}
.dmm-badge-warn{color:#b42318;background:rgba(180,35,24,.08)}
.dmm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.dmm-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0}
.dmm-root input:not([type=checkbox]),.dmm-root select,.dmm-root textarea{font:inherit;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,#bbb);border-radius:6px;padding:6px;min-width:110px}
.dmm-root input[type=checkbox]{width:16px;height:16px;margin:0 6px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-brand-primary,#356dde)}
.dmm-switch-row{display:flex;align-items:center;justify-content:space-between;gap:14px}.dmm-switch-row strong{display:block}.dmm-switch-row input{flex:none}.dmm-log-row{border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);padding:8px 0}.dmm-log-row:last-child{border-bottom:0}
.dmm-root textarea{width:100%;min-height:100px}.dmm-root label{font-size:13px}.dmm-error{color:#b42318}.dmm-composer{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px}
.dmm-dirty{color:#b54708;font-size:12px}
.dmm-empty{border-style:dashed;text-align:center}
.dmm-modal-mask{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:20px}
.dmm-modal{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:12px;padding:16px;width:min(620px,94vw);max-height:82vh;overflow:auto;box-shadow:0 16px 48px rgba(0,0,0,.28)}
.dmm-modal h3{margin:0 0 6px;font-size:16px}
.dmm-note{color:#b54708;font-size:12px;margin:6px 0}
.dmm-actions{position:sticky;bottom:0;z-index:6;display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 -6px 16px rgba(0,0,0,.07)}
.dmm-toasts{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(380px,90vw)}
.dmm-toast{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:9px;font-size:13px;line-height:1.45;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#ccc);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#222)}
.dmm-toast-success{border-color:#2f855a}.dmm-toast-error{border-color:#b42318}.dmm-toast-info{border-color:var(--dsw-alias-brand-primary,#356dde)}
.dmm-root .dmm-toast button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px;line-height:1;padding:0 2px}
.dmm-steps{margin:6px 0;padding-left:20px;list-style:disc}.dmm-steps li{margin:5px 0;font-size:13px;line-height:1.65}
.dmm-hint{border-left:3px solid var(--dsw-alias-brand-primary,#356dde);background:var(--dsw-alias-bg-layer-1,#f6f7f9);border-radius:0 8px 8px 0;padding:8px 12px;margin:8px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#555);line-height:1.7}
.dmm-composer summary{cursor:pointer;user-select:none}
.dmm-popcard{padding:10px 12px;box-shadow:0 10px 28px rgba(0,0,0,.14)}
.dmm-guide{background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-border-l2,#e3e6eb);border-radius:10px;padding:12px 14px;margin:10px 0}
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
  const response = await fetch(hostRouteUrl(`/api/model-manager${path}`), { headers: { 'Content-Type': 'application/json' }, ...init })
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
function EffortSelect({ target, value, models, aliases, onChange, disabled, label = '推理档位' }: { target?: ModelRef | string; value?: string; models: ModelRecord[]; aliases: ManagerConfig['aliases']; onChange: (value?: string) => void; disabled?: boolean; label?: string }) {
  const refs = typeof target === 'string' ? aliases[target.slice(1)]?.candidates ?? [] : target ? [target] : []
  const selected = refs.map(ref => models.find(model => model.providerId === ref.providerId && model.modelId === ref.modelId)).filter((model): model is ModelRecord => !!model)
  const efforts = selected.length ? selected[0].reasoningEfforts.filter(e => selected.every(model => model.reasoningEfforts.some(item => item.id === e.id))) : []
  return <select aria-label={label} disabled={disabled} value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">使用模型默认</option>{efforts.map(e => <option key={e.id} value={e.id}>{e.id === 'off' ? '关闭思考' : e.name}（{e.id}）</option>)}
  </select>
}
export function SelectModel({ value, models, aliases, disabled, onChange }: { value?: ModelRef | string; models: ModelRecord[]; aliases: string[]; disabled?: boolean; onChange: (next?: ModelRef | string) => void }) {
  const missing = value && (typeof value === 'string' ? !aliases.includes(value.slice(1)) : !models.some(model => model.providerId === value.providerId && model.modelId === value.modelId))
  return <select disabled={disabled} value={refValue(value)} onChange={event => onChange(parseRef(event.target.value))}>
    <option value="">未设置</option>
    {missing && <option value={refValue(value)}>{typeof value === 'string' ? value : `${value.providerId}/${value.modelId}`}（失效：别名未绑定或模型不在当前可选目录）</option>}
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

export function VisionSection({ draft, models, aliases, edit }: { draft: ManagerConfig; models: ModelRecord[]; aliases: string[]; edit: (fn: (next: ManagerConfig) => void) => void }) {
  const clearVision = () => {
    if (draft.auto.roles.vision.target && !window.confirm('仍有旧视觉兜底。清空视觉模型会同时清除当前目标和旧兜底及其推理档位；视觉开关和其他设置保留。确认清除？')) return
    edit(next => { delete next.vision.target; delete next.auto.roles.vision.target; delete next.auto.roles.vision.reasoningEffort; delete next.auto.roles.vision.tier; delete next.auto.roles.vision.thinking })
  }
  return <>
    <details className="dmm-guide">
      <summary>视觉辅助是做什么的？（点开查看说明）</summary>
      <p className="dmm-muted" style={{ margin: '6px 0' }}>你把图片粘贴或拖入输入框发送后，图片需要随消息交给当前对话模型。DSH 默认不加工图片：模型声明「支持图片」就发原图；声明「不支持」则图片到不了模型——它只能看到一行占位文字，或直接收到报错。</p>
      <p style={{ margin: '6px 0', fontSize: 13 }}>开启「视觉辅助」后，插件在每次请求发出前接管图片路由：</p>
      <ul className="dmm-steps">
        <li><strong>当前模型自己支持看图</strong>：图片原样随消息发给它，效果最直接，也不产生额外调用。</li>
        <li><strong>当前模型不支持看图</strong>：自动模式先请视觉模型理解图片，再把带来源的观察交给当前模型；仍可用看图工具继续追问或裁剪。</li>
      </ul>
      <p className="dmm-muted">附件上传与发送流程保持不变；新图和工具图片都会处理；历史追问按当前问题读取，会话内复用相同问题的观察。关闭开关立即恢复 DSH 默认行为。</p>
    </details>
    <div className="dmm-card">
      <div className="dmm-switch-row"><div><strong>视觉辅助</strong><span className="dmm-muted">当前模型看不了图时，交给辅助模型理解图片。</span></div><label aria-label="启用视觉辅助"><input type="checkbox" checked={draft.vision.enabled} onChange={event => edit(next => { next.vision.enabled = event.target.checked })} />{draft.vision.enabled ? '已开启' : '已关闭'}</label></div>
      {draft.vision.enabled && <>
      <label className="dmm-row"><input type="checkbox" checked={draft.vision.automatic!==false} onChange={e=>edit(next=>{next.vision.automatic=e.target.checked})}/>自动理解图片（默认开启）</label><p className="dmm-muted">自动模式在每步请求前准备必要观察，包括工具返回的图片，并在会话中记录视觉来源；关闭后仍可用看图工具追问或裁剪。</p>
      <div className="dmm-row"><label>策略 <select value={draft.vision.policy} onChange={event => edit(next => { next.vision.policy = event.target.value as ManagerConfig['vision']['policy'] })}><option value="native-first">原生优先（推荐）</option><option value="sidecar-first">看图工具优先</option><option value="native-only">仅原生直读</option><option value="sidecar-only">仅看图工具</option></select></label><span className="dmm-muted">决定「当前模型直接看图」与「交给视觉模型代看」如何取舍。</span></div>
      <div className="dmm-hint">{policyHelp[draft.vision.policy]}</div>
      <details className="dmm-guide"><summary>何时使用辅助模型？</summary><p>当前模型不能直接看图时，辅助模型先理解图片，再把文字结果交给当前模型。未选择辅助模型且当前模型不支持图片时，请求会报错。</p></details>
      </>}
      <div className="dmm-row"><label>视觉模型 <SelectModel value={draft.vision.target} models={models.filter(m => m.nativeImage === 'yes')} aliases={aliases} onChange={value => { if (!value) clearVision(); else edit(next => { next.vision.target = value }) }} /></label><button disabled={!draft.vision.target && !draft.auto.roles.vision.target} onClick={clearVision}>{draft.auto.roles.vision.target ? '清空视觉目标及旧兜底' : '清除当前视觉目标'}</button></div>
      {draft.auto.roles.vision.target && <div className="dmm-row"><label>旧视觉兜底 <SelectModel value={draft.auto.roles.vision.target} models={models.filter(m => m.nativeImage === 'yes')} aliases={aliases} onChange={value => edit(next => { delete next.auto.roles.vision.reasoningEffort; delete next.auto.roles.vision.tier; delete next.auto.roles.vision.thinking; if (value) next.auto.roles.vision.target = value; else delete next.auto.roles.vision.target })} /></label><button onClick={() => edit(next => { delete next.auto.roles.vision.target; delete next.auto.roles.vision.reasoningEffort; delete next.auto.roles.vision.tier; delete next.auto.roles.vision.thinking })}>清除旧视觉兜底</button><p className="dmm-muted">未设置当前目标时仍可能使用此旧兜底。要清空视觉模型，请同时明确清除此项；清除无关旧兜底不会关闭当前辅助。</p></div>}
    </div>
    <div className="dmm-guide">
      <strong>看图工具的工作方式</strong>
      <ul className="dmm-steps">
        <li>自动模式先生成带附件编号和视觉模型来源的观察，随后交给对话模型。关闭自动模式时，对话模型可按附件编号调用 model_manager_inspect_image；理解失败会明确反馈。</li>
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

/** 别名卡：固定恢复规则与候选模型的档位映射。 */
export function AliasCard({ name, draft, models, edit, notify, removeAlias }: {
  name: string; draft: ManagerConfig; models: ModelRecord[]; edit: (fn: (next: ManagerConfig) => void) => void
  notify: (kind: Notice['kind'], text: string) => void; removeAlias: (name: string) => void
}) {
  const alias = draft.aliases[name]
  if (!alias) return null
  const candidates = alias.candidates ?? []
  const isLongContext = name === 'long-context'
  const referenced = [...new Map(candidates.map(ref => [JSON.stringify([ref.providerId, ref.modelId]), models.find(model => model.providerId === ref.providerId && model.modelId === ref.modelId)] as const).values()).values()].filter((item): item is ModelRecord => !!item)
  return <div className="dmm-card">
    <div className="dmm-row">
      <strong>@{name}</strong>
      {isLongContext && <span className="dmm-badge">内置：上下文溢出兜底</span>}
      <button onClick={() => removeAlias(name)}>删除</button>
    </div>
    {isLongContext && <p className="dmm-muted">具体模型请求上下文溢出时可使用这里的候选。其他别名只尝试自己配置的候选，不自动追加本组；也可直接选择本别名。</p>}
    {candidates.map((ref, index) => <div className="dmm-row" key={index}>
      <span>{index + 1}.</span>
      <SelectModel value={ref} models={models} aliases={[]} onChange={value => edit(next => { if (value && typeof value !== 'string') next.aliases[name].candidates[index] = value })} />
      <button disabled={!index} onClick={()=>edit(next=>{const list=next.aliases[name].candidates;[list[index-1],list[index]]=[list[index],list[index-1]]})}>上移</button><button disabled={index===candidates.length-1} onClick={()=>edit(next=>{const list=next.aliases[name].candidates;[list[index+1],list[index]]=[list[index],list[index+1]]})}>下移</button>
      <button onClick={() => edit(next => { next.aliases[name].candidates.splice(index, 1) })}>移除</button>
    </div>)}
    <button onClick={() => edit(next => { if (models[0]) next.aliases[name].candidates.push({ providerId: models[0].providerId, modelId: models[0].modelId }) })}>添加候选</button>
    {!candidates.length && <p className="dmm-note">每个别名至少要有一个具体模型才能保存。</p>}
    <p className="dmm-muted">按顺序尝试全部候选。网络、超时或服务端临时故障每个候选最多调用 5 次；其他错误直接换下一个。成功后显示完整回答，失败的半段内容丢弃；停止后不再重试。</p>
    <TierMapping name={name} models={referenced} draft={draft} edit={edit} />
    <div className="dmm-row">{([{key:'transientCooldownSeconds',label:'临时故障冷却',value:60},{key:'rateLimitCooldownSeconds',label:'限流冷却',value:300},{key:'quotaCooldownSeconds',label:'额度不足冷却',value:3600}] as const).map(field=><label key={field.key}>{field.label}（秒，1–604800）<input type="number" min="1" max="604800" placeholder={`默认 ${field.value}`} value={alias.recovery?.[field.key]??''} onChange={e=>edit(next=>{next.aliases[name].recovery??={};if(e.target.value)next.aliases[name].recovery![field.key]=Number(e.target.value);else delete next.aliases[name].recovery![field.key]})}/></label>)}</div><p className="dmm-muted">限流和额度不足优先采用服务端等待时间；凭据无效需更换凭据或手动恢复。能力和参数不匹配只跳过本次。</p>
    {!referenced.some(model => model.reasoningEfforts.length) && <p className="dmm-muted">候选模型都没有公开推理档位，无需映射。</p>}
  </div>
}

function ManagerSection({ctx}:{ctx?:any}) {
  const [catalogEditor, setCatalogEditor] = useState<CatalogEditor | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<ManagerConfig | null>(null)
  const [tab, setTab] = useState<Tab>('模型来源')
  const draftRevision=useRef<number>(0)
  const [fatal, setFatal] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [probing, setProbing] = useState('')
  const [preview, setPreview] = useState<ProbeDialog | null>(null)
  const [officialError, setOfficialError] = useState('')
  const [official, setOfficial] = useState<OfficialPreview | null>(null)
  const [officialChecked, setOfficialChecked] = useState<string[]>([])
  const [officialProgress, setOfficialProgress] = useState<OfficialProgress | null>(null)
  const [officialSource, setOfficialSource] = useState(DEFAULT_OFFICIAL_URL)
  const [officialAnalyzer, setOfficialAnalyzer] = useState<ModelRef>()
  const [officialEffort, setOfficialEffort] = useState<string>()
  const [officialTimeout, setOfficialTimeout] = useState(String(DEFAULT_ANALYSIS_TIMEOUT_SECONDS))
  const officialFormInitialized = useRef(false)
  const officialAbort = useRef<AbortController | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [aliasName, setAliasName] = useState('')
  const [removingAlias, setRemovingAlias] = useState<string | null>(null)
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
  useEffect(() => () => { timers.current.forEach(id => window.clearTimeout(id)); officialAbort.current?.abort() }, [])
  const effectiveAnalyzer = officialAnalyzer ?? snapshot?.hostDefault
  useEffect(() => { setOfficial(null); setOfficialChecked([]); setOfficialError('') }, [officialSource, effectiveAnalyzer?.providerId, effectiveAnalyzer?.modelId, officialEffort, officialTimeout])
  useEffect(() => { setOfficialEffort(undefined) }, [effectiveAnalyzer?.providerId, effectiveAnalyzer?.modelId])
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
    if (next.config.version !== 4) throw new Error(`检测到旧版插件服务（配置格式 v${next.config.version}）：请重启 DSH 让新版 host 生效后刷新本页`)
    if (!officialFormInitialized.current) {
      setOfficialSource(next.config.official?.sourceUrl ?? DEFAULT_OFFICIAL_URL)
      setOfficialAnalyzer(next.config.official?.analyzer)
      officialFormInitialized.current = true
    }
    draftRevision.current=next.revision; setSnapshot(next); setDraft(structuredClone(next.config)); setFatal(''); setOfficial(null); setOfficialChecked([])
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
  const edit = (fn: (next: ManagerConfig) => void) => setDraft(current => { if (!current || busy) return current; const next = structuredClone(current); fn(next); return next })
  const save = async () => {
    if (!snapshot || !draft) return
    setBusy(true)
    try {
      const next = asSnapshot(await request('', { method: 'PUT', body: JSON.stringify({ revision: draftRevision.current, config: draft }) }))
      draftRevision.current=next.revision; setSnapshot(next); setDraft(structuredClone(next.config)); window.dispatchEvent(new Event('dmm:config'))
      setOfficial(null); setOfficialChecked([])
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
  const imageSuggestions = probeSuggestions
  const refreshOfficial = async () => {
    setCatalogEditor(null); setOfficialError('')
    officialAbort.current?.abort()
    const controller = new AbortController(); officialAbort.current = controller
    setOfficial(null); setOfficialChecked([]); setOfficialProgress({ stage: 'reading', round: 1, pageCount: 0 })
    setBusy(true)
    try {
      const analysisTimeoutSeconds = officialAnalysisTimeout(Number(officialTimeout))
      const response = await fetch(hostRouteUrl('/api/model-manager/official-preview'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ sourceUrl: officialSource, analyzer: officialAnalyzer ?? null, ...(officialEffort ? { reasoningEffort: officialEffort } : {}), analysisTimeoutSeconds }), signal: controller.signal })
      const result = await readOfficialStream(response, value => { if (officialAbort.current === controller && !controller.signal.aborted) setOfficialProgress(value) })
      if (controller.signal.aborted || officialAbort.current !== controller) return
      setOfficial(result); setOfficialChecked(result.diffs.filter(item => item.field !== 'removeModel' && !item.blockedReasons.length).map(item => item.id))
      notify('info', `识别出 ${result.analysis.models.length} 个当前 API 模型、${result.diffs.length} 项差异，请核对原文证据。`)
    } catch (error) { if (officialAbort.current === controller) { const reason = controller.signal.aborted ? '分析已取消，配置未修改。' : String(error); setOfficialError(reason); notify(controller.signal.aborted ? 'info' : 'error', reason) } }
    finally { if (officialAbort.current === controller) { officialAbort.current = null; setOfficialProgress(null); setBusy(false) } }
  }
  const applyOfficial = async () => {
    if (!official || dirty) return
    setBusy(true)
    try { await request('/official-apply', { method: 'POST', body: JSON.stringify({ token: official.token, selected: officialChecked }) }); setOfficial(null); await refreshDirectory(true); await load(); notify('success', '已应用选中的官方资料，可使用“恢复上次同步”撤回。') }
    catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  const resolveOfficial = async (selected: string[], resolutions: CatalogResolution[]) => {
    if (!official || busy) return
    setBusy(true)
    try {
      const next = await catalogRequest('catalog-resolve', { token: official.token, selected, resolutions }) as OfficialPreview
      setOfficial(next); setOfficialChecked(next.catalog?.selected ?? selected)
    } catch (error) { notify('error', String(error)) }
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
    try {
      if (chosen.some(item => item.field === 'hostImage')) {
        if (preview.model.nativeEditable && snapshot.nativeRevision !== undefined) {
          await request('/native', { method: 'POST', body: JSON.stringify({ providerId: preview.model.providerId, modelId: preview.model.modelId, revision: snapshot.nativeRevision, image: true }) })
          await refreshDirectory(true)
          hostApplied++
        } else skipped++
      }
      setPreview({ ...preview, title: '已应用结论', suggestions: [], checked: [], applied: { hostApplied, skipped } })
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
    return model.nativeImage
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
      <p>查看已加载模型及能力，配置别名、AUTO 自动选模型和视觉辅助。子 Agent 模型范围请到 DSH 官方设置配置。</p>
      <ul className="dmm-steps">
        <li><strong>推荐顺序</strong>：核对模型 → 配置别名 → 配置 AUTO 的评估模型与三个执行档 → 按需配置视觉辅助；子 Agent 使用 DSH 官方设置。</li>
        <li><strong>模型选择</strong>：选具体模型或 @别名直接使用；选 AUTO 才会逐轮评估任务等级。</li>
        <li><strong>看不到刚导入的模型</strong>：目录只代表宿主已加载的模型，点「刷新目录」即可，不必重启 DSH。</li>
      </ul>
    </details>
    <div className="dmm-tabs">{tabs.map(item => <button key={item} aria-selected={tab === item} onClick={() => { setTab(item); if (item === '日志') void request('/logs').then(result => setLogs(result.events)).catch(error => notify('error', String(error))) }}>{item}</button>)}</div>
    {<div hidden={tab!=='模型来源'}><SourcePanel dirty={dirty} disabled={busy} backupId={snapshot.sourceBackupId} navigate={ctx?.get?.('pluginNavigation') ? ()=>ctx.get('pluginNavigation').openBundle('dsh-opencode-go') : undefined} onRefresh={()=>refreshDirectory(true)} onApplied={value=>{const next=asSnapshot(value);draftRevision.current=next.revision;setSnapshot(next);setDraft(structuredClone(next.config));window.dispatchEvent(new Event('dmm:config'))}}/></div>}
    {tab === '模型' && <>
      <div className="dmm-card"><strong>同步 DeepSeek 官方配置</strong>
        <p className="dmm-muted">每次重新读取入口网页，由 LLM 根据原文识别当前 API model name；必要时读取相关链接。会调用一次或多次分析模型，产生用量。先预览，再手动应用。</p>
        <div className="dmm-row"><label>资料入口 <input aria-label="官方资料入口" disabled={busy} style={{ width: 'min(520px, 100%)' }} value={officialSource} onChange={event => setOfficialSource(event.target.value)} /></label></div>
        <div className="dmm-row"><label>分析模型 <SelectModel disabled={busy} value={officialAnalyzer} models={snapshot.models.filter(model => model.providerId !== 'dsh-model-manager')} aliases={[]} onChange={value => { setOfficialAnalyzer(value && typeof value !== 'string' ? value : undefined); setOfficialEffort(undefined) }} /></label>
          <label>推理档位 <EffortSelect disabled={busy} label="分析推理档位" target={effectiveAnalyzer} value={officialEffort} models={snapshot.models} aliases={{}} onChange={setOfficialEffort} /></label></div>
        <div className="dmm-row"><label>每轮分析时限（秒） <input aria-label="每轮分析时限（秒）" type="number" min={30} max={600} step={1} disabled={busy} value={officialTimeout} onChange={event => setOfficialTimeout(event.target.value)} /></label></div>
        <p className="dmm-muted">本次参数不保存，无需点击“保存设置”。未选择分析模型时使用宿主默认模型{!officialAnalyzer && snapshot.hostDefault ? `（${snapshot.hostDefault.providerId}/${snapshot.hostDefault.modelId}）` : ''}；独立于 AUTO。刷新只生成预览，手动应用才改选中差异。</p>
        <div className="dmm-row"><button disabled={busy} onClick={() => void refreshOfficial()}>刷新并预览</button>
          {officialProgress && <button onClick={() => { officialAbort.current?.abort(); setOfficial(null); setOfficialChecked([]) }}>取消分析</button>}
          <button disabled={busy || dirty} onClick={() => { setBusy(true); void request('/official-restore', { method: 'POST', body: '{}' }).then(async () => { await load(); notify('success', '已恢复上次同步前的配置。') }).catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>恢复上次同步</button></div>
        <OfficialProgressStatus progress={officialProgress} />
        {officialError && <p className="dmm-error" role="alert">{officialError}</p>}
        {dirty && <p className="dmm-note">有未保存的插件草稿。应用或恢复前，请先保存或重新加载放弃草稿，再刷新预览。</p>}
        {official && <>
          <p>官方当前 <strong>{official.analysis.models.length}</strong> 个模型 · 本地 {official.localModelIds.length} 个 · 选中操作后预计 {official.catalog?.counts.find(c => c.providerId === 'deepseek-official')?.after ?? predictedModelCount(official, officialChecked)} 个 · 差异 {official.diffs.length} 项</p>
          <p className="dmm-muted">抓取时间：{official.fetchedAt}；分析模型：{official.analyzer.providerId}/{official.analyzer.modelId}；推理档位：{official.reasoningEffort ?? '模型默认'}；每轮分析时限：{official.analysisTimeoutSeconds} 秒。完整性由 LLM 判断，请核对原文；不代表当前账号调用验证。</p>
          {official.analysis.models.map(model => <div key={model.id}><strong>{model.id}</strong>{model.name ? ` · ${model.name}` : ''}{model.evidence.map((item, index) => <p className="dmm-muted" key={index}><a href={item.source} target="_blank" rel="noreferrer">依据网页</a>：{item.quote}</p>)}</div>)}
          <details><summary>实际读取页面与完整性依据</summary>{official.pages.map(page => <p key={page.url}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · {page.fetchedAt}</p>)}{official.analysis.completenessEvidence.map((item, index) => <p key={index}>{item.quote}</p>)}{official.notes.map((note, index) => <p key={`note-${index}`}>{note}</p>)}</details>
          {official.catalog && <CatalogPreviewPanel view={official.catalog} selected={officialChecked} busy={busy} onResolve={(selected, resolutions) => { void resolveOfficial(selected, resolutions) }} />}
          {official.diffs.map(diff => <div className="dmm-card" key={diff.id}><label>{!official.catalog && <input type="checkbox" disabled={!!diff.blockedReasons.length || busy} checked={officialChecked.includes(diff.id)} onChange={event => setOfficialChecked(current => event.target.checked ? [...current, diff.id] : current.filter(id => id !== diff.id))} />}{{ name: '名称更新', inputModalities: '图片能力更新', contextWindow: '上下文更新', addModel: '新增模型', migrateModel: '合并迁移', removeModel: '移除旧模型' }[diff.field]}：<strong>{diff.modelId}</strong>（原文证据）</label>
            <p className="dmm-muted">{diff.reason}</p>
            {diff.field === 'migrateModel' ? <p>{(diff.before as string[]).join('、')} → {diff.modelId}（创建／合并目标、迁移引用、移除旧入口）</p> : diff.field !== 'addModel' && diff.field !== 'removeModel' ? <p>{JSON.stringify(diff.before)} → {JSON.stringify(diff.after)}</p> : null}
            {diff.references.length > 0 && <details><summary>涉及 {diff.references.length} 处引用</summary>{diff.references.map(path => <p key={path}>{path}</p>)}</details>}
            {!official.catalog && diff.blockedReasons.map(reason => <p className="dmm-error" key={reason}>{reason}；请调整后重新预览。</p>)}
            {diff.evidence.map((item, index) => <p className="dmm-muted" key={index}><a href={item.source} target="_blank" rel="noreferrer">依据网页</a>：{item.quote}</p>)}
          </div>)}
          {!official.diffs.length && <p className="dmm-muted">当前官方模型清单及有证据的声明已一致。</p>}
          <button className="dmm-primary" disabled={busy || dirty || !officialChecked.length} onClick={() => void applyOfficial()}>应用选中差异</button>
        </>}
      </div>
      <CatalogManager backupWritesPlugin={snapshot.catalogBackupWritesPlugin} backupId={snapshot.catalogBackupId} externalBusy={busy} models={snapshot.models} capabilities={snapshot.catalogCapabilities ?? []} editor={catalogEditor} setEditor={editor => { setCatalogEditor(editor); setOfficial(null); setOfficialChecked([]); document.getElementById('dmm-catalog-editor')?.scrollIntoView({ block: 'nearest' }) }} dirty={dirty} notify={notify} onApplied={value => {
        const next = asSnapshot(value); setSnapshot(next); if (!dirty) setDraft(structuredClone(next.config)); setOfficial(null); setOfficialChecked([]); window.dispatchEvent(new Event('dmm:config'))
      }} />
      <ParameterPanel models={snapshot.models} config={snapshot.config} revision={snapshot.revision} defaultModel={snapshot.hostDefault} backupId={snapshot.parameterBackupId} manualBackupId={snapshot.catalogBackupId} legacyCount={snapshot.legacyImageOverrideCount ?? 0} dirty={dirty} externalBusy={busy} onBusyChange={setBusy} notify={notify} onApplied={value => { const next = asSnapshot(value); setSnapshot(next); if (!dirty) setDraft(structuredClone(next.config)); setOfficial(null); setOfficialChecked([]); window.dispatchEvent(new Event('dmm:config')) }} onCredentialSaved={value => { const next = asSnapshot(value); draftRevision.current=next.revision; setSnapshot(next); setDraft(current => current && { ...current, parameterCompletion: structuredClone(next.config.parameterCompletion) }); setOfficial(null); setOfficialChecked([]) }} />
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
              <div className="dmm-row"><button disabled={busy || !snapshot.catalogCapabilities?.find(c => c.providerId === model.providerId)?.canRename} onClick={() => { document.getElementById('dmm-catalog-editor')?.scrollIntoView({ block: 'start' }); setCatalogEditor({ kind: 'rename', model }); setOfficial(null) }}>修改显示名称</button><button disabled={busy || !snapshot.catalogCapabilities?.find(c => c.providerId === model.providerId)?.canRemove} onClick={() => { document.getElementById('dmm-catalog-editor')?.scrollIntoView({ block: 'start' }); setCatalogEditor({ kind: 'remove', model }); setOfficial(null) }}>删除模型</button>{snapshot.catalogCapabilities?.find(c => c.providerId === model.providerId)?.reason && <span className="dmm-muted">{snapshot.catalogCapabilities.find(c => c.providerId === model.providerId)?.reason}</span>}</div>
              <div className="dmm-row">原生图片：{model.nativeImage}；上下文：{model.contextWindow ?? '未知'}；默认输出：{model.defaultMaxTokens ?? '未知'}；推理档位：{model.reasoningEfforts.map(e => e.id).join(' / ') || '模型默认'}；默认推理：{model.defaultReasoningEffort ?? '由来源决定'}；图片声明：{model.nativeDeclaration==='saved'?'来源的已保存覆盖':'来源默认'}</div>
              <div className="dmm-muted">资料：{model.capabilitySource ?? '未知'}{model.capabilityCheckedAt ? ` · 核对于 ${model.capabilityCheckedAt}` : ''}</div>
              <div className="dmm-muted">{snapshot.verifications.filter(item => item.model.providerId === model.providerId && item.model.modelId === model.modelId).map(item => `${item.kind}: ${item.status} / ${item.behavior ?? '未知'}${item.stale ? '（已过期）' : ''}`).join('；') || '尚无验证证据'}</div>
              <NativeEditor model={model} revision={model.nativeRevision ?? snapshot.nativeRevision} refresh={async () => { await refreshDirectory(true) }} notify={notify} />
              <div className="dmm-row">
                <button disabled={busy || probing !== ''} onClick={() => void probeOne(model)}>{probing === `${model.providerId}:${model.modelId}` ? '验证中…' : '验证图片能力'}</button>
                <button disabled={busy} onClick={() => { setBusy(true); void verifyOne({ providerId: model.providerId, modelId: model.modelId }, 'text').catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证文字</button>
                <button disabled={busy} onClick={() => { setBusy(true); void verifyOne({ providerId: model.providerId, modelId: model.modelId }, 'image').catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证图片</button>
                <button disabled={busy} onClick={() => { setBusy(true); void verifyOne({ providerId: model.providerId, modelId: model.modelId }, 'tools').catch(error => notify('error', String(error))).finally(() => setBusy(false)) }}>验证工具</button>
              </div>
            </div>)}
          </div>}
        </div>
      })}
      {!groups.length && <div className="dmm-card dmm-empty dmm-muted">没有匹配的模型。调整筛选条件，或点「清除筛选」查看全部 {snapshot.models.length} 个模型。</div>}
      {verifyResult && !preview && <details className="dmm-card"><summary className="dmm-composer">查看最近一次验证的原始证据</summary><pre>{JSON.stringify(verifyResult, null, 2)}</pre></details>}
    </>}
    {tab === '别名与兜底' && <>
      <AliasHealthPanel />
      <details className="dmm-guide">
        <summary>这一页是干什么的？（点开查看说明）</summary>
        <p style={{ margin: '6px 0', fontSize: 13 }}>别名 = 好记的名字 + 一串按顺序兜底的具体模型：</p>
        <ul className="dmm-steps">
          <li><strong>候选顺序即兜底顺序</strong>：第 1 个请求失败时按规则尝试第 2 个；模型选择器、AUTO 执行档和视觉模型处都能引用 @名字。</li>
          <li><strong>推理档位</strong>：每个候选模型只显示自己支持的真实档位；留空使用模型默认。</li>
          <li><strong>固定恢复规则</strong>：临时故障每候选最多 5 次，其他错误立即切换；不受三次总上限限制。成功后显示完整回答，已完成的工具操作不重做。</li>
          <li><strong>内置别名 @long-context</strong>：供具体模型上下文溢出时使用；其他别名需要自行添加长上下文候选。</li>
        </ul>
      </details>
      <div className="dmm-card"><div className="dmm-row"><input placeholder="别名，如 fast" value={aliasName} onChange={event => setAliasName(event.target.value)} /><button onClick={() => { if (!/^[a-z][a-z0-9_-]*$/.test(aliasName) || draft.aliases[aliasName]) return; edit(next => { next.aliases[aliasName] = { candidates: [] } }); setAliasName('') }}>添加别名</button></div><p className="dmm-muted">候选按顺序尝试；每个别名至少添加一个具体模型后才能保存。</p></div>
      <AliasRemovalManager key={removingAlias ?? 'restore'} name={removingAlias} close={() => setRemovingAlias(null)} dirty={dirty} externalBusy={busy} onBusyChange={setBusy} backupId={snapshot.catalogBackupId} notify={notify} onApplied={value => { const next = asSnapshot(value); draftRevision.current=next.revision; setSnapshot(next); setDraft(structuredClone(next.config)); setOfficial(null); setOfficialChecked([]); window.dispatchEvent(new Event('dmm:config')) }} />
      <LegacyPreferencesManager config={snapshot.config} aliasCount={snapshot.legacyAliasReliabilityCount ?? 0} dirty={dirty} externalBusy={busy} onBusyChange={setBusy} backupId={snapshot.catalogBackupId} notify={notify} onApplied={value => { const next = asSnapshot(value); draftRevision.current=next.revision; setSnapshot(next); setDraft(structuredClone(next.config)); setOfficial(null); setOfficialChecked([]); window.dispatchEvent(new Event('dmm:config')) }} />
      {aliases.map(alias => <AliasCard key={alias} name={alias} draft={draft} models={snapshot.models} edit={edit} notify={notify} removeAlias={name => { if (busy) return; if (!Object.hasOwn(snapshot.config.aliases, name)) { edit(next => { delete next.aliases[name] }); return }; setRemovingAlias(name); setOfficial(null); setCatalogEditor(null); document.getElementById('dmm-alias-removal')?.scrollIntoView({ block: 'nearest' }) }} />)}
      <div className="dmm-card">
        <strong>具体模型恢复策略</strong>
        <p className="dmm-muted">仅用于最终目标为具体模型的受管理请求，不控制别名。别名使用上面的固定恢复规则；实际调用可去「日志」页核对。</p>
        <div className="dmm-row">
          <label>最多实际尝试（1–3） <input type="number" min="1" max="3" value={draft.reliability.maxAttempts} onChange={event => edit(next => { next.reliability.maxAttempts = Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={draft.reliability.retryTransient} onChange={event => edit(next => { next.reliability.retryTransient = event.target.checked })} />网络失败重试一次</label>
          <label><input type="checkbox" checked={draft.reliability.parameterDowngrade} onChange={event => edit(next => { next.reliability.parameterDowngrade = event.target.checked })} />允许推理参数被拒时降级</label>
        </div>
        <p className="dmm-muted">已有输出不会重播；认证错误跳过同 Provider，429 暂时冷却；本轮明确指定的参数不会被静默降级。上下文溢出只尝试内置别名 @long-context 的候选。</p>
      </div>
    </>}
    {<div hidden={tab !== 'AUTO 自动选模型'}>
      <AutoTab draft={draft} models={snapshot.models} aliases={aliases} edit={edit} notify={notify} />
      <LegacyPreferencesManager config={snapshot.config} dirty={dirty} externalBusy={busy} onBusyChange={setBusy} backupId={snapshot.catalogBackupId} notify={notify} onApplied={value => { const next = asSnapshot(value); draftRevision.current=next.revision; setSnapshot(next); setDraft(structuredClone(next.config)); setOfficial(null); setOfficialChecked([]); window.dispatchEvent(new Event('dmm:config')) }} />
    </div>}
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
      <span className="dmm-muted">「保存设置」把全部标签页的插件配置写入 DSH，下一次请求生效；模型卡片里的「保存到宿主」是另一件事：写入模型来源拥有的声明。</span>
    </div>
    <div className="dmm-toasts">{notices.map(item => <div key={item.id} className={`dmm-toast dmm-toast-${item.kind}`} role="status"><span>{item.text}</span><button aria-label="关闭提示" onClick={() => dismiss(item.id)}>×</button></div>)}</div>
    {preview && <div className="dmm-modal-mask" onClick={() => { if (!busy) setPreview(null) }} role="presentation">
      <div className="dmm-modal" role="dialog" aria-modal="true" aria-label={preview.title} onClick={event => event.stopPropagation()}>
        <h3>{preview.title}</h3>
        {preview.failure && <p className="dmm-error">{preview.failure}</p>}
        {preview.applied && <p className="dmm-note">已应用：宿主声明 {preview.applied.hostApplied} 项{preview.applied.skipped ? `，${preview.applied.skipped} 项因宿主不可写被跳过` : ''}。</p>}
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

export function apply(ctx: any): void {
  injectStyle()
  ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'dsh-model-manager',label:'模型管理',inject:()=>({ctx})},(props:any)=>props.view==='summary' ? <p>管理模型来源、备用候选、AUTO 与图片辅助。</p> : <PanelBoundary><ManagerSection ctx={ctx}/></PanelBoundary>))
}
