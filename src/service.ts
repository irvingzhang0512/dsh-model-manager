import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { DEFAULT_CONFIG, mergeSelection, modelKey, resolveSelection, validateConfig, type ManagerConfig, type ModelRecord, type ModelRef, type Selection, type Verification } from './domain.js'

export interface ModelBridge {
  catalog(): Promise<ModelRecord[]>
  applyNative(ref: ModelRef, fields: { image?: boolean; contextWindow?: number; maxTokens?: number }, revision: number): Promise<void>
  clearNative?(ref: ModelRef, fields: readonly ('image' | 'contextWindow' | 'maxTokens')[], revision: number): Promise<void>
}

/** 探测时需要精确读写模型的 input 模态声明：读原值、写临时值、按原值恢复（undefined 表示删除该字段）。 */
export interface ModelInputBridge {
  modelInput(ref: ModelRef): readonly string[] | undefined
  setInput(ref: ModelRef, input: readonly string[] | undefined, revision: number): Promise<void>
  currentRevision(): number | undefined
}

export class HostModelBridge implements ModelBridge {
  constructor(private readonly llm: LlmRuntime, private readonly settings: SettingsProvider) {}

  async catalog(): Promise<ModelRecord[]> {
    const providers = this.llm.listProviders().filter(p => p.id !== 'dsh-model-manager')
    const writable = new Set(this.llm.listConfigurableProviders().filter(p => p.settingsNs === 'llm-pi-ai').map(p => p.provider))
    const configured = this.settings.get('llm-pi-ai') as { providers?: Record<string, { models?: { id: string }[] }> } | undefined
    const result = await Promise.all(providers.map(async provider => {
      const models = await this.llm.listModels(provider.id).catch(() => [])
      return Promise.all(models.map(async model => {
        const info = await this.llm.resolveModelInfo(provider.id, model.id).catch(() => model)
        const canWrite = writable.has(provider.id) && (!configured?.providers?.[provider.id]?.models?.length || configured.providers[provider.id].models!.some(item => item.id === model.id))
        return {
          providerId: provider.id, modelId: model.id, name: model.name,
          nativeImage: info.inputModalities ? info.inputModalities.includes('image') ? 'yes' as const : 'no' as const : 'unknown' as const,
          reasoningEfforts: 'reasoning' in info && info.reasoning ? info.reasoning.efforts.map(e => ({ id: e.id as string, name: e.name })) : [],
          contextWindow: 'context' in info ? info.context?.contextWindow : undefined,
          defaultMaxTokens: 'defaultMaxTokens' in info ? info.defaultMaxTokens : undefined,
          source: 'host' as const, loaded: true,
          nativeEditable: canWrite,
          nativeClearable: canWrite && !configured?.providers?.[provider.id]?.models?.length,
          nativeEditReason: canWrite ? undefined : writable.has(provider.id) ? '模型不在 Provider 的可编辑配置清单中' : '该 Provider 未公开可写模型字段',
        }
      }))
    }))
    return result.flat()
  }

  async applyNative(ref: ModelRef, fields: { image?: boolean; contextWindow?: number; maxTokens?: number }, revision: number): Promise<void> {
    const entry = this.llm.listConfigurableProviders().find(p => p.provider === ref.providerId)
    if (!entry || entry.settingsNs !== 'llm-pi-ai') throw new Error('该 Provider 未公开可写模型字段')
    const section = this.settings.get('llm-pi-ai') as { providers?: Record<string, { models?: { id: string }[] }> } | undefined
    const profile = section?.providers?.[ref.providerId]
    const fieldPath = ['providers', ref.providerId, 'modelOverrides', ref.modelId]
    const ops: { op: 'set'; path: string[]; value: unknown }[] = []
    const values = { ...(fields.image !== undefined ? { input: fields.image ? ['text', 'image'] : ['text'] } : {}),
      ...(fields.contextWindow !== undefined ? { contextWindow: fields.contextWindow } : {}),
      ...(fields.maxTokens !== undefined ? { maxTokens: fields.maxTokens } : {}) }
    if (profile?.models?.length) {
      const index = profile.models.findIndex(m => m.id === ref.modelId)
      if (index < 0) throw new Error('模型不在该 Provider 的配置清单中')
      const models = structuredClone(profile.models)
      models[index] = { ...models[index], ...values }
      ops.push({ op: 'set', path: ['providers', ref.providerId, 'models'], value: models })
    } else {
      for (const [field, value] of Object.entries(values)) ops.push({ op: 'set', path: [...fieldPath, field], value })
    }
    if (ops.length) await this.settings.mutate('llm-pi-ai', ops, revision)
  }

