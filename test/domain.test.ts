import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, classifyFailure, fromManagedId, managedId, mapEffort, mapSelectionEffort, mergeSelection, resolveSelection, validateConfig, visionRoute } from '../src/domain.ts'

describe('模型配置', () => {
  it('不同 Provider 的同名模型 ID 不碰撞', () => {
    const a = { providerId: 'one', modelId: 'same' }
    const b = { providerId: 'two', modelId: 'same' }
    expect(managedId(a)).not.toBe(managedId(b))
    expect(fromManagedId(managedId(a))).toEqual(a)
  })
  it('别名只接受有序的具体模型', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.aliases.fast = [{ providerId: 'p', modelId: 'a' }, { providerId: 'p', modelId: 'b' }]
    expect(resolveSelection(config, '@fast').map(x => x.modelId)).toEqual(['a', 'b'])
    config.aliases.fast = ['@strong' as never]
    expect(() => validateConfig(config)).toThrow()
  })
  it('推理档位必须逐模型映射', () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'unknown' as const, nativeTools: 'unknown' as const, reasoningEfforts: [{ id: 'medium', name: 'Medium' }], source: 'host' as const, loaded: true }
    expect(mapEffort(model, { tiers: { balanced: 'medium' } }, 'balanced')).toBe('medium')
    expect(() => mapEffort(model, { tiers: { max: 'max' } }, 'max')).toThrow()
  })
  it('关闭思考必须有实际 off 档位且不能和 Deep 同时使用', () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'unknown' as const, nativeTools: 'unknown' as const, reasoningEfforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], source: 'host' as const, loaded: true }
    expect(mapSelectionEffort(model, { tiers: { deep: 'high' } }, { thinking: 'off', tier: 'auto' })).toBe('off')
    expect(() => mapSelectionEffort(model, { tiers: { deep: 'high' } }, { thinking: 'off', tier: 'deep' })).toThrow()
    expect(mergeSelection({ tier: 'deep' }, { tier: 'inherit' }).tier).toBe('deep')
  })
  it('视觉四策略保留未知与否的区别', () => {
    expect(visionRoute('native-first', 'unknown', true)).toBe('sidecar')
    expect(visionRoute('native-only', 'unknown', true)).toBe('error')
    expect(visionRoute('sidecar-first', 'yes', true)).toBe('sidecar')
    expect(visionRoute('sidecar-only', 'yes', false)).toBe('error')
  })
  it('故障分类不把认证和参数错误作为普通重试', () => {
    expect(classifyFailure(429)).toBe('cooldown')
    expect(classifyFailure(401)).toBe('auth')
    expect(classifyFailure(400, 'context_length_exceeded')).toBe('context')
    expect(classifyFailure(503)).toBe('retry')
  })
})
