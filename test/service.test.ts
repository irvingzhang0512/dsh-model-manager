import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../src/domain.ts'
import { HostModelBridge, ModelManagerService } from '../src/service.ts'

/** 真实宿主的冲突错误形状：dsh-settings 的 SettingsConflictError（code=SETTINGS_CONFLICT，消息里没有字面量 CONFLICT）。 */
function settingsConflict(expected: number, actual: number): Error {
  return Object.assign(new Error(`settings namespace "llm-pi-ai" changed since it was read (expected revision ${expected}, now ${actual})`), { code: 'SETTINGS_CONFLICT', name: 'SettingsConflictError' })
}

describe('宿主桥接与版本控制', () => {
  it('模型覆盖只修改指定模型字段，不重写 Provider 凭据', async () => {
    const mutate = vi.fn(async () => {})
    const settings = { get: () => ({ providers: { p: { apiKeyEnv: 'SECRET_REF' } } }), mutate }
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    await new HostModelBridge(llm as never, settings as never).applyNative({ providerId: 'p', modelId: 'm' }, { image: true }, 7)
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'set', path: ['providers', 'p', 'modelOverrides', 'm', 'input'], value: ['text', 'image'] }], 7)
    expect(JSON.stringify(mutate.mock.calls)).not.toContain('SECRET_REF')
  })
  it('清除指定模型字段覆盖只发送 unset 操作', async () => {
    const mutate = vi.fn(async () => {})
    const settings = { get: () => ({ providers: { p: { apiKeyEnv: 'SECRET_REF', modelOverrides: { m: { input: ['text', 'image'], maxTokens: 2048 } } } } }), mutate }
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    await new HostModelBridge(llm as never, settings as never).clearNative({ providerId: 'p', modelId: 'm' }, ['image'], 8)
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'p', 'modelOverrides', 'm', 'input'] }], 8)
    expect(JSON.stringify(mutate.mock.calls)).not.toContain('SECRET_REF')
  })
  it('探测读写 input 声明：覆盖路径可设置与删除', async () => {
    const mutate = vi.fn(async () => {})
    const settings = { get: () => ({ providers: { p: { modelOverrides: { m: { input: ['text'] } } } } }), mutate, describe: () => [{ ns: 'llm-pi-ai', revision: 3 }] }
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    const bridge = new HostModelBridge(llm as never, settings as never)
    expect(bridge.modelInput({ providerId: 'p', modelId: 'm' })).toEqual(['text'])
    expect(bridge.modelInput({ providerId: 'p', modelId: 'ghost' })).toBeUndefined()
    expect(bridge.currentRevision()).toBe(3)
    await bridge.setInput({ providerId: 'p', modelId: 'm' }, ['text', 'image'], 3)
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'set', path: ['providers', 'p', 'modelOverrides', 'm', 'input'], value: ['text', 'image'] }], 3)
    await bridge.setInput({ providerId: 'p', modelId: 'm' }, undefined, 4)
    expect(mutate).toHaveBeenLastCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'p', 'modelOverrides', 'm', 'input'] }], 4)
  })
  it('显式模型清单下的 input 声明通过整表替换设置与删除', async () => {
    const mutate = vi.fn(async () => {})
    const models = [{ id: 'm', input: ['text'] }, { id: 'n', input: ['text', 'image'] }]
    const settings = { get: () => ({ providers: { p: { models } } }), mutate, describe: () => [{ ns: 'llm-pi-ai', revision: 1 }] }
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    const bridge = new HostModelBridge(llm as never, settings as never)
    expect(bridge.modelInput({ providerId: 'p', modelId: 'n' })).toEqual(['text', 'image'])
    await bridge.setInput({ providerId: 'p', modelId: 'n' }, undefined, 1)
    const call = mutate.mock.calls[0] as [string, { op: string; path: string[]; value: unknown }[], number]
    expect(call[0]).toBe('llm-pi-ai')
    expect(call[1][0].op).toBe('set')
    expect(call[1][0].value).toEqual([{ id: 'm', input: ['text'] }, { id: 'n' }])
    expect(models).toEqual([{ id: 'm', input: ['text'] }, { id: 'n', input: ['text', 'image'] }])
  })
  it('探测写入撞上宿主 SETTINGS_CONFLICT 时改用最新 revision 重试', async () => {
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    const mutate = vi.fn().mockRejectedValueOnce(settingsConflict(23, 25)).mockResolvedValueOnce(undefined)
    const settings = { get: () => ({ providers: { p: { modelOverrides: { m: { input: ['text'] } } } } }), mutate, describe: () => [{ ns: 'llm-pi-ai', revision: 25 }] }
    await new HostModelBridge(llm as never, settings as never).setInput({ providerId: 'p', modelId: 'm' }, ['text', 'image'], 23)
    expect(mutate.mock.calls.map(call => call[2])).toEqual([23, 25])
    // 只带冲突消息、没有 code/name 的错误也必须重试：判定不再依赖错误字符串里恰好出现 Conflict。
    const bare = vi.fn().mockRejectedValueOnce(new Error('settings namespace "llm-pi-ai" changed since it was read (expected revision 23, now 25)')).mockResolvedValueOnce(undefined)
    const plainSettings = { get: () => ({ providers: { p: { modelOverrides: { m: { input: ['text'] } } } } }), mutate: bare, describe: () => [{ ns: 'llm-pi-ai', revision: 25 }] }
    await new HostModelBridge(llm as never, plainSettings as never).setInput({ providerId: 'p', modelId: 'm' }, ['text', 'image'], 23)
    expect(bare.mock.calls.map(call => call[2])).toEqual([23, 25])
  })
  it('宿主声明写入遇到版本冲突同样重试，非冲突错误只写一次', async () => {
    const retried = vi.fn().mockRejectedValueOnce(settingsConflict(7, 9)).mockResolvedValueOnce(undefined)
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    const conflictBridge = new HostModelBridge(llm as never, { get: () => ({ providers: { p: {} } }), mutate: retried, describe: () => [{ ns: 'llm-pi-ai', revision: 9 }] } as never)
    await conflictBridge.applyNative({ providerId: 'p', modelId: 'm' }, { image: true }, 7)
    expect(retried.mock.calls.map(call => call[2])).toEqual([7, 9])
    const refused = vi.fn(async () => { throw new Error('settings provider is read-only: "llm-pi-ai" cannot be updated in-process') })
    const readonlyBridge = new HostModelBridge(llm as never, { get: () => ({ providers: { p: {} } }), mutate: refused, describe: () => [{ ns: 'llm-pi-ai', revision: 9 }] } as never)
    await expect(readonlyBridge.applyNative({ providerId: 'p', modelId: 'm' }, { image: true }, 9)).rejects.toThrow('read-only')
    expect(refused).toHaveBeenCalledTimes(1)
  })
  it('显式模型清单写入重试时重建 ops，不覆盖并发写入的兄弟模型字段', async () => {
    let models = [{ id: 'm', input: ['text'] }, { id: 'n', input: ['text'] }]
    const mutate = vi.fn(async () => { throw settingsConflict(1, 2) })
    const settings = { get: () => ({ providers: { p: { models } } }), mutate, describe: () => [{ ns: 'llm-pi-ai', revision: 2 }] }
    const llm = { listConfigurableProviders: () => [{ provider: 'p', settingsNs: 'llm-pi-ai' }] }
    const bridge = new HostModelBridge(llm as never, settings as never)
    const pending = bridge.applyNative({ providerId: 'p', modelId: 'm' }, { image: true }, 1)
    // 第一次尝试发出后，兄弟模型被并发写入：重试必须基于新分节重建整表，而不是复用旧快照。
    models = [{ id: 'm', input: ['text'] }, { id: 'n', input: ['text', 'image'] }]
    await expect(pending).rejects.toThrow('changed since it was read')
    const calls = mutate.mock.calls as unknown as [string, { value: { id: string; input?: string[] }[] }[], number][]
    expect(calls.map(call => call[2])).toEqual([1, 2, 2])
    expect(calls[1][1][0].value[1].input).toEqual(['text', 'image'])
  })
  it('配置冲突拒绝过期版本且不覆盖已保存值', async () => {
    const bridge = { catalog: async () => [] }
    const service = new ModelManagerService(bridge, 'unused-test-path')
    const newer = structuredClone(DEFAULT_CONFIG); newer.auto.main.tier = 'deep'
    await service.update(newer, 0)
    await expect(service.update(DEFAULT_CONFIG, 0)).rejects.toThrow('SETTINGS_CONFLICT')
    expect(service.snapshot().config.auto.main.tier).toBe('deep')
  })
  it('视觉缓存重启后可复用并按键隔离', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-cache-'))
    try {
      const bridge = { catalog: async () => [] }
      const first = new ModelManagerService(bridge, dir)
      await first.init()
      await first.putVisionCache('session-a:image-a:question-a', '红色')
      const second = new ModelManagerService(bridge, dir)
      await second.init()
      expect(second.getVisionCache('session-a:image-a:question-a')).toBe('红色')
      expect(second.getVisionCache('session-b:image-a:question-a')).toBeUndefined()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('数据文件损坏时从上一份完整备份恢复', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-recovery-'))
    try {
      const bridge = { catalog: async () => [], applyNative: async () => {} }
      const first = new ModelManagerService(bridge, dir)
      await first.init()
      await first.putVisionCache('first', '原始答案')
      await first.putVisionCache('second', '新答案')
      await writeFile(join(dir, 'vision-cache.json'), '{broken', 'utf8')
      const restored = new ModelManagerService(bridge, dir)
      await restored.init()
      expect(restored.getVisionCache('first')).toBe('原始答案')
      expect(restored.getVisionCache('second')).toBeUndefined()
      expect(JSON.parse(await readFile(join(dir, 'vision-cache.json'), 'utf8'))).toHaveProperty('first')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('模型配置变化后原验证证据标为过期', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-evidence-'))
    try {
      const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'no' as const as const, reasoningEfforts: [], source: 'host' as const, loaded: true }
      const service = new ModelManagerService({ catalog: async () => [model], applyNative: async () => {} }, dir)
      await service.init()
      await service.saveVerification({ model, kind: 'image', status: 'rejected', checkedAt: '2026-01-01', signature: service.signature(model), requestCount: 1 })
      expect(service.snapshot().verifications[0].stale).toBe(false)
      const updated = structuredClone(DEFAULT_CONFIG)
      updated.models['["p","m"]'] = { capability: { image: 'yes' } }
      await service.update(updated, 0)
      expect(service.snapshot().verifications[0].stale).toBe(true)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('推理设置变更使推理验证过期但不污染文字证据', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-reasoning-'))
    try {
      const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'no' as const as const, reasoningEfforts: [{ id: 'off', name: 'Off' }], source: 'host' as const, loaded: true }
      const service = new ModelManagerService({ catalog: async () => [model], applyNative: async () => {} }, dir)
      await service.init()
      await service.saveVerification({ model, kind: 'reasoning', status: 'accepted', checkedAt: '2026-01-01', signature: service.signature(model, 'reasoning'), requestCount: 1 })
      await service.saveVerification({ model, kind: 'text', status: 'accepted', checkedAt: '2026-01-01', signature: service.signature(model, 'text'), requestCount: 1 })
      const config = structuredClone(DEFAULT_CONFIG)
      config.auto.main.thinking = 'off'
      await service.update(config, 0)
      expect(service.getVerification(model, 'reasoning')?.stale).toBe(true)
      expect(service.getVerification(model, 'text')?.stale).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('日志清理七天前的记录并过滤敏感字段', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-log-'))
    try {
      const old = JSON.stringify({ time: '2020-01-01T00:00:00Z', status: 'old' })
      await writeFile(join(dir, 'calls.jsonl'), `${old}\n`, 'utf8')
      const service = new ModelManagerService({ catalog: async () => [], applyNative: async () => {} }, dir)
      await service.init()
      await service.log({ status: 'new', secretKey: 'PRIVATE' })
      const contents = await readFile(join(dir, 'calls.jsonl'), 'utf8')
      expect(contents).toContain('"status":"new"')
      expect(contents).not.toContain('old')
      expect(contents).not.toContain('PRIVATE')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('日志达到 50 MB 后保留新记录并限制文件大小', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-log-cap-'))
    try {
      const path = join(dir, 'calls.jsonl')
      await writeFile(path, `${JSON.stringify({ time: new Date().toISOString(), status: 'old', filler: 'x'.repeat(50 * 1024 * 1024 - 100) })}\n`, 'utf8')
      const service = new ModelManagerService({ catalog: async () => [], applyNative: async () => {} }, dir)
      await service.init()
      await service.log({ status: 'new' })
      expect((await stat(path)).size).toBeLessThanOrEqual(50 * 1024 * 1024)
      expect((await service.logs(1))[0]?.status).toBe('new')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('读取到 v1 配置时自动迁移成 v2', async () => {
    const stored = { version: 1, aliases: { fast: [{ providerId: 'p', modelId: 'a' }] }, models: {}, mode: 'manual', manual: {}, auto: { tier: 'balanced' },
      roles: { coding: { target: { providerId: 'p', modelId: 'c' } } }, vision: { enabled: false, policy: 'native-first' }, reliability: { maxAttempts: 2, retryTransient: true, parameterDowngrade: false, longContextCandidates: [{ providerId: 'p', modelId: 'big' }] } }
    const settings = { get: (ns: string) => ns === 'dsh-model-manager' ? stored : undefined, describe: () => [{ ns: 'dsh-model-manager', revision: 4 }] }
    const service = new ModelManagerService({ catalog: async () => [] }, 'unused-migrate-path', settings as never)
    await service.init()
    const config = service.snapshot().config
    expect(config.version).toBe(2)
    expect(config.aliases.fast).toEqual({ candidates: [{ providerId: 'p', modelId: 'a' }] })
    expect(config.aliases['long-context']!.candidates).toEqual([{ providerId: 'p', modelId: 'big' }])
    expect(config.auto.main.tier).toBe('balanced')
    expect(config.reliability.maxAttempts).toBe(2)
  })
  it('同名模型验证与并发会话覆盖互不串用', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dmm-isolation-'))
    try {
      const service = new ModelManagerService({ catalog: async () => [], applyNative: async () => {} }, dir)
      await service.init()
      const first = { providerId: 'first', modelId: 'same' }
      const second = { providerId: 'second', modelId: 'same' }
      await service.saveVerification({ model: first, kind: 'text', status: 'accepted', checkedAt: '2026-01-01', signature: service.signature(first), requestCount: 1 })
      expect(service.getVerification(first, 'text')?.status).toBe('accepted')
      expect(service.getVerification(second, 'text')).toBeUndefined()
      await service.setOverride('session-a', 'nextTurn', { maxOutputTokens: 128 })
      await service.setOverride('session-b', 'nextTurn', { maxOutputTokens: 512 })
      expect(service.effectiveSelection('session-a', 1).maxOutputTokens).toBe(128)
      expect(service.effectiveSelection('session-b', 1).maxOutputTokens).toBe(512)
      expect(service.effectiveSelection('session-a', 1).maxOutputTokens).toBe(128)
      service.endTurn('session-a', 1)
      expect(service.effectiveSelection('session-a', 2).maxOutputTokens).toBeUndefined()
      expect(service.effectiveSelection('session-b', 1).maxOutputTokens).toBe(512)
      await service.flush()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