  async clearNative(ref: ModelRef, fields: readonly ('image' | 'contextWindow' | 'maxTokens')[], revision: number): Promise<void> {
    const entry = this.llm.listConfigurableProviders().find(p => p.provider === ref.providerId)
    if (!entry || entry.settingsNs !== 'llm-pi-ai') throw new Error('该 Provider 未公开可写模型字段')
    const section = this.settings.get('llm-pi-ai') as { providers?: Record<string, { models?: { id: string }[] }> } | undefined
    if (section?.providers?.[ref.providerId]?.models?.length) throw new Error('此 Provider 使用显式模型清单，无法安全地清除字段覆盖')
    const names = { image: 'input', contextWindow: 'contextWindow', maxTokens: 'maxTokens' } as const
    await this.settings.mutate('llm-pi-ai', fields.map(field => ({ op: 'unset' as const, path: ['providers', ref.providerId, 'modelOverrides', ref.modelId, names[field]] })), revision)
  }

  /** 读取模型当前生效的 input 模态声明：显式清单优先，其次 modelOverrides；undefined 表示未显式声明。 */
  modelInput(ref: ModelRef): readonly string[] | undefined {
    const section = this.settings.get('llm-pi-ai') as { providers?: Record<string, { models?: { id: string; input?: string[] }[]; modelOverrides?: Record<string, { input?: string[] }> }> } | undefined
    const profile = section?.providers?.[ref.providerId]
    if (profile?.models?.length) return profile.models.find(item => item.id === ref.modelId)?.input
    return profile?.modelOverrides?.[ref.modelId]?.input
  }

  /** 精确设置或删除 input 模态声明；恢复探测前的原值时使用。 */
  async setInput(ref: ModelRef, input: readonly string[] | undefined, revision: number): Promise<void> {
    const entry = this.llm.listConfigurableProviders().find(p => p.provider === ref.providerId)
    if (!entry || entry.settingsNs !== 'llm-pi-ai') throw new Error('该 Provider 未公开可写模型字段')
    const section = this.settings.get('llm-pi-ai') as { providers?: Record<string, { models?: { id: string }[] }> } | undefined
    const profile = section?.providers?.[ref.providerId]
    if (profile?.models?.length) {
      const index = profile.models.findIndex(item => item.id === ref.modelId)
      if (index < 0) throw new Error('模型不在该 Provider 的配置清单中')
      const models = structuredClone(profile.models) as { id: string; input?: string[] }[]
      if (input === undefined) delete models[index].input
      else models[index] = { ...models[index], input: [...input] }
      await this.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', ref.providerId, 'models'], value: models }], revision)
    } else {
      const ops = input === undefined
        ? [{ op: 'unset' as const, path: ['providers', ref.providerId, 'modelOverrides', ref.modelId, 'input'] }]
        : [{ op: 'set' as const, path: ['providers', ref.providerId, 'modelOverrides', ref.modelId, 'input'], value: [...input] }]
      await this.settings.mutate('llm-pi-ai', ops, revision)
    }
  }

  currentRevision(): number | undefined {
    return this.settings.describe({ redactSecrets: true }).find(d => d.ns === 'llm-pi-ai')?.revision
  }
}

export function resolveDataDir(profile?: string): string {
  const flag = process.argv.findIndex(arg => arg === '--profile')
  const fromArgv = flag >= 0 ? process.argv[flag + 1] : process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length)
  profile ??= process.env.DSH_PROFILE || fromArgv || 'web'
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('无效的 DSH profile 名称')
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', profile, 'data', 'dsh-model-manager')
}

async function readJsonWithBackup<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T }
  catch {
    try {
      const backup = `${path}.bak`
      const value = JSON.parse(await readFile(backup, 'utf8')) as T
      await copyFile(backup, `${path}.tmp`)
      await rename(`${path}.tmp`, path)
      return value
    } catch { return undefined }
  }
}

