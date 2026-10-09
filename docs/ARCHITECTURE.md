# 架构契约（v3）

## 2026-10-10 临时分析时限（0.7.0）

对应 SPEC F007／F009，2026-10-10 用户明确回复“确认这版，继续实现”后开发。本节替代原固定每轮 60 秒，覆盖分析时限、临时参数及相关进度契约；配置 v3 不变。

- `POST /api/model-manager/official-preview` 增加可选 `analysisTimeoutSeconds?: number`；省略使用 180，提供时必须是 30–600 的安全整数。null、字符串、空值、小数和越界在网页获取／LLM 调用前拒绝。每次请求固定有效值，传给 `analyzeOfficial`，不读取任何新持久化设置。
- `analyzeOfficial(..., requestedEffort?: string, analysisTimeoutSeconds = 180)` 在读取网页前校验同一范围，沿用 0.6.1 竞争流读取与取消的实现。每轮开始建立一次截止计时器，触发秒数为本次有效值，错误说明该值；正常／失败／取消均清理。持续推理输出不能延长截止；每页 10 秒、六页三轮和不自动重试保持。
- 共享 `officialAnalysisTimeout(value?: unknown): number` 负责缺省 180 和严格范围校验，宿主／分析器共用；客户端将 numeric 输入解析为数值后调用同一校验，空输入不视为省略。
- `OfficialProgress` 在 analyzing 时额外携带 `analysisStartedAt: string`（宿主 ISO 时间）和 `analysisTimeoutSeconds: number`；reading／diffing 可省略。浏览器按此开始时间每秒显示本轮已用秒数和时限，切换轮次重置显示、结束／取消卸载计时；浏览器显示不控制宿主截止。事件类型、keepalive 和旧字段保持，旧客户端可忽略新增字段。
- `OfficialPreview` 增加必填实际 `analysisTimeoutSeconds: number`。新备份记录该有效值作为操作审计参数；既有 version:2 备份缺字段仍可恢复，不补写偏好或把分析参数纳入恢复写集。
- 客户端独立临时 numeric 输入“每轮分析时限（秒）”，默认 180，30–600 整数；不得进入插件 draft、localStorage 或设置接口。更改时限清空旧预览，开始后禁用参数输入而取消保持可用；普通插件保存／重新加载保留临时输入。无持久化配置版本变化。
- 验收包含超出旧 60 秒但在新截止内成功的四页／第二轮模拟、60／180／边界截止、非法参数提前拒绝、继续推理不延长截止、取消与无写入、客户端计时清理及日常真实预览。真实 LLM 时长和链接选择不固定，应逐次记录，不把单次成功表述为稳定性保证。

## 2026-10-09 临时分析参数契约

本节对应 SPEC F007／F009，2026-10-10 经用户明确确认并实现于 0.6.0，替代原表单草稿保存及自动选择 low。

- 客户端为入口、分析模型、推理档位建立独立页面状态，不使用 `edit(draft)`、localStorage 或设置写接口。首次加载用已有 official 配置和默认入口初始化；未选择分析模型时使用当前宿主默认真实模型。普通插件保存／重新加载不保存或丢弃这组三项临时参数。
- 插件 snapshot 新增可选 `hostDefault: ModelRef`，用于未选择模型时展示其公开档位，不包含凭据。三项参数变化立即作废旧预览；切换分析模型清空档位。UI 只展示对应 ModelRecord.reasoningEfforts，默认项为“使用模型默认”；未公开档位只显示默认。同步参数不计入插件 dirty；其他插件草稿仍按既有规则阻止应用／恢复，允许用户放弃草稿后重新预览。
- `/official-preview` POST 增加 `reasoningEffort?: string`，analyzer 允许 `ModelRef | null`：显式 null 表示使用宿主默认，不读取旧保存 analyzer；省略 analyzer 维持旧 API 客户端缺省规则。客户端每次显式发送 ModelRef 或 null；默认档位省略 reasoningEffort，不读取或新增持久化档位字段。
- 宿主解析分析模型后，仅在显式选择档位时调用 resolveModelInfo；显式档位必须是非空字符串且出现在该模型公开 efforts 中，非法值在读取网页及调用 LLM 前拒绝。不显式指定档位则省略 GenerateOptions.reasoningEffort，不自动选择 low，也不改 Provider 设置或尝试别的档位。
- OfficialPreview 增加 `reasoningEffort?: string` 记录本次实际显式档位，界面显示对应档位或“模型默认”。同一预览的各轮均使用该参数；备份可记录该临时请求字段供审计，但应用不能将入口／分析模型／档位写成偏好设置。原 checkedAt、模型及引用写集、revision 和覆盖指纹规则保持。
- 验收覆盖准确传参、默认省略、模型切换清空、不支持档位提前拒绝、独立表单不污染 dirty 或持久化、无其他草稿可直接应用，以及既有取消／失效／草稿保护／CAS／恢复回归。

