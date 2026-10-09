# 架构契约（v3）

`src/domain.ts` 定义配置、迁移、候选解析与真实档位校验；`src/service.ts` 持有目录、设置快照、验证证据、日志和轮次状态；`src/adapter.ts` 执行受管理模型请求并保持请求内选择；`src/auto-router.ts` 调用独立评估器并按能力筛选三档候选；`src/official-sync.ts` 抓取、解析并比较官方资料；`src/index.ts` 装配 DSH 宿主事件、工具与 HTTP；`src/client/` 构建设置页。

模型选择器的 `AUTO` 入口仅在新 AUTO 开启时进行每轮一次评估。评估输入限长，包含最新请求和必要的近期对话；不开放工具，超时 10 秒不重试，失败回退常规档。工具循环复用轮次决策，子 Agent 和内部请求不评估。候选按原等级到更高等级依次检查图片、上下文和实际推理档位；不兼容时跳过，没有候选则报错。已有输出或工具操作后不换模型重做。评估与执行写不同日志事件。

原生 `subagent` 由 DSH 负责启动、分工、并发、后台与回收。插件不注册固定五角色委派工具；可选偏好只注入提示。`subagent_fork` 保持宿主继承父模型的规则。页面与宿主使用同一份 `subagent-model-selection` 设置。

HTTP 路由按 path 唯一注册：`/api/model-manager` 读写 v3 配置；`/refresh` 更新模型目录；`/verify`、`/probe` 记录验证证据；`/native` 写宿主模型声明；`/subagents` 读写原生模型范围；`/recommend` 使用独立推荐模型生成三档草案；`/official-preview`、`/official-apply`、`/official-restore` 完成官方资料同步；`/logs` 读日志；`/overrides` 管理临时选择。写操作使用 revision，冲突返回 409。

Web 设置页分为“模型”“别名与兜底”“AUTO 自动选模型”“子 Agent”“视觉”“日志”。模型页展示声明来源、核对时间与单次验证；官方同步提供字段级预览。日志默认只展示时间、类型、模型、结果和耗时，原始事件在详情中。

## LLM 官方同步契约

文档版本：2026-10-09，对应已确认 SPEC F007／F009，已实现于 0.4.0。前文路由入口仍有效，本节替代旧固定三页、固定表格和固定型号的解析规则。

### 数据流与模块边界

1. 预览开始先失效旧 token，刷新最新模型目录；从当前设置及请求解析入口网址和真实分析模型，固定本次分析输入。缺省使用 `service.hostDefault()`，拒绝受管理 Provider／AUTO／别名；确认模型已加载后直接调用 `ctx.llm.stream`，不传工具和现有会话历史。
2. 宿主获取入口 HTML，去除 script／style、导航等无关正文，保留标题、正文、表格单元格、脚注和 `<a href>` 实际链接。提取是通用 HTML 内容处理，不识别特定模型表。链接转为绝对 HTTPS URL，并剔除 fragment、去重；来源范围以用户给定入口 hostname 为准，不固定 `api-docs.deepseek.com`。
3. 每轮将已读页面正文、链接和来源编号交给 LLM。系统指令约束网页为不可信资料，只提取当前 API 清单；LLM 只能请求已见链接，不自行构造 URL、访问域外来源或执行网页指令。第三轮不得再要求补充页面。
4. 校验 LLM 结构、引用和原文证据；不完整则继续读取合法补充链接后再分析，无法完成则失败。只有完整且无冲突的结果才生成差异。用户点击应用之前，网页获取和 LLM 调用都不改模型配置。
5. 生成差异时重新读取所有迁移涉及的配置和覆盖状态，检查分析前后模型目录与 `llm-deepseek` 设置版本未变化；并发变化时报 409，要求重新预览。预览有效性由本次 generation、token、设置版本和覆盖状态共同决定；旧请求即使晚返回也不得重新发布旧 token。

固定限额：最多六个不同页面（入口加五个补充页）、三轮 LLM 调用，每页最多 2,000,000 个 HTML 字符；提取后的总正文最多 120,000 个字符，超限报错而非截断后宣称完整。每页获取超时 10 秒，最多三次重定向，每轮分析超时 60 秒、输出最多 32,000 个字符；不自动重试 LLM。所有阶段共用取消信号，取消后不得发布 token。重定向也必须 HTTPS 且与入口 hostname 相同；实际最终 URL 写入来源记录。

