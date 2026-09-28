import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { DEFAULT_CONFIG, modelKey, resolveSelection, validateConfig, type ManagerConfig, type ModelRecord, type ModelRef, type Selection, type Verification } from './domain.js'

export interface ModelBridge {
  catalog(): Promise<ModelRecord[]>
  applyNative(ref: ModelRef, fields: { image?: boolean; contextWindow?: number; maxTokens?: number }, revision: number): Promise<void>
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
          nativeTools: 'unknown' as const,
          reasoningEfforts: 'reasoning' in info && info.reasoning ? info.reasoning.efforts.map(e => ({ id: e.id as string, name: e.name })) : [],
          contextWindow: 'context' in info ? info.context?.contextWindow : undefined,
          defaultMaxTokens: 'defaultMaxTokens' in info ? info.defaultMaxTokens : undefined,
          source: 'host' as const, loaded: true,
          nativeEditable: canWrite,
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
}

export function resolveDataDir(profile?: string): string {
  const flag = process.argv.findIndex(arg => arg === '--profile')
  const fromArgv = flag >= 0 ? process.argv[flag + 1] : process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length)
  profile ??= process.env.DSH_PROFILE || fromArgv || 'web'
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('无效的 DSH profile 名称')
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', profile, 'data', 'dsh-model-manager')
}

export class ModelManagerService {
  private config: ManagerConfig = structuredClone(DEFAULT_CONFIG)
  private revision = 0
  private models: ModelRecord[] = []
  private writeQueue: Promise<void> = Promise.resolve()
  private verification = new Map<string, Verification>()
  private overrides = new Map<string, { session?: Selection; nextTurn?: Selection; active?: { turn: number; selection: Selection } }>()
  constructor(private readonly bridge: ModelBridge, private readonly dataDir: string, private readonly settings?: SettingsProvider) {}

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const stored = this.settings?.get('dsh-model-manager') as ManagerConfig | undefined
    if (stored) { validateConfig(stored); this.config = structuredClone(stored) }
    this.revision = this.settings?.describe({ redactSecrets: true }).find(d => d.ns === 'dsh-model-manager')?.revision ?? 0
    this.models = await this.bridge.catalog()
    try {
      const records = JSON.parse(await readFile(join(this.dataDir, 'verification.json'), 'utf8')) as Verification[]
      for (const record of records) this.verification.set(this.verificationKey(record.model, record.kind), record)
    } catch { /* 首次启动或损坏时保留原文件，以空证据继续 */ }
    try {
      const saved = JSON.parse(await readFile(join(this.dataDir, 'overrides.json'), 'utf8')) as Record<string, { session?: Selection; nextTurn?: Selection }>
      for (const [session, value] of Object.entries(saved)) this.overrides.set(session, value)
    } catch { /* 首次启动 */ }
  }

  snapshot(): { revision: number; config: ManagerConfig; models: ModelRecord[] } {
    return { revision: this.revision, config: structuredClone(this.config), models: structuredClone(this.models) }
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
      value.active = { turn, selection: { ...value.session, ...value.nextTurn } }
      this.overrides.set(session, value)
    }
    const global = this.config.mode === 'manual' ? this.config.manual : this.config.auto
    return structuredClone({ ...global, ...value.active.selection })
  }

  activeSelection(session: string): Selection | undefined { return this.overrides.get(session)?.active?.selection && structuredClone(this.overrides.get(session)!.active!.selection) }

  endTurn(session: string, turn: number): void {
    const value = this.overrides.get(session)
    if (value?.active?.turn !== turn) return
    delete value.active
    if (value.nextTurn) void this.setOverride(session, 'nextTurn').catch(() => {})
  }

  signature(ref: ModelRef): string {
    const model = this.model(ref)
    const settings = this.config.models[modelKey(ref)]
    return createHash('sha256').update(JSON.stringify({ model, settings })).digest('hex')
  }

  verificationKey(ref: ModelRef, kind: Verification['kind']): string { return `${modelKey(ref)}:${kind}` }
  getVerification(ref: ModelRef, kind: Verification['kind']): (Verification & { stale: boolean }) | undefined {
    const evidence = this.verification.get(this.verificationKey(ref, kind))
    return evidence && { ...evidence, stale: evidence.signature !== this.signature(ref) }
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
      try {
        const file = await stat(path)
        if (file.size > 50 * 1024 * 1024 || file.mtimeMs < age) await rename(path, join(this.dataDir, 'calls.previous.jsonl'))
      } catch { /* 尚无日志 */ }
      await appendFile(path, JSON.stringify({ time: new Date().toISOString(), ...safe }) + '\n', 'utf8')
    })
    await this.writeQueue
  }

  async logs(limit = 200): Promise<Record<string, unknown>[]> {
    try { return (await readFile(join(this.dataDir, 'calls.jsonl'), 'utf8')).trim().split('\n').slice(-limit).map(line => JSON.parse(line) as Record<string, unknown>) }
    catch { return [] }
  }
}