`src/domain.ts` 定义配置、迁移、候选解析与真实档位校验；`src/service.ts` 持有目录、设置快照、验证证据、日志和轮次状态；`src/adapter.ts` 执行受管理模型请求并保持请求内选择；`src/auto-router.ts` 调用独立评估器并按能力筛选三档候选；`src/official-sync.ts` 抓取、解析并比较官方资料；`src/index.ts` 装配 DSH 宿主事件、工具与 HTTP；`src/client/` 构建设置页。

模型选择器的 `AUTO` 入口仅在新 AUTO 开启时进行每轮一次评估。评估输入限长，包含最新请求和必要的近期对话；不开放工具，超时 10 秒不重试，失败回退常规档。工具循环复用轮次决策，子 Agent 和内部请求不评估。候选按原等级到更高等级依次检查图片、上下文和实际推理档位；不兼容时跳过，没有候选则报错。已有输出或工具操作后不换模型重做。评估与执行写不同日志事件。

原生 `subagent` 由 DSH 负责启动、分工、并发、后台与回收。插件不注册固定五角色委派工具；可选偏好只注入提示。`subagent_fork` 保持宿主继承父模型的规则。页面与宿主使用同一份 `subagent-model-selection` 设置。

HTTP 路由按 path 唯一注册：`/api/model-manager` 读写 v3 配置；`/refresh` 更新模型目录；`/verify`、`/probe` 记录验证证据；`/native` 写宿主模型声明；`/subagents` 读写原生模型范围；`/recommend` 使用独立推荐模型生成三档草案；`/official-preview`、`/official-apply`、`/official-restore` 完成官方资料同步；`/logs` 读日志；`/overrides` 管理临时选择。写操作使用 revision，冲突返回 409。

Web 设置页分为“模型”“别名与兜底”“AUTO 自动选模型”“子 Agent”“视觉”“日志”。模型页展示声明来源、核对时间与单次验证；官方同步提供字段级预览。日志默认只展示时间、类型、模型、结果和耗时，原始事件在详情中。

## 可读受管理模型标识契约

文档版本：2026-10-09，对应 SPEC F001／F008；基线 0.4.0，经用户“继续开发”明确确认后实现于 0.5.0。本节不改变后文已确认的 F007／F009 官方同步契约。

### 标识接口与格式

- `managedId(ref: ModelRef): string` 与 `fromManagedId(id: string): ModelRef` 的导出、参数和返回类型不变。
- 新生成格式为 `encodeURIComponent(providerId) + '/' + encodeURIComponent(modelId)`；两部分分别转义，原始斜杠、百分号等不能改变分隔结构。示例 ID 为 `arkcli-coding-plan/deepseek-v4-1-flash`，宿主拼接 Provider 后可呈现 `dsh-model-manager/arkcli-coding-plan/deepseek-v4-1-flash`。
- 包含原始 `/` 的 ID 按新格式处理：必须恰有一个分隔符、两部分均非空，分别 `decodeURIComponent` 后得到非空的平台 ID 和模型 ID。多余分隔符、非法转义或解码后空字段报 `无效的受管理模型 ID`，不再尝试旧格式。
- 不含原始 `/` 的具体模型 ID 按旧格式处理：校验 Base64url 编码，解码 UTF-8 JSON，结果必须为两个非空字符串构成的数组 `[providerId, modelId]`。无效编码／JSON／形状统一报 `无效的受管理模型 ID`；兼容本插件原 `managedId()` 生成的旧 ID。
- `auto` 与 `alias:<名称>` 仍由现有请求入口优先识别，不送入具体模型 ID 解码器；新格式与这两类入口不冲突。

