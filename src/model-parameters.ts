import { randomUUID } from 'node:crypto'
import { canonical, type HostModel } from './official-state.js'
import { modelKey, type ModelRef } from './domain.js'
import type { CatalogIntent, CatalogPreview, CatalogState } from './catalog-types.js'
import type { OfficialEvidence, OfficialPage } from './official-types.js'

export type ParameterValueSource = 'user' | 'catalog' | 'provider-default' | 'runtime-default' | 'unknown'
export interface ParameterFieldDescriptor { field: string[]; label: string; schema: Record<string, unknown>; writable: boolean; reason?: string; effect?: string }
export interface ModelParameterTarget { model: ModelRef; name: string; api: string; writable: boolean; reason?: string; fields: ParameterFieldDescriptor[]; currentValues: Record<string, unknown>; currentSources: Record<string, ParameterValueSource> }
export interface ParameterSuggestion { id: string; model: ModelRef; field: string[]; label?: string; currentValue?: unknown; currentSource: ParameterValueSource; value?: unknown; basis: 'official' | 'knowledge' | 'unknown'; reason: string; evidence: OfficialEvidence[]; writable: boolean; blockedReason?: string; effect?: string }
export interface ParameterModelResult { model: ModelRef; status: 'ready' | 'no-change' | 'failed' | 'unsupported'; suggestions: ParameterSuggestion[]; notes: string[] }
export interface ParameterAnalysis { analyzer: ModelRef; reasoningEffort?: string; analysisTimeoutSeconds: number; searchCount: number; analysisCount: number; results: ParameterModelResult[] }
export interface ModelParameterPreview extends CatalogPreview { parameterAnalysis: ParameterAnalysis; selectedFields: string[] }
export type HostParameterCatalog = Record<string, Record<string, HostModel>>
export const fieldKey = (field: string[]) => field.join('.')
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function fieldAt(value: unknown, path: string[]): unknown { for (const key of path) value = object(value) ? value[key] : undefined; return value }
export function setField(value: Record<string, unknown>, path: string[], next: unknown): void {
  let node = value
  for (const key of path.slice(0, -1)) { if (!object(node[key])) node[key] = {}; node = node[key] as Record<string, unknown> }
  node[path.at(-1)!] = structuredClone(next)
}
const boolean = { type: 'boolean' }, integer = { type: 'integer', minimum: 1 }, string = { type: 'string', minLength: 1, maxLength: 1000 }
const enumeration = (values: string[]) => ({ type: 'string', enum: values })
export const effortLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const formats = ['openai', 'deepseek', 'openrouter', 'together', 'baseten', 'zai', 'qwen', 'chat-template', 'qwen-chat-template', 'string-thinking', 'ant-ling']
const kwargs = { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }, { type: 'null' }, { type: 'object', required: ['$var'], additionalProperties: false, properties: { $var: enumeration(['thinking.enabled', 'thinking.effort', 'thinking.budget']), omitWhenOff: boolean } }] } }
const completions = ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason', 'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs', 'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField', 'vllmPriority', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention']
const responses = ['supportsDeveloperRole', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention']
const anthropic = ['supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools']
export function compatFields(api: string): string[] {
  if (api === 'openai-completions') return completions
  if (['openai-responses', 'azure-openai-responses', 'openai-codex-responses'].includes(api)) return responses
  if (api === 'anthropic-messages') return anthropic
  if (api === 'bedrock-converse-stream') return ['supportsStrictMode']
  return []
}
export function parameterFields(ns: string, api: string): ParameterFieldDescriptor[] {
  const add = (field: string[], label: string, schema: Record<string, unknown>, effect?: string): ParameterFieldDescriptor => ({ field, label, schema, writable: true, ...(effect ? { effect } : {}) })
  const fields = [add(['name'], '显示名称', string), add(['contextWindow'], '上下文容量', integer), add(['maxTokens'], '模型最大输出', integer, '也会成为请求默认输出上限，需明确采用。')]
  if (ns === 'llm-deepseek') return [...fields, add(['description'], '模型描述', string), add(['inputModalities'], '原生输入模态', { type: 'array', items: enumeration(['text', 'image']), minItems: 1, uniqueItems: true }), add(['imagePixelBudget'], '图片像素预算', { anyOf: [integer, { const: 'low' }] }, '图片处理策略；无平台明确建议不补全。'), add(['imageMaxBytes'], '图片字节预算', integer, '图片处理策略；无平台明确建议不补全。'), add(['systemPromptUpdate'], '系统提示更新方式', { const: 'in-history' })]
  if (ns !== 'llm-pi-ai') return []
  fields.push(add(['input'], '原生输入模态', { type: 'array', items: enumeration(['text', 'image']), minItems: 1, uniqueItems: true }), add(['reasoningEfforts'], '推理档位与接口值', { anyOf: [{ const: false }, { type: 'object', minProperties: 1, additionalProperties: false, properties: Object.fromEntries(effortLevels.map(level => [level, level === 'off' ? { anyOf: [string, { type: 'null' }] } : string])) }] }, '整组映射原子应用；重新校验已有推理选择。'))
  const schemas: Record<string, Record<string, unknown>> = { maxTokensField: enumeration(['max_tokens', 'max_completion_tokens']), thinkingFormat: enumeration(formats), chatTemplateKwargs: kwargs, chatTemplateArgs: kwargs, thinkingTokenBudgetField: enumeration(['thinking_token_budget', 'thinking_budget', 'thinking_budget_tokens']), cacheControlFormat: { const: 'anthropic' }, vllmPriority: { type: 'integer' } }
  for (const key of compatFields(api)) fields.push(add(['compat', key], key, schemas[key] ?? boolean, key === 'supportsMaxOutputTokens' && api !== 'openai-responses' ? '该共享字段在 Azure／Codex 中被宿主忽略。' : undefined))
  return fields
}
function schemaValid(value: unknown, schema: Record<string, any>): boolean {
  if (Object.hasOwn(schema, 'const')) return canonical(value) === canonical(schema.const)
  if (schema.anyOf) return schema.anyOf.some((s: any) => schemaValid(value, s))
  if (schema.type === 'null') return value === null
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && (schema.minimum === undefined || value >= schema.minimum)
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.enum || schema.enum.includes(value))
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && (!schema.uniqueItems || new Set(value.map(canonical)).size === value.length) && value.every(item => schemaValid(item, schema.items))
  if (schema.type === 'object') return object(value) && Object.keys(value).length >= (schema.minProperties ?? 0) && (schema.required ?? []).every((k: string) => Object.hasOwn(value, k)) && Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && (schema.properties?.[key] ? schemaValid(item, schema.properties[key]) : schema.additionalProperties !== false && (!object(schema.additionalProperties) || schemaValid(item, schema.additionalProperties))))
  return false
}
export function validateParameterModel(model: HostModel, ns: string, api: string): void {
  for (const descriptor of parameterFields(ns, api)) {
    const value = fieldAt(model, descriptor.field)
    if (value !== undefined && !schemaValid(value, descriptor.schema)) throw new Error(`模型字段无效：${fieldKey(descriptor.field)}`)
  }
  if (typeof model.maxTokens === 'number' && typeof model.contextWindow === 'number' && model.maxTokens > model.contextWindow) throw new Error('模型最大输出不能超过上下文容量')
  if (ns === 'llm-pi-ai') {
    // 旧未知键原样保留；新建议的协议白名单在解析时严格检查。
    if (object(model.reasoningEfforts) && !Object.keys(model.reasoningEfforts).some(level => level !== 'off')) throw new Error('推理映射须包含思考档位，非推理模型用 false')
    if (object(model.reasoningEfforts) && api === 'openai-completions') {
      const compat = object(model.compat) ? model.compat : {}
      if (!compat.thinkingFormat && compat.supportsReasoningEffort === false) throw new Error('推理映射与 compat 不兼容：接口既不接受 reasoning_effort，也未声明推理格式')
      if (['chat-template', 'qwen-chat-template'].includes(String(compat.thinkingFormat)) && !compat.chatTemplateKwargs && !compat.chatTemplateArgs) throw new Error('chat-template 推理格式需同时配置模板参数')
    }
  }
}
export function describeParameterTargets(state: CatalogState, hostCatalog: HostParameterCatalog): ModelParameterTarget[] {
  return state.records.filter(record => record.loaded && record.providerId !== 'dsh-model-manager').map(record => {
    const model = { providerId: record.providerId, modelId: record.modelId }, profile = state.profiles.find(p => p.providerId === model.providerId)
    const installed = hostCatalog[model.providerId]?.[model.modelId], current = profile?.models.find(m => m.id === model.modelId)
    const effective = profile?.effective ?? {}, user = profile?.user ?? {}
    const raw = (Array.isArray(user.models) ? user.models.find((m: any) => m?.id === model.modelId) : undefined) ?? (object(user.modelOverrides) ? user.modelOverrides[model.modelId] : undefined)
    const base = profile?.base ?? {}, baseModel = (Array.isArray(base.models) ? base.models.find((m: any) => m?.id === model.modelId) : undefined) ?? (object(base.modelOverrides) ? base.modelOverrides[model.modelId] : undefined)
    const api = String(effective.api ?? installed?.api ?? (profile?.ns === 'llm-deepseek' ? 'deepseek' : 'unknown'))
    const writable = !!profile && (profile.ns === 'llm-deepseek' || profile.ns === 'llm-pi-ai' && (profile.explicit || !!installed))
    const definitions = parameterFields(profile?.ns ?? '', api)
    if (profile?.ns === 'llm-deepseek') definitions.push({ ...parameterFields('llm-pi-ai', '').find(d => d.field[0] === 'reasoningEfforts')!, writable: false, reason: '该宿主没有模型级推理映射写入入口，仅供核对。' })
    const fields = definitions.map(d => ({ ...d, writable: writable && d.writable, ...(!writable ? { reason: '该 Provider 未适配公开可写模型契约或合法目录覆盖' } : {}) }))
    const currentValues: Record<string, unknown> = {}, currentSources: Record<string, ParameterValueSource> = {}
    for (const descriptor of fields) {
      const path = descriptor.field, key = fieldKey(path), direct = fieldAt(raw, path), value = fieldAt(current, path), catalogValue = fieldAt(installed, path)
      let resolved: unknown, source: ParameterValueSource = 'unknown'
      if (direct !== undefined) { resolved = direct; source = 'user' }
      else if (fieldAt(baseModel, path) !== undefined) { resolved = value ?? fieldAt(baseModel, path); source = 'unknown' }
      else if (path[0] === 'compat' && fieldAt(effective, path) !== undefined) { resolved = fieldAt(effective, path); source = 'provider-default' }
      else if (catalogValue !== undefined) { resolved = catalogValue; source = 'catalog' }
      else if (value !== undefined && (profile?.explicit || profile?.overrides?.[model.modelId])) { resolved = value; source = 'unknown' }
      else if (['contextWindow', 'maxTokens', 'input'].includes(key) && profile?.ns === 'llm-pi-ai' && (profile.addConstraints?.declared || Object.hasOwn(hostCatalog, model.providerId))) {
        const defaultKey = { contextWindow: 'defaultContextWindow', maxTokens: 'defaultMaxTokens', input: 'defaultInput' }[key]!
        resolved = effective[defaultKey] ?? { contextWindow: 262144, maxTokens: 32768, input: ['text'] }[key]
        source = fieldAt(user, [defaultKey]) !== undefined ? 'provider-default' : 'runtime-default'
      } else if (key === 'name') resolved = record.name
      else if (key === 'contextWindow') resolved = record.contextWindow
      else if (key === 'maxTokens') resolved = record.defaultMaxTokens
      else if (['input', 'inputModalities'].includes(key) && record.nativeImage !== 'unknown') resolved = record.nativeImage === 'yes' ? ['text', 'image'] : ['text']
      if (resolved !== undefined) currentValues[key] = structuredClone(resolved)
      currentSources[key] = source
    }
    return { model, name: record.name, api, writable, ...(!writable ? { reason: '该 Provider 未适配公开可写模型契约或合法目录覆盖' } : {}), fields, currentValues, currentSources }
  })
}
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
export function validateParameterSuggestions(value: unknown, target: ModelParameterTarget, pages: OfficialPage[]): ParameterSuggestion[] {
  if (!object(value) || !Array.isArray(value.suggestions) || !Array.isArray(value.notes) || value.notes.some(n => typeof n !== 'string')) throw new Error('参数分析结果格式无效')
  const seen = new Set<string>()
  return value.suggestions.map(item => {
    if (!object(item) || !Array.isArray(item.field) || !item.field.every(k => typeof k === 'string') || !['official', 'knowledge', 'unknown'].includes(String(item.basis)) || typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('字段建议格式无效')
    const descriptor = target.fields.find(d => canonical(d.field) === canonical(item.field)), key = fieldKey(item.field as string[])
    if (!descriptor || seen.has(key)) throw new Error('非法或重复字段建议')
    seen.add(key)
    if (item.basis === 'unknown' ? Object.hasOwn(item, 'value') : !Object.hasOwn(item, 'value') || !schemaValid(item.value, descriptor.schema)) throw new Error(`字段建议值无效：${key}`)
    if (key === 'reasoningEfforts' && object(item.value) && !Object.keys(item.value).some(k => k !== 'off')) throw new Error('推理映射须包含思考档位')
    const evidence: OfficialEvidence[] = []
    if (item.basis === 'official') {
      if (!Array.isArray(item.evidence) || !item.evidence.length) throw new Error('官方建议缺少实际原文证据')
      for (const ref of item.evidence) {
        if (!object(ref) || typeof ref.source !== 'string' || typeof ref.quote !== 'string' || !normalize(ref.quote)) throw new Error('证据格式无效')
        const page = pages.find(p => p.url === ref.source)
        if (!page || !normalize(page.text).includes(normalize(ref.quote))) throw new Error('证据不存在于实际读取的官方网页')
        evidence.push({ source: ref.source, quote: normalize(ref.quote) })
      }
      const identity = new RegExp(`(^|[^\\p{L}\\p{N}_/.-])${target.model.modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_/.-])`, 'u')
      if (!evidence.some(e => identity.test(e.quote))) throw new Error('官方证据缺少本平台精确模型 ID')
    } else if (Array.isArray(item.evidence) && item.evidence.length) throw new Error('知识或未知建议不能伪造官方引文')
    return { id: randomUUID(), model: target.model, field: descriptor.field, label: descriptor.label, ...(Object.hasOwn(item, 'value') ? { value: structuredClone(item.value) } : {}), ...(Object.hasOwn(target.currentValues, key) ? { currentValue: structuredClone(target.currentValues[key]) } : {}), currentSource: target.currentSources[key] ?? 'unknown', basis: item.basis as ParameterSuggestion['basis'], reason: item.reason, evidence, writable: descriptor.writable, blockedReason: descriptor.reason, effect: descriptor.effect }
  })
}
export function defaultParameterFields(analysis: ParameterAnalysis): string[] {
  return analysis.results.flatMap(r => r.suggestions.filter(s => s.writable && s.basis === 'official' && s.value !== undefined && canonical(s.value) !== canonical(s.currentValue) && !['maxTokens', 'name', 'imagePixelBudget', 'imageMaxBytes'].includes(s.field[0]) && (s.currentValue === undefined || ['runtime-default', 'provider-default'].includes(s.currentSource))).map(s => s.id))
}
export function parameterIntents(state: CatalogState, analysis: ParameterAnalysis, selectedFields: string[]): CatalogIntent[] {
  const suggestions = analysis.results.flatMap(r => r.suggestions)
  if (new Set(selectedFields).size !== selectedFields.length || selectedFields.some(id => !suggestions.some(s => s.id === id && s.writable && s.value !== undefined && s.basis !== 'unknown'))) throw new Error('选中字段无效、重复或不可写')
  const groups = new Map<string, CatalogIntent>()
  for (const suggestion of suggestions.filter(s => selectedFields.includes(s.id) && canonical(s.currentValue) !== canonical(s.value))) {
    const key = modelKey(suggestion.model), profile = state.profiles.find(p => p.providerId === suggestion.model.providerId)
    if (!profile?.models.some(m => m.id === suggestion.model.modelId)) throw new Error('模型目录已变化')
    let intent = groups.get(key)
    if (!intent) { intent = { id: key, kind: 'update', model: suggestion.model, value: { id: suggestion.model.modelId }, parameter: true }; groups.set(key, intent) }
    if ('value' in intent) {
      setField(intent.value!, suggestion.field, suggestion.value)
      if (suggestion.field[0] === 'name') intent.parameterNameBasis = suggestion.basis as 'official' | 'knowledge'
    }
  }
  return [...groups.values()]
}
