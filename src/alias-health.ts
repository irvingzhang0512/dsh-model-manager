import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { modelKey, type AliasRecovery, type ModelRef } from './domain.js'

export interface AliasHealthEntry { alias: string; model: ModelRef; signature: string; kind: 'transient' | 'rate-limit' | 'quota' | 'auth'; failedAt: number; retryAt?: number }
interface State { version: 1; revision: number; entries: AliasHealthEntry[] }
export const DEFAULT_RECOVERY = { transientCooldownSeconds: 60, rateLimitCooldownSeconds: 300, quotaCooldownSeconds: 3600 }
export function recoveryFailure(failure: LlmFailure): AliasHealthEntry['kind'] | undefined {
  if (failure.code === 'QUOTA') return 'quota'
  if (failure.code === 'RATE_LIMIT' || failure.status === 429) return 'rate-limit'
  if (['AUTH','INVALID_CREDENTIAL','MISSING_CREDENTIAL'].includes(failure.code) || failure.status === 401 || failure.status === 403) return 'auth'
  if (['NETWORK','TRANSPORT','TIMEOUT','SERVER','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].includes(failure.code) || failure.status === 408 || (failure.status ?? 0) >= 500) return 'transient'
  return undefined
}
export class AliasHealthStore {
  private leases = new Map<string, string>()
  private tickets = new Map<string, string>()
  private signatures=new Map<string,string>()
  private closed = false
  private warning?: string
  private primaryValid = false
  private state: State = { version: 1, revision: 0, entries: [] }
  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {}
  private get file() { return join(this.dir, 'alias-health.json') }
  private key(alias: string, model: ModelRef) { return `${alias}:${modelKey(model)}` }
  async init() { await mkdir(this.dir, { recursive: true }); await this.read(); return this }
  private async read() {
    this.primaryValid=false
    for (const file of [this.file, `${this.file}.bak`]) {
      try {
        const value = JSON.parse(await readFile(file, 'utf8')) as State
        if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.entries) || value.entries.some(e => !e.alias || !e.model?.providerId || !e.model?.modelId || !e.signature || !['transient','rate-limit','quota','auth'].includes(e.kind) || !Number.isFinite(e.failedAt) || e.retryAt !== undefined && !Number.isFinite(e.retryAt))) throw Error('健康状态格式无效')
        this.state = value; this.primaryValid=file===this.file; return
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning = '健康状态损坏；已尝试读取备份，不可验证条目已停用。' }
    }
    this.state = { version: 1, revision: 0, entries: [] }
  }
  private async change(update: (state: State) => void) {
    if (this.closed) return
    await withFileLock(this.file, async () => {
      if(this.closed)return
      await this.read()
      const before = JSON.stringify(this.state)
      update(this.state)
      if (before === JSON.stringify(this.state)) return
      this.state.revision++
      const temp = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(this.state), { mode: 0o600 })
      if(this.primaryValid) await copyFile(this.file, `${this.file}.bak`)
      await rename(temp, this.file)
    })
  }
  snapshot() {
    return { revisionToken: String(this.state.revision), entries: this.state.entries.map(({ signature: _private, ...entry }) => ({ ...structuredClone(entry), recovering: this.leases.has(this.key(entry.alias, entry.model)) })), ...(this.warning ? { warning: this.warning } : {}) }
  }
  async retain(valid:Set<string>) { await this.change(state=>{state.entries=state.entries.filter(e=>valid.has(this.key(e.alias,e.model)))}) }
  async eligible(alias: string, model: ModelRef, signature: string) {
    this.signatures.set(this.key(alias,model),signature)
    await this.change(state => { state.entries = state.entries.filter(e => this.key(e.alias,e.model) !== this.key(alias,model) || e.signature === signature) })
    const entry = this.state.entries.find(e => e.alias === alias && modelKey(e.model) === modelKey(model))
    if (!entry) return { allowed: true }
    if (!entry.retryAt || entry.retryAt > this.now()) return { allowed: false, reason: entry.retryAt ? `冷却至 ${new Date(entry.retryAt).toISOString()}` : '凭据不可用，需更换或手动恢复' }
    return { allowed: !this.leases.has(this.key(alias,model)), reason: '另一个会话正在恢复该候选' }
  }
  claimRecovery(alias: string, model: ModelRef): string | undefined {
    const key = this.key(alias,model)
    const entry=this.state.entries.find(e=>this.key(e.alias,e.model)===key),recovering=!!entry
    if(entry && (!entry.retryAt || entry.retryAt>this.now()))return undefined
    if (this.closed || recovering && this.leases.has(key)) return undefined
    const token = randomUUID(); this.tickets.set(token, key)
    if (recovering) this.leases.set(key,token)
    return token
  }
  release(alias: string, model: ModelRef, token?: string) { const key = this.key(alias,model); if (token) this.tickets.delete(token); if (token && this.leases.get(key) === token) this.leases.delete(key) }
  async recordSuccess(alias: string, model: ModelRef, signature: string, token: string) {
    if (this.tickets.get(token) !== this.key(alias,model) || this.closed) return
    try { await this.change(state => { if(this.tickets.get(token)!==this.key(alias,model) || this.signatures.has(this.key(alias,model)) && this.signatures.get(this.key(alias,model))!==signature)return;state.entries = state.entries.filter(e => e.alias !== alias || modelKey(e.model) !== modelKey(model) || e.signature !== signature) }) }
    finally { this.release(alias,model,token) }
  }
  async recordFailure(alias: string, model: ModelRef, signature: string, failure: LlmFailure, policy: AliasRecovery, token: string) {
    if (this.tickets.get(token) !== this.key(alias,model) || this.closed) return
    const kind = recoveryFailure(failure)
    try { if (kind) await this.change(state => {
      if(this.tickets.get(token)!==this.key(alias,model) || this.signatures.has(this.key(alias,model)) && this.signatures.get(this.key(alias,model))!==signature)return
      const values = { ...DEFAULT_RECOVERY, ...policy }, failedAt = this.now()
      const seconds = kind === 'transient' ? values.transientCooldownSeconds : kind === 'quota' ? values.quotaCooldownSeconds : values.rateLimitCooldownSeconds
      const hint = failure.providerRetryAfterMs
      const ms = kind !== 'transient' && Number.isFinite(hint) && hint! > 0 && Number.isSafeInteger(failedAt + hint!) ? hint! : seconds * 1000
      state.entries = state.entries.filter(e => e.alias !== alias || modelKey(e.model) !== modelKey(model))
      state.entries.push({ alias, model: structuredClone(model), signature, kind, failedAt, ...(kind !== 'auth' ? { retryAt: failedAt + ms } : {}) })
    }) } finally { this.release(alias,model,token) }
  }
  async reset(alias: string, expectedRevisionToken: string) {
    await this.change(state => { if (String(state.revision) !== expectedRevisionToken) throw Error('SETTINGS_CONFLICT'); state.entries = state.entries.filter(e => e.alias !== alias) })
    for (const key of this.leases.keys()) if (key.startsWith(`${alias}:`)) this.leases.delete(key)
    for (const [token, key] of this.tickets) if (key.startsWith(`${alias}:`)) this.tickets.delete(token)
    return this.snapshot()
  }
  dispose() { this.closed = true; this.leases.clear(); this.tickets.clear();this.signatures.clear() }
}
export async function openAliasHealthStore(profileDataDir: string) { return new AliasHealthStore(profileDataDir).init() }