### 路由、存储与历史边界

- 主请求改写和受管理子任务现有调用点继续使用 `managedId()`；适配器的 `resolveModel`、`prepareCall` 与 `stream` 通过兼容解码定位实际模型。请求中的实际 Provider／Model 及推理参数不因表示格式变化而改变。
- 保持 `modelKey()` 的 JSON 复合键、配置 v3、`ModelRef` 对象和所有 HTTP 配置接口不变；不新增配置项、依赖或迁移脚本。
- 保留已有受管理请求的 ID，不在读取时主动标准化宿主选择；历史通知／日志原样保留，不修改 DSH 核心或聊天显示层，不承诺已存提示自动可读。AUTO 与别名继续呈现逻辑入口。
- 官方同步仍依据实际模型引用和 `modelKey()` 执行迁移与完整写集备份／恢复；此次不改其迁移规则，已固定请求、历史证据与缓存保持原边界。

### 验收与交付

- 单元和假宿主覆盖新旧 ID 的相同调用目标、不同平台同名模型隔离、特殊字符往返、非法输入拒绝，以及主请求／子任务的路由生成。AUTO、别名、视觉与请求快照现有回归保持通过。
- 官方同步回归覆盖迁移后的模型键和引用、新生成路由指向目标模型，以及应用后完整备份／恢复；保留真实 LLM 成功预览待办，不以模拟测试替代该验收。
- 实施后依次执行 typecheck、build、完整测试与客户端冒烟；只重启 development，用专用会话检查新提示可读与旧 ID 可调用。缺 GUI 或凭据时记录具体未验收项，不登记整体兼容通过。
- 本次目标包版本 0.5.0；文档阶段不提高版本。实现验证后同步说明／更新记录／验收记录，插件独立提交后同步根完整版本锁，按脚本核对安装快照及维护资料，不自动推送。

## LLM 官方同步契约

文档版本：2026-10-09，对应已确认 SPEC F007／F009，已实现于 0.4.0。前文路由入口仍有效，本节替代旧固定三页、固定表格和固定型号的解析规则。

### 数据流与模块边界

1. 预览开始先失效旧 token，刷新最新模型目录；从当前设置及请求解析入口网址和真实分析模型，固定本次分析输入。缺省使用 `service.hostDefault()`，拒绝受管理 Provider／AUTO／别名；确认模型已加载后直接调用 `ctx.llm.stream`，不传工具和现有会话历史。
2. 宿主获取入口 HTML，去除 script／style、导航等无关正文，保留标题、正文、表格单元格、脚注和 `<a href>` 实际链接。提取是通用 HTML 内容处理，不识别特定模型表。链接转为绝对 HTTPS URL，并剔除 fragment、去重；来源范围以用户给定入口 hostname 为准，不固定 `api-docs.deepseek.com`。
3. 每轮将已读页面正文、链接和来源编号交给 LLM。系统指令约束网页为不可信资料，只提取当前 API 清单；LLM 只能请求已见链接，不自行构造 URL、访问域外来源或执行网页指令。第三轮不得再要求补充页面。
4. 校验 LLM 结构、引用和原文证据；不完整则继续读取合法补充链接后再分析，无法完成则失败。只有完整且无冲突的结果才生成差异。用户点击应用之前，网页获取和 LLM 调用都不改模型配置。
5. 生成差异时重新读取所有迁移涉及的配置和覆盖状态，检查分析前后模型目录与 `llm-deepseek` 设置版本未变化；并发变化时报 409，要求重新预览。预览有效性由本次 generation、token、设置版本和覆盖状态共同决定；旧请求即使晚返回也不得重新发布旧 token。