### 共享类型和 LLM 输出

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
| `/official-preview` | POST | `{ sourceUrl?: string, analyzer?: ModelRef }` | 缺省取已保存配置，再取默认入口／宿主默认模型。JSON 客户端等待完整 OfficialPreview；`Accept: text/event-stream` 返回下述事件。旧 `{sources}` 请求显式报错并提示刷新页面，不把旧三页静默解释为新入口。 |
| `/official-apply` | POST | `{ token: string, selected: string[] }` | 校验 token、唯一且非空的选中 ID、blockedReasons、全部受影响 revision／覆盖状态；成功返回 `{ applied, backupAt, snapshot }`，snapshot 为完整插件状态。 |
| `/official-restore` | POST | `{}` | 依据备份写集检查同步后版本／覆盖状态，再恢复原值和字段存在状态；成功返回 `{ restored: true, snapshot }`。 |

事件流每个事件为 `event: <type>\ndata: <JSON>\n\n`：`progress` 的数据为 `{stage:'reading'|'analyzing'|'diffing', round:number, pageCount:number}`；成功 `result` 的 data 为完整 OfficialPreview；失败 `error` 为 `{error:string}`，均随后结束连接。流开始前错误用原 JSON 400／409；流开始后通过 error 事件反馈，不伪造 HTTP 状态。每 15 秒注释 keepalive，结束／连接关闭清理定时器并取消获取／LLM。浏览器用带 AbortController 的 fetch 读取 POST 流，取消关闭流并清空预览，不能用 EventSource 发 POST。

修改输入网址／分析模型也清空旧预览。表单沿用插件草稿保存；预览可使用草稿字段，但有未保存草稿时禁用应用，提示先保存或放弃并重新预览。应用／恢复后使用完整 snapshot，不能用局部响应替换完整状态。

### 写集、版本与恢复

- 设置写集至多包括 `llm-deepseek.models`、`dsh-model-manager` 的迁移路径和官方同步记录、`agent-default-model`、`subagent-model-selection.allowedModels`，以及 service 可持久化的 session／nextTurn 覆盖。只修改选中操作涉及的字段，不覆盖无关宿主字段。预览保存上述存在的设置 revision，缺失分节记 null；同时保存规范化未来覆盖的 SHA-256 指纹。
- service 为未来覆盖提供串行 CAS 变更接口，与现有 setOverride／nextTurn 消耗共享写队列和状态版本；迁移中保留 active 值。本轮结束自然消耗覆盖不应被同步恢复重新复活。应用先稳定化读取与校验覆盖状态，再逐处按 revision 写入；并发冲突拒绝，不自动以新版本重试旧写集。
- 备份文件仍为 profile 数据目录的 `official-sync-backup.json`，新格式加 `version: 2`、token、入口／实际来源／分析模型、前值及字段存在信息、每处已写后值和 revision／覆盖指纹、状态 `prepared|applying|applied|rolled-back|recovery-required|restored`。备份写入沿用串行队列、临时文件原子替换和 .bak；每处成功写入后记录进度，失败不能留下伪造的 applied 记录。
- 部分写入失败按逆序用已写 revision／覆盖指纹回滚；目标已发生变化时不得覆盖，保留 recovery-required 记录并显示未恢复的具体位置。进程崩溃后不自动覆盖配置，依据记录提示手动核对。恢复只接受完整 applied 状态且写集后值仍一致，先预检所有目标再操作，发生中途冲突时同样保留具体恢复进度。
- 旧格式备份仅恢复旧记录的模型／插件配置和原有 revision，不宣称能恢复新宿主分节或会话覆盖。日志／实测证据不随配置恢复改写。

### 验证与兼容边界

模拟 HTML 与 LLM 分别测试识别流程和宿主写集；客户端冒烟检查表单、流分片、取消、token 失效、计数、阻止项、草稿保护和完整 snapshot。代码修改后顺序执行 typecheck、build、test，再在 development 做真实网页＋LLM 预览与页面验收；不运行真实模型能力验证来证明网页识别正确，不重启 maintenance。只有实际完成相关验收才填写兼容记录。
