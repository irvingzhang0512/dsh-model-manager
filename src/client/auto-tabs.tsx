import React, { useEffect, useState } from 'react'
import type { ManagerConfig, ModelRecord, ModelRef, Selection, TaskGrade } from '../domain.js'

type Edit = (fn: (next: ManagerConfig) => void) => void
type Props = { draft: ManagerConfig; models: ModelRecord[]; aliases: string[]; edit: Edit; notify: (kind: 'info' | 'success' | 'error', text: string) => void }
const labels: Record<TaskGrade, string> = { simple: '简单任务', normal: '常规任务', complex: '复杂任务' }
const grades: TaskGrade[] = ['simple', 'normal', 'complex']

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`/api/model-manager${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}
function key(ref: ModelRef): string { return JSON.stringify([ref.providerId, ref.modelId]) }
function parse(value: string): ModelRef | string | undefined {
  if (!value) return undefined
  if (value.startsWith('@')) return value
  const [providerId, modelId] = JSON.parse(value) as [string, string]
  return { providerId, modelId }
}
function Pick({ value, models, aliases, onChange }: { value?: ModelRef | string; models: ModelRecord[]; aliases: string[]; onChange: (value?: ModelRef | string) => void }) {
  return <select value={typeof value === 'string' ? value : value ? key(value) : ''} onChange={event => onChange(parse(event.target.value))}>
    <option value="">未设置</option>{aliases.map(alias => <option key={alias} value={`@${alias}`}>@{alias}</option>)}
    {models.map(model => <option key={key(model)} value={key(model)}>{model.name} · {model.providerId}</option>)}
  </select>
}
function Effort({ selection, draft, models, onChange }: { selection: Selection; draft: ManagerConfig; models: ModelRecord[]; onChange: (value?: string) => void }) {
  const target = selection.target
  const refs = typeof target === 'string' ? draft.aliases[target.slice(1)]?.candidates ?? [] : target ? [target] : []
  const records = refs.map(ref => models.find(model => key(model) === key(ref))).filter((model): model is ModelRecord => !!model)
  const efforts = records.length ? records[0].reasoningEfforts.filter(e => records.every(model => model.reasoningEfforts.some(item => item.id === e.id))) : []
  return <select value={selection.reasoningEffort ?? ''} onChange={event => onChange(event.target.value || undefined)}><option value="">使用模型默认</option>
    {efforts.map(e => <option key={e.id} value={e.id}>{e.id === 'off' ? '关闭思考' : e.name}（{e.id}）</option>)}
  </select>
}

export function AutoTab({ draft, models, aliases, edit, notify }: Props) {
  const [runner, setRunner] = useState<ModelRef>()
  const [suggestion, setSuggestion] = useState<{ grades: Partial<Record<TaskGrade, Selection>>; notes: string[] }>()
  const [busy, setBusy] = useState(false)
  const recommend = async () => {
    setBusy(true)
    try { setSuggestion(await request('/recommend', { method: 'POST', body: JSON.stringify({ evaluator: runner }) })) }
    catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  return <>
    <div className="dmm-card"><div className="dmm-switch-row"><div><strong>AUTO 自动选模型</strong><span className="dmm-muted">每轮用户消息评估一次任务等级，再选择主模型。</span></div>
      <label><input type="checkbox" checked={draft.auto.enabled} onChange={event => edit(next => { next.auto.enabled = event.target.checked })} />{draft.auto.enabled ? '已开启' : '未启用'}</label></div></div>
    <div className="dmm-card"><strong>评估模型</strong><div className="dmm-row"><Pick value={draft.auto.evaluator} models={models} aliases={[]} onChange={value => edit(next => { next.auto.evaluator = value && typeof value !== 'string' ? value : undefined })} />
      <span className="dmm-muted">只判断任务难度。评估超时或无效时使用常规档。</span></div></div>
    {grades.map(grade => <div className="dmm-card" key={grade}><strong>{labels[grade]}</strong><div className="dmm-row"><label>执行模型 <Pick value={draft.auto[grade].target} models={models} aliases={aliases} onChange={value => edit(next => { next.auto[grade].target = value; next.auto[grade].reasoningEffort = undefined })} /></label>
      <label>推理档位 <Effort selection={draft.auto[grade]} draft={draft} models={models} onChange={value => edit(next => { next.auto[grade].reasoningEffort = value })} /></label>
      <label>输出上限 <input type="number" min="1" placeholder="使用模型默认" value={draft.auto[grade].maxOutputTokens ?? ''} onChange={event => edit(next => { next.auto[grade].maxOutputTokens = event.target.value ? Number(event.target.value) : undefined })} /></label></div></div>)}
    <div className="dmm-card"><strong>生成配置建议</strong><p className="dmm-muted">单独选择推荐模型，根据当前目录生成三个执行档的草案。应用后仍需保存设置。</p>
      <div className="dmm-row"><Pick value={runner} models={models} aliases={[]} onChange={value => setRunner(value && typeof value !== 'string' ? value : undefined)} /><button disabled={busy || !models.length} onClick={() => void recommend()}>生成建议</button></div>
      {suggestion && <><p className="dmm-muted">检查模型选择，确认后应用到表单。</p>{grades.map(grade => <div className="dmm-row" key={grade}><strong>{labels[grade]}</strong><Pick value={suggestion.grades[grade]?.target} models={models} aliases={aliases} onChange={value => setSuggestion(current => current && { ...current, grades: { ...current.grades, [grade]: { target: value } } })} /></div>)}
        {suggestion.notes.map((note, index) => <p className="dmm-muted" key={index}>{note}</p>)}<button onClick={() => { edit(next => { for (const grade of grades) if (suggestion.grades[grade]?.target) next.auto[grade] = { ...next.auto[grade], ...suggestion.grades[grade] } }); setSuggestion(undefined) }}>应用到表单</button></>}
    </div>
    <details className="dmm-guide"><summary>生效规则</summary><p>只在模型选择器选中 AUTO 时评估主任务。本轮工具调用复用同一次结果。子 Agent 使用 DSH 原生模型选择。旧配置在启用新 AUTO 前继续沿用旧主模型。</p></details>
  </>
}

type SubagentSettings = { revision?: number; value: { enabled: boolean; allowedModels: { provider: string; model: string }[] } }
export function SubagentsTab({ draft, models, aliases, edit, notify }: Props) {
  const [state, setState] = useState<SubagentSettings>()
  const [busy, setBusy] = useState(false)
  const load = async () => { try { setState(await request('/subagents')) } catch (error) { notify('error', String(error)) } }
  useEffect(() => { void load() }, [])
  const save = async () => {
    if (!state) return
    setBusy(true)
    try { setState(await request('/subagents', { method: 'PUT', body: JSON.stringify({ ...state.value, revision: state.revision }) })); notify('success', '已保存；新会话生效。') }
    catch (error) { notify('error', String(error)) }
    finally { setBusy(false) }
  }
  return <div className="dmm-card"><strong>DSH 原生 Subagent 模型选择</strong><p className="dmm-muted">主 Agent 可以为每个子任务选择不同模型和推理档位；修改模型范围仅对新会话生效。</p>
    {!state ? <button onClick={() => void load()}>读取当前设置</button> : <>
      <label><input type="checkbox" checked={state.value.enabled} onChange={event => setState(current => current && { ...current, value: { ...current.value, enabled: event.target.checked } })} />允许为子 Agent 选择模型</label>
      <div className="dmm-grid">{models.map(model => { const selected = state.value.allowedModels.some(item => item.provider === model.providerId && item.model === model.modelId)
        return <label key={key(model)}><input type="checkbox" checked={selected} onChange={event => setState(current => current && { ...current, value: { ...current.value, allowedModels: event.target.checked ? [...current.value.allowedModels, { provider: model.providerId, model: model.modelId }] : current.value.allowedModels.filter(item => item.provider !== model.providerId || item.model !== model.modelId) } })} />{model.name} · {model.providerId}</label> })}</div>
      <div className="dmm-row"><button className="dmm-primary" disabled={busy} onClick={() => void save()}>保存子 Agent 设置</button><button disabled={busy} onClick={() => void load()}>重新读取</button></div>
    </>}
    <details className="dmm-guide"><summary>分工偏好（可选）</summary><p>偏好会提示主 Agent，任务名称和数量仍由它决定。</p>
      {Object.entries(draft.auto.preferences).map(([duty, preference]) => <div className="dmm-row" key={duty}><input value={duty} onChange={event => edit(next => { const value = next.auto.preferences[duty]; delete next.auto.preferences[duty]; if (event.target.value) next.auto.preferences[event.target.value] = value })} /><Pick value={preference.target} models={models} aliases={aliases} onChange={value => edit(next => { next.auto.preferences[duty].target = value })} /><button onClick={() => edit(next => { delete next.auto.preferences[duty] })}>移除</button></div>)}
      <button onClick={() => edit(next => { let i = 1; while (next.auto.preferences[`任务${i}`]) i++; next.auto.preferences[`任务${i}`] = {} })}>添加偏好</button>
    </details>
  </div>
}