限额：最多六个不同页面（入口加五个补充页）、三轮 LLM 调用，每页最多 2,000,000 个 HTML 字符；提取后的总正文最多 120,000 个字符，超限报错而非截断后宣称完整。每页获取超时 10 秒，最多三次重定向，每轮分析默认 180 秒、临时可选 30–600 整数秒，输出最多 32,000 个字符；不自动重试 LLM。所有阶段共用取消信号，取消后不得发布 token。重定向也必须 HTTPS 且与入口 hostname 相同；实际最终 URL 写入来源记录。

0.6.1 等待修复：每轮使用插件截止计时器，将外部取消和截止信号传给适配器，并在读取异步迭代器时竞争该信号。不依赖适配器及时响应 abort；超时／取消后的 iterator.return 只尽力清理，不阻塞错误反馈。正常完成／失败都清理截止计时器和监听器；迟到输出不得恢复结果或发布 token。此处保证插件结束等待，不能保证忽略取消的上游立即停止计算，不改变上述既有时间限额。

0.6.2 分析提示及错误定位修复：提示以仅含 id／evidence 的最小模型结构演示，单独说明有原文证据时才返回可选属性及 propertyEvidence；清单完整性不依赖可选属性齐全，不要求先补充定价／能力资料。全部七个顶层字段始终必填，空数组必须显式返回；校验失败定位具体字段或证据路径，不回显任意模型输出值。仍不补造结果、不自动重试，未知属性和不完整清单继续按原契约处理。

### 共享类型和 LLM 输出

独立分析仅传用户显式选择且经真实 metadata 校验的档位；模型默认时省略 reasoningEffort，不自动选择 low。系统消息来源标记为插件。正文排除导航，但实际链接从去掉脚本／样式／注释的整页 HTML 提取，导航链接仍可用于补充读取。

宿主与浏览器共享类型，不再在客户端复制不完整的 OfficialPreview。以下为本次线协议字段，模型 ID 为不含空白的非空字符串，不限制厂商命名规律。

```ts
type OfficialEvidence = { source: string; quote: string }
type OfficialModel = {
  id: string
  name?: string
  image?: boolean
  contextWindow?: number
  efforts?: string[]
  evidence: OfficialEvidence[]
  propertyEvidence?: Partial<Record<'name' | 'image' | 'contextWindow' | 'efforts', OfficialEvidence[]>>
}
type OfficialReplacement = { oldId: string; newId: string; evidence: OfficialEvidence[] }
type OfficialAnalysis = {
  complete: boolean
  conflicts: string[]
  models: OfficialModel[]
  replacements: OfficialReplacement[]
  completenessEvidence: OfficialEvidence[]
  requestedUrls: string[]
  notes: string[]
}
type OfficialPage = { url: string; fetchedAt: string; text: string; links: string[] }
type OfficialProgress = {
  stage: 'reading' | 'analyzing' | 'diffing'; round: number; pageCount: number
  analysisStartedAt?: string; analysisTimeoutSeconds?: number
}
type OfficialDiff = {
  id: string
  modelId: string
  field: 'name' | 'inputModalities' | 'contextWindow' | 'addModel' | 'migrateModel' | 'removeModel'
  before: unknown
  after: unknown
  evidence: OfficialEvidence[]
  reason: string
  references: string[]
  blockedReasons: string[]
}
type OfficialPreview = {
  token: string
  sourceUrl: string
  analyzer: ModelRef
  reasoningEffort?: string
  analysisTimeoutSeconds: number
  fetchedAt: string
  pages: { url: string; fetchedAt: string }[]
  analysis: OfficialAnalysis
  diffs: OfficialDiff[]
  notes: string[]
  revisions: Record<string, number | null>
  overridesFingerprint: string
  localModelIds: string[]
}
```

