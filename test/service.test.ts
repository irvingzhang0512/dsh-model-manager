import { describe, expect, it, vi } from 'vitest'
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
  it('配置冲突拒绝过期版本且不覆盖已保存值', async () => {
    const bridge = { catalog: async () => [] }
    const service = new ModelManagerService(bridge, 'unused-test-path')
    const newer = structuredClone(DEFAULT_CONFIG); newer.mode = 'auto'
    await service.update(newer, 0)
    await expect(service.update(DEFAULT_CONFIG, 0)).rejects.toThrow('SETTINGS_CONFLICT')
    expect(service.snapshot().config.mode).toBe('auto')
  })
})
