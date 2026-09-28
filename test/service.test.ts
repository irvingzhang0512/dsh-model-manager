import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../src/domain.ts'
import { HostModelBridge, ModelManagerService } from '../src/service.ts'

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
  it('配置冲突拒绝过期版本且不覆盖已保存值', async () => {
    const bridge = { catalog: async () => [] }
    const service = new ModelManagerService(bridge, 'unused-test-path')
    const newer = structuredClone(DEFAULT_CONFIG); newer.mode = 'auto'
    await service.update(newer, 0)
    await expect(service.update(DEFAULT_CONFIG, 0)).rejects.toThrow('SETTINGS_CONFLICT')
    expect(service.snapshot().config.mode).toBe('auto')
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
      const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'no' as const, nativeTools: 'unknown' as const, reasoningEfforts: [], source: 'host' as const, loaded: true }
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
      const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'no' as const, nativeTools: 'unknown' as const, reasoningEfforts: [{ id: 'off', name: 'Off' }], source: 'host' as const, loaded: true }
      const service = new ModelManagerService({ catalog: async () => [model], applyNative: async () => {} }, dir)
      await service.init()
      await service.saveVerification({ model, kind: 'reasoning', status: 'accepted', checkedAt: '2026-01-01', signature: service.signature(model, 'reasoning'), requestCount: 1 })
      await service.saveVerification({ model, kind: 'text', status: 'accepted', checkedAt: '2026-01-01', signature: service.signature(model, 'text'), requestCount: 1 })
      const config = structuredClone(DEFAULT_CONFIG)
      config.manual.thinking = 'off'
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