- LLM 返回单个 JSON 对象，可剥离包围整个对象的 Markdown 代码围栏，不从任意混杂文本里截取一个对象。失败、字段类型错误、重复／空 ID、替代目标不在当前清单、同一旧 ID 指向多个目标、替代链／环均拒绝。
- `complete: true`、`conflicts: []`、非空 `models`、非空完整性证据和空 `requestedUrls` 才可生成预览。完整性是 LLM 的语义判断，用户可查证；程序校验证据并不证明厂商事实或当前账号可调用。
- 所有 `source` 必须对应已读页面最终 URL，`quote` 按统一空白归一化后必须是该页面正文的非空连续子串。每个当前模型证据必须出现完整 ID；替代关系证据须明确包含旧／新 ID 及其关系，不能仅凭两个名称同时出现推断替代。
- 属性有对应原文证据且类型有效才采纳；缺省或 null 属性作为未知。不能把未知图片能力写成不支持，不从模型名称猜能力，不把官方 maximum output tokens 覆盖用户输出上限。`efforts` 为资料证据展示，仍以宿主真实公开档位决定运行时可选值，本次不新增 Provider 推理接口。
- 补充请求 URL 必须是已读页面 links 中的同 hostname 链接，每批去重并排除已读页面；空增量、不合法链接或超限报错。最终冲突／不完整不采用旧结果。

### 差异与引用迁移

- 比较基线使用最新宿主完整 ModelInfo 和 `llm-deepseek.models` 的并集：显式条目优先、目录补齐；不存在显式数组时从有效目录物化模型配置，保留已公开未知字段和默认元数据，不只复制 ModelRecord 的展示字段。只有差异选中后才写显式数组。
- `addModel.after` 是一个 OfficialModel；未知 name 使用 ID 显示，未知能力不写相应配置字段。字段更新只写对应公开模型字段；`removeModel.after` 为 null。
- `migrateModel.modelId` 为目标 ID，`after` 为 `{ oldIds: string[], target: OfficialModel }`，同目标的所有旧 ID 合为一个操作。目标不存在时创建包含在该操作内，不重复生成独立新增项；已经存在时保留目标设置，旧设置的缺失字段可补入。官方已知且选中更新的声明字段允许随迁移更新；输出上限、未知字段和其他用户设置两端不一致则阻止迁移，列出冲突路径，不静默决定胜者。
- 建立明确路径的引用访问器，不用递归替换任意字符串：`aliases.*.candidates`、`aliases.*.efforts` 的 modelKey、`models` 的 modelKey、`auto.evaluator`／各 Selection（含 main、roles、preferences）、`vision.target`、`official.analyzer`；宿主 `agent-default-model.{provider,model}`、`subagent-model-selection.allowedModels`；service 的 session／nextTurn Selection。仅当 provider 为 `deepseek-official` 才迁移。别名去重保留顺序，efforts／能力覆盖递归合并时不同叶值列为冲突。
- 无替代模型的移除项检查同一组引用路径，模型键设置本身也属于引用；阻止项不能应用。active 轮次选择、AUTO 当前轮次决定、请求快照、历史日志、验证和视觉缓存不迁移；没有配置或未来覆盖引用时，正在执行的旧请求不阻止目录移除，由已固定快照继续执行。
- 列表数量由模型 ID 集合计算：按选中新增、迁移、移除模拟得到预计数量，字段更新不计数。只选择部分差异不宣称已完全与官方同步；LLM 的当前模型数也不是差异项数。

### HTTP 与进度

各路径仍仅注册一次，并沿用 trusted caller 校验、405／Allow、无缓存响应。正式改动在以下同路径 handler 内实现。

