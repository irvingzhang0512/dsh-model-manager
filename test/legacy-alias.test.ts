import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, migrateConfig, validateConfig } from '../src/domain.js'
import { cleanLegacyAliasReliability, legacyAliasReliability, rejectAliasReliability } from '../src/legacy-alias.js'
import { preserveUnknownConfig } from '../src/legacy-image.js'
import { manualIntents, planCatalog } from '../src/catalog-state.js'

function legacy() {
  const raw = structuredClone(DEFAULT_CONFIG) as any
  const ref = { providerId: 'official', modelId: 'flash' }
  raw.aliases = { flash: { candidates: [ref], efforts: { '["official","flash"]': 'high' }, custom: 'preserve', reliability: { maxAttempts: { invalid: true }, retryTransient: 'bad', parameterDowngrade: [true], unknown: { nested: 'keep' } } }, empty: { candidates: [ref], reliability: { maxAttempts: 1 } }, unknown: { candidates: [ref], reliability: 'keep unknown' } }
  raw.auto.main.target = '@flash'; raw.vision.target = '@flash'; raw.extra = 'preserve'
  return raw
}
describe('旧别名策略原始层清理', () => {
  it.each([1, 2, 3])('v%s 读取忽略任意旧策略叶值且幂等，原始值不被读取改写', version => {
    const raw = legacy(), original = structuredClone(raw); raw.version = version; original.version = version
    const config = migrateConfig(raw)
    expect(config.aliases.flash).not.toHaveProperty('reliability')
    expect(() => validateConfig(config)).not.toThrow(); expect(migrateConfig(config)).toEqual(config)
    expect(raw).toEqual(original)
  })
  it('只删除三个失效叶键，未知整体和嵌套值、候选、档位及引用保留', () => {
    const raw = legacy(), cleaned: any = cleanLegacyAliasReliability(raw)
    expect(legacyAliasReliability(raw).map(row => row.name)).toEqual(['flash', 'empty'])
    expect(cleaned.flash.reliability).toEqual({ unknown: { nested: 'keep' } }); expect(cleaned.empty).not.toHaveProperty('reliability'); expect(cleaned.unknown.reliability).toBe('keep unknown')
    expect(cleaned.flash.candidates).toEqual(raw.aliases.flash.candidates); expect(cleaned.flash.efforts).toEqual(raw.aliases.flash.efforts)
    expect(legacyAliasReliability({ aliases: cleaned })).toEqual([])
    expect(cleanLegacyAliasReliability({ aliases: cleaned })).toEqual(cleaned)
  })
  it('普通保存保留未清理历史，清理后保存不复活且不允许重新提交旧策略', () => {
    const raw = legacy(), effective = migrateConfig(raw), next = structuredClone(effective)
    next.aliases.flash.custom = 'changed'
    expect(preserveUnknownConfig(effective, next, raw).aliases.flash.reliability).toEqual(raw.aliases.flash.reliability)
    const cleaned = { ...raw, aliases: cleanLegacyAliasReliability(raw) }
    expect(preserveUnknownConfig(effective, next, cleaned).aliases.flash.reliability).toEqual({ unknown: { nested: 'keep' } })
    expect(() => rejectAliasReliability(effective)).not.toThrow()
    expect(() => rejectAliasReliability(raw)).toThrow('停用')
  })
  it('缺失／部分 aliases 或非对象策略不产生伪清理', () => {
    for (const raw of [{}, { aliases: {} }, { aliases: { x: { reliability: 'unknown' } } }]) expect(legacyAliasReliability(raw)).toEqual([])
  })
  it('目录清理独立规划、未勾选不变且不触碰任何使用引用', () => {
    const raw = legacy(), state: any = { config: migrateConfig(raw), rawAliases: raw.aliases, legacyAliases: legacyAliasReliability(raw), profiles: [], records: [], models: [], overrides: { session: { session: { target: '@flash' } } }, defaultModel: { provider: 'dsh-model-manager', model: 'alias:flash' } }
    const intents = manualIntents([{ kind: 'clearLegacyAliasReliability' }], state)
    const unselected = planCatalog(state, intents, [], [])
    expect(unselected.after).toEqual(state)
    const selected = planCatalog(state, intents)
    expect(selected.after.rawAliases).toEqual(cleanLegacyAliasReliability(raw)); expect(selected.after.config).toEqual(state.config)
    expect(selected.after.overrides).toEqual(state.overrides); expect(selected.after.defaultModel).toEqual(state.defaultModel)
    expect(() => manualIntents([{ kind: 'clearLegacyAliasReliability' }, { kind: 'clearLegacyPreferences' }], state)).toThrow('单独')
    expect(() => manualIntents([{ kind: 'clearLegacyAliasReliability', extra: true }], state)).toThrow('单独')
  })
})
