import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, classifyFailure, fromManagedId, managedId, mapEffort, mapSelectionEffort, mergeSelection, probeSuggestions, resolveSelection, validateConfig, visionRoute, type Verification } from '../src/domain.ts'

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
  it('工具探测只有真发起调用才算通过', () => {
    expect(probeSuggestions([evidence('tools', 'accepted', 'observed')])).toEqual([{ field: 'pluginTools', value: 'yes', confidence: 'high', reason: expect.stringContaining('工具调用') }])
    expect(probeSuggestions([evidence('tools', 'accepted', 'not-observed')])[0]).toMatchObject({ field: 'pluginTools', value: 'no', confidence: 'low' })
  })
  it('同时探测图片与工具时逐项给出建议', () => {
    const suggestions = probeSuggestions([evidence('image', 'accepted', 'observed'), evidence('tools', 'accepted', 'observed')])
    expect(suggestions.map(item => `${item.field}:${item.value}`)).toEqual(['hostImage:yes', 'pluginImage:yes', 'pluginTools:yes'])
  })
})