| Path（前缀 `/api/model-manager`） | Method | 请求 | 响应／规则 |
| --- | --- | --- | --- |
| `/official-preview` | POST | `{ sourceUrl?: string, analyzer?: ModelRef | null, reasoningEffort?: string, analysisTimeoutSeconds?: number }` | 省略入口／分析模型时保持旧客户端缺省；显式 analyzer:null 使用宿主默认，推理档位留空时省略，时限省略采用 180。JSON 客户端等待完整 OfficialPreview；`Accept: text/event-stream` 返回下述事件。旧 `{sources}` 请求显式报错并提示刷新页面，不把旧三页静默解释为新入口。 |
| `/official-apply` | POST | `{ token: string, selected: string[] }` | 校验 token、唯一且非空的选中 ID、blockedReasons、全部受影响 revision／覆盖状态；成功返回 `{ applied, backupAt, snapshot }`，snapshot 为完整插件状态。 |
| `/official-restore` | POST | `{}` | 依据备份写集检查同步后版本／覆盖状态，再恢复原值和字段存在状态；成功返回 `{ restored: true, snapshot }`。 |

事件流每个事件为 `event: <type>\ndata: <JSON>\n\n`：`progress` 的数据为 `{stage:'reading'|'analyzing'|'diffing', round:number, pageCount:number}`；成功 `result` 的 data 为完整 OfficialPreview；失败 `error` 为 `{error:string}`，均随后结束连接。流开始前错误用原 JSON 400／409；流开始后通过 error 事件反馈，不伪造 HTTP 状态。每 15 秒注释 keepalive，结束／连接关闭清理定时器并取消获取／LLM。浏览器用带 AbortController 的 fetch 读取 POST 流，取消关闭流并清空预览，不能用 EventSource 发 POST。

修改临时网址／分析模型／档位清空旧预览，切换模型清空档位。临时参数不计入插件草稿；其他未保存草稿仍禁用应用，可保存或放弃后重新预览。应用／恢复后使用完整 snapshot，不能用局部响应替换完整状态。

### 写集、版本与恢复

- 设置写集至多包括 `llm-deepseek.models`、`dsh-model-manager` 的迁移路径和官方同步记录、`agent-default-model`、`subagent-model-selection.allowedModels`，以及 service 可持久化的 session／nextTurn 覆盖。只修改选中操作涉及的字段，不覆盖无关宿主字段。预览保存上述存在的设置 revision，缺失分节记 null；同时保存规范化未来覆盖的 SHA-256 指纹。
- service 为未来覆盖提供串行 CAS 变更接口，与现有 setOverride／nextTurn 消耗共享写队列和状态版本；迁移中保留 active 值。本轮结束自然消耗覆盖不应被同步恢复重新复活。应用先稳定化读取与校验覆盖状态，再逐处按 revision 写入；并发冲突拒绝，不自动以新版本重试旧写集。
- 备份文件仍为 profile 数据目录的 `official-sync-backup.json`，新格式加 `version: 2`、token、入口／实际来源／分析模型、前值及字段存在信息、每处已写后值和 revision／覆盖指纹、状态 `prepared|applying|applied|rolled-back|recovery-required|restored`。备份写入沿用串行队列、临时文件原子替换和 .bak；每处成功写入后记录进度，失败不能留下伪造的 applied 记录。
- 部分写入失败按逆序用已写 revision／覆盖指纹回滚；目标已发生变化时不得覆盖，保留 recovery-required 记录并显示未恢复的具体位置。进程崩溃后不自动覆盖配置，依据记录提示手动核对。恢复只接受完整 applied 状态且写集后值仍一致，先预检所有目标再操作，发生中途冲突时同样保留具体恢复进度。
- 旧格式备份仅恢复旧记录的模型／插件配置和原有 revision，不宣称能恢复新宿主分节或会话覆盖。日志／实测证据不随配置恢复改写。

### 验证与兼容边界

模拟 HTML 与 LLM 分别测试识别流程和宿主写集；客户端冒烟检查表单、流分片、取消、token 失效、计数、阻止项、草稿保护和完整 snapshot。代码修改后顺序执行 typecheck、build、test，再在 development 做真实网页＋LLM 预览与页面验收；不运行真实模型能力验证来证明网页识别正确，不重启 maintenance。只有实际完成相关验收才填写兼容记录。
