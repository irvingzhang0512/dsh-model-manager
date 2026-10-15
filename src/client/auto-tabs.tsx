import { hostRouteUrl } from "./transport.js"
import React, { useEffect, useState } from 'react'
import type { ManagerConfig, ModelRecord, ModelRef, Selection, TaskGrade } from '../domain.js'

type Edit = (fn: (next: ManagerConfig) => void) => void
type Props = { draft: ManagerConfig; models: ModelRecord[]; aliases: string[]; edit: Edit; notify: (kind: 'info' | 'success' | 'error', text: string) => void }
const labels: Record<TaskGrade, string> = { simple: '简单任务', normal: '常规任务', complex: '复杂任务' }
const grades: TaskGrade[] = ['simple', 'normal', 'complex']
const types = {coding:'编码',writing:'写作',research:'调研',analysis:'分析',general:'通用'} as const

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(hostRouteUrl(`/api/model-manager${path}`), { headers: { 'Content-Type': 'application/json' }, ...init })
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
  const missing = value && (typeof value === 'string' ? !aliases.includes(value.slice(1)) : !models.some(model => key(model) === key(value)))
  return <select value={typeof value === 'string' ? value : value ? key(value) : ''} onChange={event => onChange(parse(event.target.value))}>
    <option value="">未设置</option>{aliases.map(alias => <option key={alias} value={`@${alias}`}>@{alias}</option>)}
    {missing && <option value={typeof value === 'string' ? value : key(value)}>{typeof value === 'string' ? value : `${value.providerId}/${value.modelId}`}（失效：别名未绑定或模型未加载）</option>}
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
      <label>评估推理档位 <Effort selection={{target:draft.auto.evaluator,reasoningEffort:draft.auto.evaluatorReasoningEffort}} draft={draft} models={models} onChange={value=>edit(next=>{next.auto.evaluatorReasoningEffort=value})} /></label>
      <span className="dmm-muted">只判断任务难度。评估超时或无效时使用常规档。</span></div></div>
    {grades.map(grade => <div className="dmm-card" key={grade}><strong>{labels[grade]}</strong><div className="dmm-row"><label>执行模型 <Pick value={draft.auto[grade].target} models={models} aliases={aliases} onChange={value => edit(next => { next.auto[grade].target = value; next.auto[grade].reasoningEffort = undefined })} /></label>
      <label>推理档位 <Effort selection={draft.auto[grade]} draft={draft} models={models} onChange={value => edit(next => { next.auto[grade].reasoningEffort = value })} /></label>
      <label>输出上限 <input type="number" min="1" placeholder="使用模型默认" value={draft.auto[grade].maxOutputTokens ?? ''} onChange={event => edit(next => { next.auto[grade].maxOutputTokens = event.target.value ? Number(event.target.value) : undefined })} /></label></div></div>)}
    <div className="dmm-card"><strong>任务规则（按顺序优先匹配）</strong><p className="dmm-muted">首个匹配且满足能力要求的规则生效；没有可用规则时使用三档配置，并向更高档尝试。</p>
      {(draft.auto.rules ?? []).map((rule,index)=><div className="dmm-card" key={rule.id}><div className="dmm-row"><label><input type="checkbox" checked={rule.enabled} onChange={e=>edit(next=>{next.auto.rules![index].enabled=e.target.checked})}/>启用</label><input aria-label="规则名称" value={rule.name} onChange={e=>edit(next=>{next.auto.rules![index].name=e.target.value})}/><button disabled={!index} onClick={()=>edit(next=>{const list=next.auto.rules!;[list[index-1],list[index]]=[list[index],list[index-1]]})}>上移</button><button disabled={index===(draft.auto.rules?.length??0)-1} onClick={()=>edit(next=>{const list=next.auto.rules!;[list[index+1],list[index]]=[list[index],list[index+1]]})}>下移</button><button onClick={()=>edit(next=>{next.auto.rules!.splice(index,1)})}>删除规则</button></div>
        <div className="dmm-row">{Object.entries(types).map(([value,label])=><label key={value}><input type="checkbox" checked={rule.taskTypes.includes(value as keyof typeof types)} onChange={e=>edit(next=>{const r=next.auto.rules![index];r.taskTypes=e.target.checked?[...r.taskTypes,value as keyof typeof types]:r.taskTypes.filter(t=>t!==value)})}/>{label}</label>)}</div><div className="dmm-row"><span>复杂度（全不选表示不限）</span>{grades.map(value=><label key={value}><input type="checkbox" checked={rule.grades?.includes(value)??false} onChange={e=>edit(next=>{const r=next.auto.rules![index];const list=e.target.checked?[...(r.grades??[]),value]:(r.grades??[]).filter(g=>g!==value);r.grades=list.length?list:undefined})}/>{labels[value]}</label>)}</div>
        <div className="dmm-row"><Pick value={rule.selection.target} models={models} aliases={aliases} onChange={value=>edit(next=>{next.auto.rules![index].selection={...rule.selection,target:value,reasoningEffort:undefined}})}/><Effort selection={rule.selection} draft={draft} models={models} onChange={value=>edit(next=>{next.auto.rules![index].selection.reasoningEffort=value})}/><label>输出上限 <input type="number" min="1" placeholder="使用模型默认" value={rule.selection.maxOutputTokens??''} onChange={e=>edit(next=>{next.auto.rules![index].selection.maxOutputTokens=e.target.value?Number(e.target.value):undefined})}/></label></div></div>)}
      <button onClick={()=>edit(next=>{next.auto.rules??=[];next.auto.rules.push({id:crypto.randomUUID(),name:'新任务规则',enabled:false,taskTypes:['coding'],selection:{}})})}>添加任务规则</button>
    </div>
    <div className="dmm-card"><strong>生成配置建议</strong><p className="dmm-muted">单独选择推荐模型，根据当前目录生成三个执行档的草案。应用后仍需保存设置。</p>
      <div className="dmm-row"><Pick value={runner} models={models} aliases={[]} onChange={value => setRunner(value && typeof value !== 'string' ? value : undefined)} /><button disabled={busy || !models.length} onClick={() => void recommend()}>生成建议</button></div>
      {suggestion && <><p className="dmm-muted">检查模型选择，确认后应用到表单。</p>{grades.map(grade => <div className="dmm-row" key={grade}><strong>{labels[grade]}</strong><Pick value={suggestion.grades[grade]?.target} models={models} aliases={aliases} onChange={value => setSuggestion(current => current && { ...current, grades: { ...current.grades, [grade]: { target: value } } })} /></div>)}
        {suggestion.notes.map((note, index) => <p className="dmm-muted" key={index}>{note}</p>)}<button onClick={() => { edit(next => { for (const grade of grades) if (suggestion.grades[grade]?.target) next.auto[grade] = { ...next.auto[grade], ...suggestion.grades[grade] } }); setSuggestion(undefined) }}>应用到表单</button></>}
    </div>
    <details className="dmm-guide"><summary>生效规则</summary><p>只在模型选择器选中 AUTO 时评估主任务。本轮工具调用复用同一次结果。子 Agent 使用 DSH 原生模型选择。旧配置在启用新 AUTO 前继续沿用旧主模型。</p></details>
  </>
}
