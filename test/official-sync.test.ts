import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeOfficial, extractOfficialPage, fetchOfficialPage, validateOfficialAnalysis } from '../src/official-sync.ts'
import { DEFAULT_CONFIG, modelKey } from '../src/domain.ts'
import { applyOfficialDiffs, officialDiffs, type OfficialState } from '../src/official-state.ts'
import { predictedModelCount } from '../src/official-types.ts'
import { analysis, html, source } from './official-fixtures.ts'

afterEach(() => vi.unstubAllGlobals())
const runner = { providerId: 'other', modelId: 'reader' }
function llm(outputs: unknown[]) {
  const stream = vi.fn(async function* () { yield { type: 'text-delta', text: typeof outputs[0] === 'string' ? outputs.shift() : JSON.stringify(outputs.shift()) }; yield { type: 'finish', reason: { kind: 'stop' } } })
  return { llm: { stream } as never, stream }
}
function state(ids: string[]): OfficialState { return { models: ids.map(id => ({ id })), config: structuredClone(DEFAULT_CONFIG), overrides: {} } }

describe('最新网页和 LLM 分析', () => {
  it('通用提取正文、表格、脚注、实体与实际相关链接，排除导航和脚本', () => {
    const page = extractOfficialPage('<nav>old-model</nav><main><table><tr><th>API</th><td>new&#45;id</td></tr></table><p>footnote &amp; detail</p><a href="/changed?x=1&amp;y=2#part">详情</a><a href="https://elsewhere.test/">外部</a><script>instruction</script></main>', source)
    expect(page.text).toContain('API new-id'); expect(page.text).toContain('footnote & detail')
    expect(page.text).not.toContain('old-model'); expect(page.text).not.toContain('instruction')
    expect(page.links).toEqual(['https://docs.example.test/changed?x=1&y=2'])
  })
  it.each([['one'], ['one', 'two'], ['one', 'two', 'brand-new']])('任意型号及模型数量 %j', async (...args) => {
    const ids = args as string[]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(ids))))
    const { llm: runtime, stream } = llm([analysis(ids)])
    const result = await analyzeOfficial(runtime, runner, source, new AbortController().signal)
    expect(result.analysis.models.map(model => model.id)).toEqual(ids)
    expect(stream.mock.calls[0][0]).toMatchObject({ provider: 'other', model: 'reader' })
  })
  it('仅从实际链接继续读取变动路径，不依赖旧三个资料页', async () => {
    const detail = 'https://docs.example.test/new-location/'
    const first = extractOfficialPage(html([], [], [detail]), source), second = extractOfficialPage(html(['next-api']), detail)
    const fetch = vi.fn(async (url: URL) => new Response(String(url) === source ? html([], [], [detail]) : html(['next-api'])))
    vi.stubGlobal('fetch', fetch)
    const { llm: runtime } = llm([{ complete: false, conflicts: [], models: [], replacements: [], completenessEvidence: [], requestedUrls: first.links, notes: [] }, analysis(['next-api'], [], second)])
    const stages: string[] = []
    const result = await analyzeOfficial(runtime, runner, source, new AbortController().signal, value => stages.push(value.stage))
    expect(result.pages.map(page => page.url)).toEqual([source, detail]); expect(fetch).toHaveBeenCalledTimes(2)
    expect(stages).toEqual(['reading', 'analyzing', 'reading', 'analyzing'])
  })
  it.each(['fabricated-id', 'fabricated-quote', 'duplicate', 'foreign-source', 'missing-property-evidence', 'conflict', 'empty', 'invalid-replacement'])('拒绝 %s', kind => {
    const page = extractOfficialPage(html(['one', 'two'], ['old-one']), source), value = analysis(['one', 'two'], ['old-one'], page)
    if (kind === 'fabricated-id') value.models[0].id = 'imaginary'
    if (kind === 'fabricated-quote') value.models[0].evidence[0].quote = 'does not exist'
    if (kind === 'duplicate') value.models.push(value.models[0])
    if (kind === 'foreign-source') value.models[0].evidence[0].source = 'https://fake.test/'
    if (kind === 'missing-property-evidence') value.models[0].image = true
    if (kind === 'conflict') value.conflicts = ['sources disagree']
    if (kind === 'empty') value.models = []
    if (kind === 'invalid-replacement') value.replacements[0].newId = 'unlisted'
    expect(() => validateOfficialAnalysis(value, [page])).toThrow()
  })
  it('未知属性不从模型名推断；不完整结果不回退旧清单', async () => {
    const page = extractOfficialPage(html(['one']), source)
    expect(validateOfficialAnalysis(analysis(['one']), [page]).models[0].image).toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const { llm: runtime } = llm([{ ...analysis(['one']), complete: false, requestedUrls: [] }])
    await expect(analyzeOfficial(runtime, runner, source, new AbortController().signal)).rejects.toThrow('不足')
  })
  it('JSON、网络错误、取消、正文限额及域外重定向均失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    await expect(analyzeOfficial(llm(['text before {invalid}']).llm, runner, source, new AbortController().signal)).rejects.toThrow('JSON')
    const abort = new AbortController(); abort.abort()
    await expect(analyzeOfficial(llm([analysis(['one'])]).llm, runner, source, abort.signal)).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('failure', { status: 500 })))
    await expect(fetchOfficialPage(source, new URL(source).hostname, new AbortController().signal)).rejects.toThrow('500')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<main>' + 'x'.repeat(120001) + '</main>')))
    await expect(analyzeOfficial(llm([]).llm, runner, source, new AbortController().signal)).rejects.toThrow('限额')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { Location: 'https://foreign.test/' } })))
    await expect(fetchOfficialPage(source, new URL(source).hostname, new AbortController().signal)).rejects.toThrow('域名')
  })
  it('三轮和六页限额，不跟随编造链接', async () => {
    const urls = Array.from({ length: 7 }, (_, index) => `https://docs.example.test/${index}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html([], [], urls))))
    const incomplete = { complete: false, conflicts: [], models: [], replacements: [], completenessEvidence: [], requestedUrls: urls, notes: [] }
    await expect(analyzeOfficial(llm([incomplete]).llm, runner, source, new AbortController().signal)).rejects.toThrow('限额')
    const outputs = urls.slice(0, 3).map(url => ({ ...incomplete, requestedUrls: [url] }))
    await expect(analyzeOfficial(llm(outputs).llm, runner, source, new AbortController().signal)).rejects.toThrow('三轮')
    await expect(analyzeOfficial(llm([{ ...incomplete, requestedUrls: ['https://invented.test/'] }]).llm, runner, source, new AbortController().signal)).rejects.toThrow('未见')
  })
})

describe('完整清单比较与迁移', () => {
  it('两种旧 ID 合并为同一目标，迁移所有受支持引用与模型键，进行中证据不伪造', () => {
    const original = state(['old-fast', 'old-vision', 'fast', 'pro'])
    const old = { providerId: 'deepseek-official', modelId: 'old-fast' }, target = { ...old, modelId: 'fast' }, key = modelKey(old)
    original.models[0] = { id: 'old-fast', maxTokens: 33, custom: 'keep' }
    original.models[2] = { id: 'fast', maxTokens: 33 }
    original.config.models[key] = { capability: { image: 'yes' }, tiers: { low: 'low' } }
    original.config.aliases.entry = { candidates: [old, { ...old, modelId: 'old-vision' }, target, { providerId: 'third-party', modelId: 'old-fast' }], efforts: { [key]: 'high' } }
    original.config.auto.evaluator = old; original.config.auto.simple.target = old; original.config.auto.main.target = old
    original.config.auto.roles.coding.target = old; original.config.auto.preferences.code = { target: old }; original.config.vision.target = old
    original.config.official = { analyzer: old, sources: { models: 'historical' } }
    original.defaultModel = { provider: old.providerId, model: old.modelId, other: 'keep' }
    original.subagents = { enabled: true, allowedModels: [{ provider: old.providerId, model: old.modelId }, { provider: target.providerId, model: target.modelId }] }
    original.overrides.s = { session: { target: old }, nextTurn: { target: old } }
    const diffs = officialDiffs(original, analysis(['fast', 'pro'], ['old-fast', 'old-vision']))
    expect(diffs).toHaveLength(1); expect(diffs[0].field).toBe('migrateModel'); expect(diffs[0].blockedReasons).toEqual([])
    const next = applyOfficialDiffs(original, diffs)
    expect(next.models.map(model => model.id)).toEqual(['fast', 'pro']); expect(next.models[0]).toMatchObject({ maxTokens: 33, custom: 'keep' })
    expect(next.config.models[modelKey(target)]).toEqual(original.config.models[key]); expect(next.config.models[key]).toBeUndefined()
    expect(next.config.aliases.entry.candidates).toEqual([target, { providerId: 'third-party', modelId: 'old-fast' }])
    expect(next.config.aliases.entry.efforts).toEqual({ [modelKey(target)]: 'high' })
    expect(next.defaultModel).toMatchObject({ model: 'fast', other: 'keep' }); expect(next.subagents?.allowedModels).toHaveLength(1)
    expect(next.overrides.s.nextTurn?.target).toEqual(target); expect(next.config.official?.analyzer).toEqual(target)
    expect(officialDiffs(next, analysis(['fast', 'pro'], ['old-fast', 'old-vision']))).toEqual([])
    expect(original.models).toHaveLength(4)
  })
  it('用户字段／模型键档位冲突阻止迁移，未引用可删、有引用阻止', () => {
    const original = state(['old-fast', 'fast', 'removed'])
    original.models[0].maxTokens = 5; original.models[1].maxTokens = 10
    let diffs = officialDiffs(original, analysis(['fast'], ['old-fast']))
    expect(diffs[0].blockedReasons.join()).toContain('maxTokens')
    expect(() => applyOfficialDiffs(original, [diffs[0]])).toThrow('冲突')
    original.models[0].maxTokens = 10
    original.config.models[modelKey({ providerId: 'deepseek-official', modelId: 'removed' })] = { capability: { image: 'no' } }
    diffs = officialDiffs(original, analysis(['fast'], ['old-fast']))
    expect(diffs.find(diff => diff.modelId === 'removed')?.blockedReasons.length).toBeGreaterThan(0)
    delete original.config.models[modelKey({ providerId: 'deepseek-official', modelId: 'removed' })]
    diffs = officialDiffs(original, analysis(['fast'], ['old-fast']))
    expect(applyOfficialDiffs(original, diffs).models.map(model => model.id)).toEqual(['fast'])
  })
  it('1→2→3→2：新增、移除和更新项分开计数，未知能力和上限保留', () => {
    let current = state(['one'])
    for (const ids of [['one', 'two'], ['one', 'two', 'three'], ['one', 'two']]) {
      const diffs = officialDiffs(current, analysis(ids))
      expect(predictedModelCount({ localModelIds: current.models.map(model => model.id), diffs } as never, diffs.map(diff => diff.id))).toBe(ids.length)
      current = applyOfficialDiffs(current, diffs)
    }
    current.models[0] = { id: 'one', inputModalities: ['text', 'image'], maxTokens: 8, arbitrary: 'preserve' }
    expect(officialDiffs(current, analysis(['one', 'two']))).toEqual([])
  })
})
