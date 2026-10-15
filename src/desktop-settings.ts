import { createHash, randomInt } from 'node:crypto'
import type { ConfigEditor } from '@deepseek-ai/dsh-config-editor'
import type { SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings'

export type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
export interface SettingsDescriptor { ns: string; value: unknown; user?: unknown; base?: unknown; revision: number }
/** Internal configuration port; never calls the removed host SettingsProvider API. */
export interface SettingsProvider {
  writable?: boolean
  namespaceFor?(entryId: string): string
  get(ns: string): unknown
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  mutate(ns: string, operations: readonly SettingsPathOp[], revision: number): Promise<void>
  replace(ns: string, value: unknown, revision: number): Promise<void>
}
export function unpack(value: any): any {
  if (value && typeof value.get === 'function') return unpack(value.get())
  if (Array.isArray(value)) return value.map(unpack)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, unpack(v)]))
  return value
}
export const revisionToken = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const packages: Record<string, string> = {
  'dsh-model-manager': 'dsh-model-manager', 'llm-deepseek': '@deepseek-ai/dsh-llm-deepseek-api-key',
  'llm-pi-ai': '@deepseek-ai/dsh-llm-pi-ai', 'agent-default-model': '@deepseek-ai/dsh-agent-default-model',
  'subagent-model-selection': '@deepseek-ai/dsh-subagent-model-selection',
  'opencode-go': 'dsh-opencode-go',
}
function editPath(raw: any, path: readonly string[], value: unknown, unset: boolean): void {
  if (!path.length || path.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw Error('非法配置路径')
  let node = raw
  for (const key of path.slice(0, -1)) {
    if (node[key] === undefined) { if (unset) return; node[key] = {} }
    if (!node[key] || typeof node[key] !== 'object') throw Error('配置路径不是对象')
    node = node[key]
  }
  if (unset) delete node[path.at(-1)!]
  else node[path.at(-1)!] = structuredClone(value)
}
export class DesktopSettings implements SettingsProvider {
  readonly writable = true
  private revisions = new Map<string, { token: string; revision: number }>()
  private sequence = randomInt(1_000_000, 1_000_000_000)
  isBusy = () => false
  constructor(readonly editor: ConfigEditor, private readonly forms: SettingsForms) {}
  row(ns: string) {
    const rows = this.editor.configuration().filter(row => row.entry.options.name === (packages[ns] ?? '') || row.entry.options.id === ns)
    if (rows.length !== 1) throw Error(`配置所有者不可用或不唯一：${ns}`)
    return rows[0]
  }
  namespaceFor(entryId: string) {
    const row = this.row(entryId)
    return Object.keys(packages).find(key => packages[key] === row.entry.options.name) ?? entryId
  }
  private descriptor(ns: string): SettingsDescriptor {
    const row = this.row(ns)
    const token = revisionToken([row.entry.fiber?.uid, row.override, row.inherited])
    let current = this.revisions.get(ns)
    if (current?.token !== token) { current = { token, revision: ++this.sequence }; this.revisions.set(ns, current) }
    return { ns, value: unpack(row.entry.fiber?.config ?? {}), user: structuredClone(row.override), base: structuredClone(row.inherited), revision: current!.revision }
  }
  get(ns: string): unknown { try { return this.descriptor(ns).value } catch { return undefined } }
  describe(_options?: { redactSecrets?: boolean }): SettingsDescriptor[] {
    const names = new Set([...Object.keys(packages), ...this.editor.configuration().filter(row => row.entry.options.name?.startsWith('@deepseek-ai/dsh-llm-')).map(row => row.entry.options.id)])
    return [...names].flatMap(ns => { try { return [this.descriptor(ns)] } catch { return [] } })
  }
  async mutate(ns: string, operations: readonly SettingsPathOp[], expected: number): Promise<void> {
    const before = this.descriptor(ns), row = this.row(ns)
    if (before.revision !== expected) throw Error('SETTINGS_CONFLICT')
    if(operations.some(op=>!op.path.length || op.path.some(key=>['__proto__','constructor','prototype'].includes(key)))) throw Error('非法配置路径')
    const allowed: Record<string, string[]> = {
      'llm-deepseek': ['models', 'baseURL', 'apiKeyEnv'], 'llm-pi-ai': ['providers'], 'agent-default-model': ['provider', 'model', 'reasoningEffort'],
      'subagent-model-selection': ['allowedModels'],
    }
    for (const op of operations) if (ns !== 'dsh-model-manager' && !allowed[ns]?.includes(op.path[0])) throw Error('该配置字段未公开可写')
    const live = this.forms.describe({ redactSecrets: true }).find(d => d.ns === row.entry.options.id)
    if (live && (ns==='dsh-model-manager' || operations.every(op=>Object.hasOwn(live.value ?? {},op.path[0])))) { if (this.descriptor(ns).revision !== expected) throw Error('SETTINGS_CONFLICT'); await this.forms.mutate(live.ns, operations, live.revision); this.descriptor(ns); return }
    if (this.isBusy()) throw Error('请先停止正在运行的模型任务，再修改来源配置')
    const token = this.revisions.get(ns)!.token
    await this.editor.edit(row.entry, (current, inherited) => {
      if (revisionToken([row.entry.fiber?.uid, current, inherited]) !== token) throw Error('SETTINGS_CONFLICT')
      const next = structuredClone(current)
      for (const op of operations) editPath(next, op.path, op.op === 'set' ? op.value : undefined, op.op === 'unset')
      return next
    })
    this.descriptor(ns)
  }
  async replace(ns: string, value: unknown, expected: number): Promise<void> {
    if (ns !== 'dsh-model-manager') throw Error('禁止替换整个来源配置')
    const before = this.descriptor(ns)
    const raw = (before.user ?? {}) as Record<string, unknown>, next = value as Record<string, unknown>
    const keys = new Set([...Object.keys(raw), ...Object.keys(next)])
    await this.mutate(ns, [...keys].map(key => Object.hasOwn(next, key) ? { op: 'set', path: [key], value: next[key] } : { op: 'unset', path: [key] }), expected)
  }
}

const bridges = new WeakMap<ConfigEditor, DesktopSettings>()
function ownerBridge(ctx: { configEditor: ConfigEditor; settings: SettingsForms }) {
  let bridge = bridges.get(ctx.configEditor)
  if (!bridge) { bridge = new DesktopSettings(ctx.configEditor, ctx.settings); bridges.set(ctx.configEditor, bridge) }
  return bridge
}
export function describeOwners(ctx: { configEditor: ConfigEditor; settings: SettingsForms }) {
  const bridge = ownerBridge(ctx)
  return bridge.describe().map(d => ({ owner: d.ns, entryId: bridge.row(d.ns).entry.options.id, revisionToken: String(d.revision), writable: true, applies: d.ns === 'dsh-model-manager' ? 'live' : 'reload', fields: [] }))
}
export async function applyOwner(ctx: { configEditor: ConfigEditor; settings: SettingsForms }, entryId: string, expectedRevisionToken: string, operations: readonly SettingsPathOp[]) {
  const bridge = ownerBridge(ctx)
  const canonical = bridge.describe().find(d => bridge.row(d.ns).entry.options.id === entryId)?.ns
  if (!canonical) throw Error('配置所有者不可用')
  await bridge.mutate(canonical, operations, Number(expectedRevisionToken))
  return describeOwners(ctx).find(owner => owner.entryId === entryId)
}
