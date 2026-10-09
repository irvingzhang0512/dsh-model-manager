import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeOfficial, extractOfficialPage, fetchOfficialPage, validateOfficialAnalysis } from '../src/official-sync.ts'
import { DEFAULT_CONFIG, modelKey, managedId, fromManagedId } from '../src/domain.ts'
import { applyOfficialDiffs, officialDiffs, type OfficialState } from '../src/official-state.ts'
import { predictedModelCount } from '../src/official-types.ts'
import { analysis, html, source } from './official-fixtures.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const runner = { providerId: 'other', modelId: 'reader' }
function llm(outputs: unknown[]) {
  const stream = vi.fn(async function* () { yield { type: 'text-delta', text: typeof outputs[0] === 'string' ? outputs.shift() : JSON.stringify(outputs.shift()) }; yield { type: 'finish', reason: { kind: 'stop' } } })
  return { llm: { stream, resolveModelInfo: async () => ({}) } as never, stream }
}
function state(ids: string[]): OfficialState { return { models: ids.map(id => ({ id })), config: structuredClone(DEFAULT_CONFIG), overrides: {} } }

describe('最新网页和 LLM 分析', () => {
  it('默认 180 秒按轮计时：第一轮 130 秒、四页第二轮 70 秒均完成', async () => {
    vi.useFakeTimers()
    const start = Date.now(), links = [1, 2, 3].map(index => `https://docs.example.test/detail-${index}`)
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(String(url) === source ? html([], [], links) : html(['one', 'two']))))
    const calls: any[] = [], progress: any[] = []
    const runtime = { stream: async function* (options: any) {
      const input = JSON.parse(options.messages[1].content[0].text); calls.push(options)
      await new Promise(resolve => setTimeout(resolve, input.round === 1 ? 130_000 : 70_000))
      const value = input.round === 1 ? { complete: false, conflicts: [], models: [], replacements: [], completenessEvidence: [], requestedUrls: links, notes: [] } : analysis(['one', 'two'], [], input.pages[1])
      yield { type: 'text-delta', text: JSON.stringify(value) }; yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const pending = analyzeOfficial(runtime as never, runner, source, new AbortController().signal, value => progress.push(value))
    await vi.advanceTimersByTimeAsync(200_000)
    const result = await pending
    expect(result.pages).toHaveLength(4); expect(result.analysis.models.map(model => model.id)).toEqual(['one', 'two'])
    expect(progress.filter(value => value.stage === 'analyzing')).toEqual([
      { stage: 'analyzing', round: 1, pageCount: 1, analysisStartedAt: new Date(start).toISOString(), analysisTimeoutSeconds: 180 },
      { stage: 'analyzing', round: 2, pageCount: 4, analysisStartedAt: new Date(start + 130_000).toISOString(), analysisTimeoutSeconds: 180 },
    ])
    expect(calls.every(call => !call.signal.aborted)).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([30, 180, 600])('选择 %s 秒：到绝对截止才取消，忽略适配器挂起', async seconds => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    let signal!: AbortSignal
    const runtime = { stream: (options: any) => { signal = options.signal; return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) } } }
    const pending = analyzeOfficial(runtime as never, runner, source, new AbortController().signal, undefined, undefined, seconds)
    const rejected = expect(pending).rejects.toThrow(`${seconds} 秒`)
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1); await rejected
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([null, '180', '', 29, 601, 30.5, NaN, Infinity])('非法时限 %s 在网页和 LLM 之前拒绝', async value => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const { llm: runtime, stream } = llm([])
    await expect(analyzeOfficial(runtime, runner, source, new AbortController().signal, undefined, undefined, value as never)).rejects.toThrow('30–600 的整数秒')
    expect(fetch).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled()
  })
  it.each(['complete', 'conflicts', 'notes', 'requestedUrls', 'models', 'replacements'])('格式不合格指出 %s，拒绝结果且不自动重试', async field => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const value: Record<string, unknown> = { ...analysis(['one']) }
    delete value[field]
    const { llm: runtime, stream } = llm([value])
    await expect(analyzeOfficial(runtime, runner, source, new AbortController().signal)).rejects.toThrow(`分析结果格式无效：${field}`)
    expect(stream).toHaveBeenCalledOnce()
  })
  it.each([null, [], 'model one'])('顶层 %j 不是对象时不误认清单', value => {
    expect(() => validateOfficialAnalysis(value, [extractOfficialPage(html(['one']), source)])).toThrow('顶层必须是 JSON 对象')
  })
  it('缺少名称证据指出属性位置，不自动丢属性放行结果', () => {
    const value = analysis(['one']); value.models[0].name = 'Display One'
    expect(() => validateOfficialAnalysis(value, [extractOfficialPage(html(['one']), source)])).toThrow('models[0].propertyEvidence.name 缺少原文证据')
  })
  it.each(['conflicts', 'notes', 'requestedUrls', 'models', 'replacements'])('数组 %s 为 null 或字符串时不隐式补空', field => {
    const pages = [extractOfficialPage(html(['one']), source)]
    for (const invalid of [null, '[]']) expect(() => validateOfficialAnalysis({ ...analysis(['one']), [field]: invalid }, pages)).toThrow(`分析结果格式无效：${field}`)
  })
  it('适配器忽略取消且 next／return 都挂起时，60 秒仍及时结束', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const never = () => new Promise<never>(() => {})
    const returned = vi.fn(never), started = vi.fn()
    const runtime = { stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => { started(); return never() }, return: returned }) }) }
    const pending = analyzeOfficial(runtime as never, runner, source, new AbortController().signal, undefined, undefined, 60)
    const rejected = expect(pending).rejects.toThrow('60 秒')
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(returned).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  }, 1000)
  it('适配器忽略取消时立即结束；迟到的结果不恢复预览', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const controller = new AbortController()
    let resolveNext!: (value: IteratorResult<unknown>) => void
    const returned = vi.fn(async () => { throw new Error('清理失败') })
    const next = vi.fn(() => new Promise<IteratorResult<unknown>>(resolve => { resolveNext = resolve }))
    const runtime = { stream: () => ({ [Symbol.asyncIterator]: () => ({ next, return: returned }) }) }
    const pending = analyzeOfficial(runtime as never, runner, source, controller.signal)
    const rejected = expect(pending).rejects.toThrow('用户取消')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('用户取消'))
    await rejected
    resolveNext({ done: false, value: { type: 'text-delta', text: JSON.stringify(analysis(['one'])) } })
    await vi.advanceTimersByTimeAsync(0)
    expect(next).toHaveBeenCalledOnce(); expect(returned).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('持续推理输出不延长每轮 60 秒上限', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const runtime = { stream: async function* () {
      while (true) { await new Promise(resolve => setTimeout(resolve, 1000)); yield { type: 'reasoning-delta', text: 'thinking' } }
    } }
    const pending = analyzeOfficial(runtime as never, runner, source, new AbortController().signal, undefined, undefined, 60)
    const rejected = expect(pending).rejects.toThrow('60 秒')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    await vi.advanceTimersByTimeAsync(1000) // 迟到的 next 完成后允许适配器清理。
    expect(vi.getTimerCount()).toBe(0)
  })
  it('正常结束清理截止计时，不再取消已完成的分析', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    let receivedSignal!: AbortSignal
    const runtime = { stream: async function* (options: { signal: AbortSignal }) {
      receivedSignal = options.signal
      yield { type: 'text-delta', text: JSON.stringify(analysis(['one'])) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const result = await analyzeOfficial(runtime as never, runner, source, new AbortController().signal)
    expect(result.analysis.models.map(model => model.id)).toEqual(['one'])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(65_000)
    expect(receivedSignal.aborted).toBe(false)
  })
  it('服务端拒绝推理参数时给出可操作提示，不回显原始响应或凭据', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const runtime = { resolveModelInfo: async () => ({}), stream: async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: '400 reasoning_effort none is not supported; Bearer private-key' } } } } }
    await expect(analyzeOfficial(runtime as never, runner, source, new AbortController().signal)).rejects.toThrow('分析模型拒绝推理档位')
  })
  it('保留导航和正文外的实际链接供补充读取，不将导航型号当正文证据', () => {
    const page = extractOfficialPage('<nav>obsolete-model<a href="/new-pricing">模型资料</a></nav><main>Current model one</main><script><a href="/fake-script">假的</a></script><!--<a href="/fake-comment">假的</a>-->', source)
    expect(page.links).toEqual(['https://docs.example.test/new-pricing'])
    expect(page.text).toBe('Current model one')
  })
  it.each([['low', undefined], ['high', 'high'], ['off', undefined]])('留空省略档位，不自动选择公开 %s／默认 %s', async (supported, defaultEffort) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const { llm: runtime, stream } = llm([analysis(['one'])])
    Object.assign(runtime, { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: supported }], defaultEffort } }) })
    await analyzeOfficial(runtime, runner, source, new AbortController().signal)
    expect(stream.mock.calls[0][0]).not.toHaveProperty('reasoningEffort')
    expect(stream.mock.calls[0][0].messages[0].source).toEqual({ kind: 'plugin', plugin: 'dsh-model-manager' })
  })
  it.each(['low', 'high', 'off'])('只传递显式选择的公开档位 %s', async effort => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html(['one']))))
    const { llm: runtime, stream } = llm([analysis(['one'])])
    Object.assign(runtime, { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: effort }] } }) })
    await analyzeOfficial(runtime, runner, source, new AbortController().signal, undefined, effort)
    expect(stream.mock.calls[0][0].reasoningEffort).toBe(effort)
  })
  it('不公开的推理档位在读取网页／调用 LLM 前拒绝', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const { llm: runtime, stream } = llm([])
    await expect(analyzeOfficial(runtime, runner, source, new AbortController().signal, undefined, 'high')).rejects.toThrow('不支持推理档位')
    expect(fetch).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled()
  })
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
    expect(managedId(next.config.aliases.entry.candidates[0])).toBe('deepseek-official/fast')
    expect(fromManagedId(managedId(next.config.aliases.entry.candidates[0]))).toEqual(target)
    expect(fromManagedId(Buffer.from(JSON.stringify([old.providerId, old.modelId])).toString('base64url'))).toEqual(old)
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