export class ModelManagerService {
  private config: ManagerConfig = structuredClone(DEFAULT_CONFIG)
  private revision = 0
  private models: ModelRecord[] = []
  private writeQueue: Promise<void> = Promise.resolve()
  async flush(): Promise<void> { await this.writeQueue }
  private logMaintainedAt = 0
  private verification = new Map<string, Verification>()
  private visionCache = new Map<string, { answer: string; at: number }>()
  private overrides = new Map<string, { session?: Selection; nextTurn?: Selection; active?: { turn: number; selection: Selection } }>()
  private delegatedSessions = new Set<string>()
  constructor(private readonly bridge: ModelBridge, private readonly dataDir: string, private readonly settings?: SettingsProvider) {}

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const stored = this.settings?.get('dsh-model-manager') as ManagerConfig | undefined
    if (stored) { validateConfig(stored); this.config = structuredClone(stored) }
    this.revision = this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? 0
    this.models = await this.bridge.catalog()
    const records = await readJsonWithBackup<Verification[]>(join(this.dataDir, 'verification.json'))
    if (Array.isArray(records)) for (const record of records) this.verification.set(this.verificationKey(record.model, record.kind), record)
    const savedOverrides = await readJsonWithBackup<Record<string, { session?: Selection; nextTurn?: Selection }>>(join(this.dataDir, 'overrides.json'))
    if (savedOverrides) for (const [session, value] of Object.entries(savedOverrides)) this.overrides.set(session, value)
    const savedCache = await readJsonWithBackup<Record<string, { answer: string; at: number }>>(join(this.dataDir, 'vision-cache.json'))
    if (savedCache) for (const [key, value] of Object.entries(savedCache)) if (value.at > Date.now() - 7 * 86400000) this.visionCache.set(key, value)
  }

  snapshot(): { revision: number; config: ManagerConfig; models: ModelRecord[]; verifications: (Verification & { stale: boolean })[] } {
    return { revision: this.revision, config: structuredClone(this.config), models: structuredClone(this.models),
      verifications: [...this.verification.values()].map(value => ({ ...structuredClone(value), stale: value.signature !== this.signature(value.model, value.kind) })) }
  }

  async refresh(): Promise<ModelRecord[]> {
    this.models = await this.bridge.catalog()
    return structuredClone(this.models)
  }

  async update(next: ManagerConfig, revision: number): Promise<number> {
    validateConfig(next)
    if (revision !== this.revision) throw new Error('SETTINGS_CONFLICT')
    if (this.settings) {
      await this.settings.replace('dsh-model-manager', next, revision)
      this.revision = this.settings.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? revision + 1
    } else this.revision++
    this.config = structuredClone(next)
    return this.revision
  }

  onSettingsChanged(next: ManagerConfig): void {
    validateConfig(next)
    this.config = structuredClone(next)
    this.revision = this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? this.revision + 1
  }

  model(ref: ModelRef): ModelRecord | undefined { return this.models.find(m => m.providerId === ref.providerId && m.modelId === ref.modelId) }

  /**
   * 宿主默认模型（`agent-default-model` 设置）。选择器里的 AUTO 条目在没有配置
   * Manual/Auto 目标时回退到它，避免 AUTO 落到「没有任何候选」的失败上。
   */
  hostDefault(): ModelRef | undefined {
    const value = this.settings?.get('agent-default-model') as { provider?: unknown; model?: unknown } | undefined
    if (typeof value?.provider !== 'string' || typeof value?.model !== 'string' || !value.provider || !value.model) return undefined
    return { providerId: value.provider, modelId: value.model }
  }

  getOverride(session: string): { session?: Selection; nextTurn?: Selection } {
    const value = this.overrides.get(session)
    return { session: value?.session && structuredClone(value.session), nextTurn: value?.nextTurn && structuredClone(value.nextTurn) }
  }

  async setOverride(session: string, scope: 'session' | 'nextTurn', selection?: Selection): Promise<void> {
    if (!/^[a-zA-Z0-9:_-]{1,150}$/.test(session)) throw new Error('无效会话 ID')
    if (selection?.target) {
      resolveSelection(this.config, selection.target)
    }
    const value = this.overrides.get(session) ?? {}
    const preview = { ...value, [scope]: selection }
    const global = this.config.mode === 'manual' ? this.config.manual : this.config.auto
    const effective = mergeSelection(mergeSelection(global, preview.session), preview.nextTurn)
    if (effective.thinking === 'off' && effective.tier && !['auto', 'inherit'].includes(effective.tier)) throw new Error('关闭思考不能同时选择非关闭推理档位')
    if (effective.maxOutputTokens !== undefined && (!Number.isInteger(effective.maxOutputTokens) || effective.maxOutputTokens < 1)) throw new Error('输出上限必须为正整数')
    if (selection) value[scope] = structuredClone(selection)
    else delete value[scope]
    this.overrides.set(session, value)
    const target = join(this.dataDir, 'overrides.json')
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const saved = Object.fromEntries([...this.overrides.entries()].map(([key, item]) => [key, { session: item.session, nextTurn: item.nextTurn }]))
      await writeFile(`${target}.tmp`, JSON.stringify(saved), 'utf8')
      try { await copyFile(target, `${target}.bak`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await rename(`${target}.tmp`, target)
    })
    await this.writeQueue
  }

  effectiveSelection(session: string, turn: number): Selection {
    const value = this.overrides.get(session) ?? {}
    if (!value.active || value.active.turn !== turn) {
      value.active = { turn, selection: mergeSelection(value.session ?? {}, value.nextTurn) }
      this.overrides.set(session, value)
    }
    const global = this.config.mode === 'manual' ? this.config.manual : this.config.auto
    return structuredClone(mergeSelection(global, value.active.selection))
  }

  activeSelection(session: string): Selection | undefined { return this.overrides.get(session)?.active?.selection && structuredClone(this.overrides.get(session)!.active!.selection) }
  activeTurn(session: string): number | undefined { return this.overrides.get(session)?.active?.turn }
  markDelegatedSession(session: string): void { this.delegatedSessions.add(session) }
  isDelegatedSession(session: string): boolean { return this.delegatedSessions.has(session) }

  endTurn(session: string, turn: number): void {
    const value = this.overrides.get(session)
    if (value?.active?.turn !== turn) return
    delete value.active
    if (value.nextTurn) void this.setOverride(session, 'nextTurn').catch(() => {})
  }

  signature(ref: ModelRef, kind?: Verification['kind']): string {
    const model = this.model(ref)
    const settings = this.config.models[modelKey(ref)]
    const reasoningSelection = kind === 'reasoning' ? this.config.manual : undefined
    return createHash('sha256').update(JSON.stringify({ model, settings, reasoningSelection, providerAdapterVersion: 1 })).digest('hex')
  }

  verificationKey(ref: ModelRef, kind: Verification['kind']): string { return `${modelKey(ref)}:${kind}` }
  getVerification(ref: ModelRef, kind: Verification['kind']): (Verification & { stale: boolean }) | undefined {
    const evidence = this.verification.get(this.verificationKey(ref, kind))
    return evidence && { ...evidence, stale: evidence.signature !== this.signature(ref, kind) }
  }

  getVisionCache(key: string): string | undefined { return this.visionCache.get(key)?.answer }

  async putVisionCache(key: string, answer: string): Promise<void> {
    this.visionCache.set(key, { answer, at: Date.now() })
    const target = join(this.dataDir, 'vision-cache.json')
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const current = [...this.visionCache.entries()].filter(([, value]) => value.at > Date.now() - 7 * 86400000).slice(-1000)
      this.visionCache = new Map(current)
      await writeFile(`${target}.tmp`, JSON.stringify(Object.fromEntries(current)), 'utf8')
      try { await copyFile(target, `${target}.bak`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await rename(`${target}.tmp`, target)
    })
    await this.writeQueue
  }

  async saveVerification(result: Verification): Promise<void> {
    this.verification.set(this.verificationKey(result.model, result.kind), result)
    const target = join(this.dataDir, 'verification.json')
    const temporary = `${target}.tmp`
    const backup = `${target}.bak`
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await writeFile(temporary, JSON.stringify([...this.verification.values()], null, 2), 'utf8')
      try { await copyFile(target, backup) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await rename(temporary, target)
    })
    await this.writeQueue
  }

  async log(event: Record<string, unknown>): Promise<void> {
    const safe = Object.fromEntries(Object.entries(event).filter(([key]) => !/key|secret|prompt|image|credential|bytes/i.test(key)))
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const path = join(this.dataDir, 'calls.jsonl')
      const age = Date.now() - 7 * 86400000
      const line = JSON.stringify({ time: new Date().toISOString(), ...safe }) + '\n'
      const maxBytes = 50 * 1024 * 1024
      let size = 0
      try { size = (await stat(path)).size } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (size + Buffer.byteLength(line) > maxBytes || Date.now() - this.logMaintainedAt > 86400000) {
        let existing = ''
        try { existing = await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const rows = [...existing.split('\n').filter(Boolean), line.trimEnd()].filter(row => {
          try { return Date.parse((JSON.parse(row) as { time: string }).time) >= age } catch { return false }
        })
        const kept: string[] = []
        let used = 0
        for (const row of rows.reverse()) {
          const bytes = Buffer.byteLength(row) + 1
          if (used + bytes > maxBytes) break
          kept.push(row)
          used += bytes
        }
        await writeFile(`${path}.tmp`, kept.reverse().map(row => `${row}\n`).join(''), 'utf8')
        await rename(`${path}.tmp`, path)
        await rm(join(this.dataDir, 'calls.previous.jsonl'), { force: true })
        this.logMaintainedAt = Date.now()
      } else await appendFile(path, line, 'utf8')
    })
    await this.writeQueue
  }

  async logs(limit = 200): Promise<Record<string, unknown>[]> {
    try { return (await readFile(join(this.dataDir, 'calls.jsonl'), 'utf8')).trim().split('\n').slice(-limit).map(line => JSON.parse(line) as Record<string, unknown>) }
    catch { return [] }
  }
}
