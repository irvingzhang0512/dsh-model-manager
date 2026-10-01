import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, LONG_CONTEXT_ALIAS, classifyFailure, fromManagedId, inferTierMapping, managedId, mapEffort, mapSelectionEffort, mergeSelection, migrateConfig, probeSuggestions, resolveSelection, validateConfig, visionRoute, type Verification } from '../src/domain.ts'

function evidence(kind: Verification['kind'], status: Verification['status'], behavior?: Verification['behavior'], detail?: string): Verification {
  return { model: { providerId: 'p', modelId: 'm' }, kind, status, behavior, detail, checkedAt: '2026-01-01T00:00:00.000Z', signature: 's', requestCount: 1 }
}

describe('模型配置', () => {
  it('不同 Provider 的同名模型 ID 不碰撞', () => {
    const a = { providerId: 'one', modelId: 'same' }
    const b = { providerId: 'two', modelId: 'same' }
    expect(managedId(a)).not.toBe(managedId(b))
    expect(fromManagedId(managedId(a))).toEqual(a)
  })
  it('别名只接受有序的具体模型', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.aliases.fast = { candidates: [{ providerId: 'p', modelId: 'a' }, { providerId: 'p', modelId: 'b' }] }
    expect(resolveSelection(config, '@fast').map(x => x.modelId)).toEqual(['a', 'b'])
    config.aliases.fast = { candidates: ['@strong' as never] }
    expect(() => validateConfig(config)).toThrow()
  })
  it('档位显式映射优先，未配置时按模型公开档位自动推断', () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'unknown' as const as const, reasoningEfforts: [{ id: 'medium', name: 'Medium' }], source: 'host' as const, loaded: true }
    expect(mapEffort(model, { legacyTiers: { balanced: 'medium' } }, 'balanced')).toBe('medium')
    expect(mapEffort(model, undefined, 'balanced')).toBe('medium')
    expect(inferTierMapping(model)).toEqual({ low: 'medium', high: 'medium', max: 'medium' })
    const empty = { ...model, reasoningEfforts: [] }
    expect(() => mapEffort(empty, undefined, 'balanced')).toThrow('未配置')
  })
  it('按模型实际档位推断 low/high/max', () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'unknown' as const as const, reasoningEfforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'max', name: 'Max' }], source: 'host' as const, loaded: true }
    expect(inferTierMapping(model)).toEqual({ low: 'low', high: 'high', max: 'max' })
  })
  it('关闭思考必须有实际 off 档位', () => {
    const model = { providerId: 'p', modelId: 'm', name: 'm', nativeImage: 'unknown' as const as const, reasoningEfforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], source: 'host' as const, loaded: true }
    expect(mapSelectionEffort(model, {}, { thinking: 'off', tier: 'auto' })).toBe('off')
    expect(() => mapSelectionEffort({ ...model, reasoningEfforts: [{ id: 'high', name: 'High' }] }, {}, { reasoningEffort: 'off' })).toThrow()
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

describe('v3 配置迁移', () => {
  it('v1 别名、长上下文候选与角色偏好迁移成 v3，旧主模型保留', () => {
    const v1 = {
      version: 1,
      aliases: { fast: [{ providerId: 'p', modelId: 'a' }] },
      models: {},
      mode: 'auto',
      manual: { target: { providerId: 'm1', modelId: 'x' } },
      auto: { target: { providerId: 'p', modelId: 'a' }, tier: 'balanced' },
      roles: { main: { tier: 'balanced' }, coding: { target: { providerId: 'p', modelId: 'c' } } },
      vision: { enabled: true, policy: 'native-first' as const },
      reliability: { maxAttempts: 2, retryTransient: false, parameterDowngrade: true, longContextCandidates: [{ providerId: 'p', modelId: 'big' }] },
    }
    const v3 = migrateConfig(v1)
    expect(v3.version).toBe(3)
    expect(v3.aliases.fast).toEqual({ candidates: [{ providerId: 'p', modelId: 'a' }] })
    expect(v3.aliases[LONG_CONTEXT_ALIAS]).toEqual({ candidates: [{ providerId: 'p', modelId: 'big' }] })
    expect(v3.auto.main).toEqual({ target: { providerId: 'p', modelId: 'a' }, tier: 'balanced' })
    expect(v3.auto.normal.target).toEqual(v3.auto.main.target)
    expect(v3.auto.preferences.coding.target).toEqual({ providerId: 'p', modelId: 'c' })
    expect(v3.reliability).toEqual({ maxAttempts: 2, retryTransient: false, parameterDowngrade: true })
    expect(() => validateConfig(v3)).not.toThrow()
    expect(migrateConfig(v3)).toEqual(v3)
  })
  it('v2 旧档位映射逐模型保留且重复迁移不丢失', () => {
    const old = { version: 2, aliases: {}, models: { '["p","m"]': { tiers: { fast: 'low', balanced: 'medium', deep: 'high', max: 'max' } } }, auto: { main: { target: { providerId: 'p', modelId: 'm' }, tier: 'deep' }, roles: {} } }
    const next = migrateConfig(old)
    expect(next.models['["p","m"]'].legacyTiers).toEqual({ fast: 'low', balanced: 'medium', deep: 'high' })
    expect(next.auto.main.tier).toBe('deep')
    expect(migrateConfig(next)).toEqual(next)
    expect(migrateConfig(structuredClone(DEFAULT_CONFIG)).version).toBe(3)
    expect(() => migrateConfig({ version: 4 })).toThrow('不支持的配置版本')
  })
})

describe('探测建议', () => {
  it('图片识别通过同时建议写宿主和插件声明', () => {
    const suggestions = probeSuggestions([evidence('image', 'accepted', 'observed')])
    expect(suggestions).toEqual([
      { field: 'hostImage', value: 'yes', confidence: 'high', reason: expect.stringContaining('正确识别') },
      { field: 'pluginImage', value: 'yes', confidence: 'high', reason: expect.stringContaining('正确识别') },
    ])
  })
  it('图片答错只建议插件声明为不支持，且置信度低', () => {
    const suggestions = probeSuggestions([evidence('image', 'accepted', 'not-observed')])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ field: 'pluginImage', value: 'no', confidence: 'low' })
  })
  it('图片请求被拒只建议插件声明为不支持', () => {
    const suggestions = probeSuggestions([evidence('image', 'rejected', undefined, 'unsupported image input')])
    expect(suggestions).toEqual([{ field: 'pluginImage', value: 'no', confidence: 'low', reason: expect.stringContaining('unsupported image input') }])
  })
  it('网络错误和取消不产生任何建议', () => {
    expect(probeSuggestions([evidence('image', 'network-error'), evidence('tools', 'cancelled')])).toEqual([])
  })
})
