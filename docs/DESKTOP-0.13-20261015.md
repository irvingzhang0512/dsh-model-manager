# Desktop 0.13.0 功能与技术契约

文档版：`model-manager-desktop-20261015-v1`。日期：2026-10-15。

基线：0.12.0，源码 `ff863f8a8ffae95f25a3ae4b56b1c23f7589e7a1`；目标：插件 0.13.0、DSH Desktop 0.2.0-rc.2。实现状态：待实现；本版文档确认：待用户确认。用户已明确要求实施对话中的完整计划；本文件及同版 SPEC／架构／配置是按仓库流程提交的具体契约，不能将计划授权倒记为这些新增文档已经确认。

本版覆盖 SPEC F001–F005、F007–F013，回归已经实现的 F006；不实施未确认的 `batch-verification-20261010-v1`。原始 REQUIREMENTS 只读，历史实现和验证证据保留。本版与旧文档冲突时，目标版本以本版为准；旧规则仍描述 0.12.0 基线，不表示新行为已经实现。

## 1. 当前事实与接入边界

| 项目 | 本次只读核查结果 | 目标行为 |
| --- | --- | --- |
| Desktop | 本机安装包为 0.2.0-rc.2；插件仍引用旧 SettingsProvider／settings.section | 只对实际目标组合适配与验收，不声称支持其他宿主版本 |
| DeepSeek 官方 | 原生路由 deepseek-official；公开适配器声明 off／low／high／max；API 模型清单有模态和 effort 信息 | 原生目录与声明仍归实际官方所有者，不新增推理引擎 |
| 火山 Agent Plan | 当前 pi-ai 自定义目录逐模型统一配置七档；部分 input 为空 | 显示声明来源及映射；资料、兼容接受值与实际不同强度分开，不直接认定配置错误或批量修正 |
| OpenCode Go | 日常已安装 dsh-opencode-go 0.1.22；自有目录、账号、用量及 reasoningChoices | 从该 Provider 读模型，不复制账号存储、协议选择或用量轮询 |
| 别名／AUTO／图片 | 0.12.0 有逐候选恢复、三档评估和手动图片工具；无跨请求冷却或自动图片摘要 | 新功能按下文实现，旧通过记录不能外推为 Desktop 兼容 |

资料依据：[DeepSeek 模型接口](https://api-docs.deepseek.com/api/list-models/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[火山模型清单鉴权](https://docs.volcengine.com/docs/ark/list-ark-agent-plan-model-api?lang=en)、[ArkCLI 资源契约](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-resources/SKILL.md)、[OpenCode Go](https://opencode.ai/docs/go/)。官方清单或目录建议不等于账户权限／额度或真实调用验证。

## 2. 来源接入与目录操作（F001／F007／F010／F011／F013）

### 界面与所有权

- 原生插件详情内提供六个标签：模型来源、模型、别名与兜底、AUTO 自动选模型、视觉、日志。来源列表显示平台、实际 Provider、连接所有者、凭据是否配置、目录来源／获取时间及已加载状态。
- DeepSeek 和火山的来源表单提供连接、读取模型和高级设置。字段写回真实所有者；插件只保存来源关联及选定 ArkCLI Profile，不镜像地址、协议、Key 或账号令牌。
- 通过 llm.listConfigurableProviders() 的 settingsNs／settingsPath 和 configEditor.configuration() 定位实际唯一 entry；不要根据包名或旧固定分节名称推断所有者。DeepSeek 的共享目录与 API Key 连接条目分别解析。
- OpenCode Go 的“账号与来源设置”使用公开 pluginNavigation 打开其现有设置；返回管理器后刷新该 Provider 目录。不存在原生导航或未安装时显示原因，不读取私有文件或创建第二套 OpenCode Provider。该集成是可选能力，不阻止其他来源和管理器挂载。
- 高级设置仅显示实际所有者公开支持的字段。DeepSeek 使用官方适配器协议；火山新来源预设 pi-ai openai-completions 和 https://ark.cn-beijing.volces.com/api/plan/v3，已有协议／地址不自动改变。可明确选择目标宿主支持的其他协议；失败不自动改协议、域名或切到按量计费地址。

### 凭据独立保存

- 已有来源只读取凭据引用及 configured／writable 状态。新增 Key 通过 Credentials 独立保存，输入框提交后清空；随后用该引用自动读取模型并生成预览。按钮说明“先保存凭据，再读取模型”。
- 新接入默认创建独立合法引用，不覆盖已有 Key；“更换已有 Key”是原生凭据界面的独立明确动作。取消／失败的模型导入不撤销已成功保存的凭据，页面明确显示两项结果；模型事务备份不包含秘密值，恢复模型配置也不恢复／删除 Key。
- Key 不进入管理器配置、预览持久文件、浏览器持久存储、命令参数或日志；服务端只在一次操作内 resolve。读取模型清单不附加聊天探测，不把保存凭据成功记作模型调用成功。

### 平台发现

- DeepSeek：从连接所有者的端点读取 /models，确定性解析 id、name、input_modalities、context_window、max_output_tokens、effort 和公开协议能力。未知字段不猜；API 返回的等级与宿主可写契约不一致时展示差异，不创造官方 schema 不支持的字段。
- 火山：选定 ArkCLI Profile，执行 auth status 后仅查询该 Profile 的 text 资源；只允许 agent-plan／agent-plan-team。区分 invocable／required_overrides、账户可见与实际调用成功。使用结果中的数据面调用 ID，不把展示名称或控制面 ID 随意转换为调用目标。
- ArkCLI 是可选外部工具，受限子进程参数由宿主构造，不执行浏览器提供的任意命令，使用参数数组及 shell=false。查询冻结 CLI 更新行为、显式传 Profile，不调用 profile use、profile keys、apikey、model-apply 或购买／轮转命令，不读取身份存储文件。
- 未登录时由用户点击“连接火山账号”进入官方授权：用 CLI 的两阶段 no-browser 流程，原样提供官方授权链接、接收本次授权码并完成；状态与超时反馈独立于来源草稿。登录本身可能更新 ArkCLI 身份／Profile，由连接操作明确说明；只读查询不能暗中登录或保证登录自身毫无持久影响。登录后重新选择实际 Profile；不静默切换 DSH 的调用 Key。
- 同一宿主一次只允许一个登录流程，loginToken 绑定本次 CLI 待授权状态；重复点击返回当前流程，过期／取消后旧 code 不能用于新流程。不调用 profile show／list／keys list 作为只读状态查询，它们可能同步并回写 Key 库存。
- 工具缺失、认证失败或清单为空时，保留已有目录和草稿，提供重试及手动模型入口，不退回另一身份。账户模型清单缺少能力字段时保留宿主声明，沿用 F011 的资料补全；不能给全部模型自动填七档或图片支持。
- OpenCode Go：沿用原插件同步后的 llm.listModels／resolveModelInfo；本插件不另抓一份替代目录，不改变原插件刷新周期。

### 预览、应用及引用

- 连接／刷新返回带来源与时间的目录预览，不写模型配置。每个模型显示原值、新值和采用字段；新模型可默认勾选，有用户不同值的字段默认不勾选。maxTokens 会改变请求默认输出上限，始终默认不选。
- 新增或更新采用复合主键；刷新不自动删除、合并或迁移下架模型。手动改 ID、删除和官方替代仍使用原有独立目录操作，完整处理有效引用。
- source 预览接入 CatalogPreview，新增 origin='source'，复用 catalog-resolve／catalog-apply／catalog-restore。冻结真实所有者、原始用户层／继承层 token、目录、插件配置和未来覆盖指纹；取消不写目录，基线变化拒绝应用。
- 配置、凭据是独立保存结果。多个配置所有者不是宿主原子事务：应用前备份完整选中写集，逐所有者 CAS 写入，失败仅在仍匹配本次写后状态时回滚；冲突项保留并显示 recovery-required，不报告全部成功。
- 图片声明只写实际可编辑模型的 input／inputModalities；DeepSeek／pi-ai 支持，OpenCode Go 未公开可写项只读。保留其他模态与未知字段，不用统一数组覆盖未知模态。移除图片声明前检查视觉目标及全部有效引用。

## 3. 推理参数与逻辑入口（F001／F002／F003／F012）

- 真实模型只读 resolveModelInfo().reasoning.efforts，展示实际 ID、名称、默认及来源；无声明只显示“模型默认”。不按模型名字推测或把接口接受值说成不同真实强度。
- 推理参数优先级：明确本轮／会话覆盖，其次别名候选 efforts，再次 AUTO 规则／执行档，最后具体模型已有默认。未指定表示省略请求字段；显式值不支持该候选时记录并跳过，不默默降级。旧 tier 仅参与原迁移兼容。
- alias／AUTO 的原生选择器只声明全部可达执行候选共同支持的档位；交集为空仅显示默认。最终调用仍校验具体候选，不能复制第一个候选的 reasoning 或最大输出为整个池的能力。用户仍可在管理器为每候选配置各自档位。
- 所有受管理入口保留目标 Provider 的公开请求准备、图片预算、工具更新／重放及成功 replayState。版本 0.2 的规范消息／流／失败结构按实际类型接入，不靠旧字段断言或统一 NETWORK 掩盖结构化错误。

## 4. 别名冷却与回首选（F002／F008／F009）

- 用户手动新增、排序、删除具体候选；允许同模型跨来源和跨模型，不自动扩充或改变顺序，不允许递归别名。每次调用固定配置、能力、消息和候选快照。
- 沿用五次临时故障尝试及 0.5／1／2／4 秒退避、32 MiB 暂存、成功后提交、停止优先和只重做当前 LLM 请求。限流／额度／认证不进入五次临时重试；具体模型的全局 reliability 仍按旧有效规则处理。

| 分类 | 成为冷却状态的条件 | 默认截止 |
| --- | --- | --- |
| transient | 临时网络／超时／408／5xx 等在本候选五次耗尽 | 失败完成后 60 秒 |
| rate-limit | RATE_LIMIT 或 HTTP 429 | 正的有效 providerRetryAfterMs 优先，否则 300 秒 |
| quota | QUOTA | 有明确有效服务端等待时间时采用，否则 3600 秒 |
| auth | AUTH／401／403／无效或缺失凭据 | 无自动截止，更换相关凭据／配置或手动重置后再试 |
| 本次不兼容 | 图片、上下文、参数、模型准备或其他确定性拒绝 | 本次跳过，不留下全局健康判断 |
| aborted | 用户停止、生命周期释放 | 不新建冷却、不切换候选 |

- 冷却只针对当前 Profile＋别名＋具体候选，不因一个候选失败跳过整个 Provider。临时失败是在本候选尝试耗尽后才开始计时；成功立即清除此候选故障计数。
- 一轮中首次成功候选被固定到 turn/end；后续工具循环先用它，失败后从其后继续查找本轮冻结队列中未失败／未冷却候选。该轮不因前面候选冷却到期而回跳。下一用户轮按原优先级寻找可用候选，到期的首选用该次真实请求尝试恢复；不等待冷却、不启动后台探测。
- 同一到期候选只允许一个恢复中的请求，其他并发会话继续备用；恢复成功释放租约，其他已开始轮次不强行切回。停止、异常和卸载均释放租约；迟到结果不能写健康或发布输出。
- 全部冷却／失败返回 ALL_CANDIDATES_FAILED，逐候选列出脱敏原因与可恢复时间；无限期认证阻断显示需处理凭据。没有可用候选时也不绕过冷却发探测。
- 页面显示当前故障、冷却剩余时间与“立即重新尝试首选”。此动作只清除该别名健康状态／恢复租约，不发模型请求、不改候选或凭据；下一轮才重试。动作带健康状态版本，防止覆盖刚完成的并发请求。
- 状态单独保存在实际 Profile 的插件数据目录 alias-health.json，不放 ManagerConfig／模型证据中。配置／候选／实际来源参数或凭据变化使相关旧状态失效；同一 Profile 多会话共享健康，跨 Profile 隔离。

## 5. AUTO 类型规则与复杂度（F003／F005／F006）

- 任务类型固定 coding／writing／research／analysis／general，对应编码／写作／调研／分析／通用；复杂度仍是 simple／normal／complex。图片是能力条件，不强制成为独立任务类型。
- 用户手动配置评估模型、其真实推理档位、三档执行目标及有序规则。规则包括稳定 id、中文名称、启用、任务类型集合、可选复杂度集合、Selection；省略复杂度表示不限，空集合非法。
- 先对所有已配置目标做能力资格检查，使用宿主 TokenMeter 估算完整请求和输出预留，包含系统提示、工具、历史和图片；估算不是精确 Token 保证，不再以纯文本字符数冒充 Token。视觉辅助配置完整时，文本候选也可以处理图片任务。
- 评估器只读取最新任务及既有受限近期上下文，返回 taskType、grade、reason，不读图片像素、不调用工具、不执行任务。未配置或未启用 AUTO 不产生评估；评估只使用真实模型，不走 AUTO／别名。
- 总评估时限 10 秒，由插件执行绝对截止；解析失败、非正常终止、超时或迟到结果回退 general＋normal。用户取消直接停止，不作为评估失败继续执行。
- 按顺序采用首个类型／复杂度匹配且有合格候选的启用规则；匹配但不可用时继续下一规则。没有可用规则则从评估 grade 向 normal／complex 的更高档查找；没有兼容目标明确失败，不选择用户池外模型。
- 同一 session＋turn 仅评估一次，工具循环复用规则／档位与实际成功候选；规则修改不影响已开始轮次。记录任务分类、命中规则、逻辑入口、实际模型及回退理由，不记录完整提示词。
- “生成推荐”只返回三档和可选规则草稿及解释，可选同次建议评估模型；只引用真实已加载模型或已保存别名，不猜价格／性能。用户检查保存后才启用，不自动改变来源顺序或运行配置。
- 原生 Subagent 的任务拆分、工具和模型范围归宿主；不恢复旧固定角色或分工提示，不新增重复子 Agent 页。显式子模型与档位保持，子任务不二次评估 AUTO；fork 使用父任务实际执行模型。

## 6. 自动视觉与会话记录（F004／F005／F008／F012）

- vision.enabled／policy／target 保持。新增 automatic：开启时在原生优先下直接处理原生图片，非原生候选自动调用配置的视觉模型；关闭 automatic 则保留原来的显式图片工具路径。原生限定／辅助优先／辅助限定继续有效。
- 先在 agent/pre-step 处理已接纳新输入和当前步骤工具结果的图片；使用目标版本公开 deriveMessages 获取历史，不能依赖已退役同步会话事件快照。在消息提交前完成必要辅助，通过 PreStepDecision.messages 添加独立的 user-role 来源消息，不改原用户内容和旧日志。
- 注册 MessageSourceMap 的 model-manager-vision，来源声明 form='notice'、summary、附件编号及实际视觉 Provider／Model；摘要正文标记为图片观察资料，图片或摘要中的指令不获得用户／系统权限。该上下文和主模型看到的文字一致并进入原生会话记录，不伪造主模型工具调用。
- 自动摘要按本轮问题组织。混合能力别名只要本轮可能到达文本候选，调用前准备辅助，保证后续回退无须在适配器内部注入未记录的新摘要；全部原生候选且 native-first 时不增加辅助调用。
- 缓存键包含 session、图片内容哈希、问题、裁剪区域、视觉候选签名和本次相关配置。相同键并发合并，跨会话不复用；后续具体追问通过保留的 inspect_image 工具重新看原图。缓存不冒充原图、当前事实或已完成验证。
- 视觉目标可为有原生图片能力候选的别名；复用冷却／恢复规则且禁止再次进入自动视觉。没有合格视觉候选、失败、空结果或取消均不写成功缓存；失败阻止本次带图主请求并明确说明，不能当无图继续。
- 新图、工具图片、多图、历史追问、裁剪、原生到文本的别名回退及停止都验收。超限沿用实际 Provider 限制，不无限拆请求规避；原图继续由 AttachmentStore 保存。

## 7. 模块与 HTTP 接口（F008／F009／F013）

客户端使用公开 hostRouteUrl 生成主机路由；SSE 使用实际传输公开的 streamBaseUrl。原生 dsh-app://app 请求按实际 Host／Origin 精确校验，不从 location 拼回环地址、不放行任意 null Origin。每个 path 只注册一次并按 method 分发；取消、卸载和页面关闭释放请求、流、计时器及子进程。

新增模块边界：source-connections 发现及生成 SourcePreview；desktop-settings 解析所有者并提供脱敏 describe／CAS apply；alias-health 管理冷却和恢复租约；vision-analysis 共用于自动摘要与 inspect_image。既有 service／adapter／auto-router／catalog 继续编排，纯模块不反向取得 live ctx。

| 拟新增导出 | 输入与返回契约 |
| --- | --- |
| source-connections.describeSources(deps) | Promise<SourceDescription[]>；每项 {sourceId,kind,providerId,ownerEntryIds,credential:{ref?,configured,writable},arkProfile?,loaded,modelCount,checkedAt?,reason?}，不包含原始配置或秘密 |
| source-connections.previewSource(input,signal,deps) | 输入等于 /sources/preview；Promise<SourcePreview> 为 {sourceId,kind,providerId,fetchedAt,connectionChanges,models,catalog,notes}；connectionChanges 每项 {fieldId,label,before,after,selected}，models 每项 {model:ModelRef,fields,evidence}，未知资料不补值，catalog 为既有扩展 CatalogPreview |
| desktop-settings.describeOwners(ctx) | Promise<OwnerDescription[]>；每项 {owner,entryId,revisionToken,writable,applies,fields}，applies 为 live 或 reload；fields 仅目标允许编辑的 {path,value,inherited,userPresent}，秘密只描述是否存在 |
| desktop-settings.applyOwner(ctx,entryId,expectedRevisionToken,operations) | Promise<OwnerDescription>；operations 使用现有 set／unset 路径形状，服务端确认所有者／白名单／CAS，返回写后完整描述，不能由页面指定任意 entry |
| alias-health.openAliasHealthStore(profileDataDir) | Promise<AliasHealthStore>；提供 snapshot、eligible、claimRecovery、recordSuccess、recordFailure、release、reset 和 dispose；recordFailure 使用 LlmFailure／AliasRecovery，reset 使用 alias／expectedRevisionToken；快照只输出第 4 节健康状态，恢复租约为不透明内存 token |
| vision-analysis.analyzeVision(input,signal,deps) | input={sessionId,question,attachments,region?,snapshot}；Promise<VisionObservation>={attachmentIds,providerId,modelId,question,text,cacheHit}，provider／model 必须为实际成功视觉候选；不接纳会话消息，由调用方的 pre-step 或显式工具接纳 |

以上 deps 为宿主装配时注入的受限能力（目录、配置桥、凭据解析、请求、存储及日志），不得从客户端传入；模型／Selection／来源关联／规则／健康项类型以 CONFIG 同版定义为准。实现可拆内部辅助文件，但不另造一套对外 wire 字段。

| 路径（前缀 /api/model-manager） | 方法与输入 | 输出／行为 |
| --- | --- | --- |
| /sources | GET | sources、原生连接所有者描述、可写性、凭据状态及 ArkCLI 可用性；无秘密值 |
| /sources/credential | POST {sourceKind, newKey} | 新建独立引用，返回 credentialRef、configured；不接受替换已有 Key 或浏览器任意引用路径 |
| /sources/preview | POST {kind, providerId?, sourceId?, credentialRef?, arkProfile?, connection?} | SourcePreview：连接差异、模型资料及 origin=source 的 CatalogPreview；connection 仅允许该来源公开高级字段 |
| /sources/ark-auth | POST {action:'status'|'start'|'complete', loginToken?, code?} | 脱敏登录状态／本次官方授权地址及随机 loginToken；完成返回可选 Profile 摘要，令牌和授权码不落日志 |
| /alias-health | GET；POST {alias, expectedRevisionToken} | GET 返回脱敏状态与 revisionToken；POST 清除指定别名状态后返回完整健康描述，不发模型请求 |
| /recommend | 现有 POST 保留原输入；新增输出 rules?、evaluator? | 原 grades／notes 保持，新增只是未保存草稿 |
| /catalog-resolve | 保留现有 POST 输入 | 接受 source 预览的字段选择及引用冲突解决；原 origin 保持 |
| /catalog-apply | 保留现有 POST 输入 | 应用选中 source 写集，返回完整操作结果及更新后的目录／状态 |
| /catalog-restore | 保留现有 POST 输入 | 恢复 source 操作的配置写集，保留凭据和后续编辑保护 |

SourcePreview 的 id／token 均由服务端生成并绑定连接与配置基线；预览状态仅在内存保留，取消／新预览／重载后失效。连接和模型一起纳入所选配置写集，所有新增 UI 字段的所有者、默认及生效时机见 CONFIG。正常响应保持现有完整 snapshot 字段；新健康／来源信息不覆写无关草稿。

输入错误 400、可信来源拒绝 403、未知路径／条目 404、revision 或 token 过期 409、初始化或依赖暂不可用 503；405 返回 Allow。输出错误统一脱敏，不能返回 CLI 原始 stdout／stderr、Key、授权码或私有配置全文。

## 8. 迁移、验证与交付

- 配置 v4 的字段、默认、迁移矩阵及健康文件在 CONFIG；只读启动不改用户原件，应用前预览／备份。旧 settings.yaml 的宿主导入逐节核对，导入失败分节不能当作已迁移。
- 使用实际配置编辑器的 Profile 路径定位原有 data/dsh-model-manager，不再默认 web；发现旧路径数据时只预览来源、数量与冲突，不自动跨目录搬迁业务存储。实际迁移需按仓库数据迁移约定单独执行。
- 新版包精确声明本次验证的 0.2.0-rc.2 宿主依赖及真实 repository，提供随固定 Git 完整提交可安装的宿主／客户端／类型和资源；不依赖工作树忽略产物或现场 prepare 构建。旧 0.12.0 固定组合继续保留。
- 自动验证：v1–v4 幂等／未知键／旧字段不复活，来源发现与取消／CAS／部分失败恢复，推理交集及优先级，全部别名恢复与冷却／租约／重启矩阵，AUTO 类型／复杂度／超时／池限制，视觉上下文真实接纳／工具图片／隔离／失败／停止。
- 依次执行 typecheck、build、test 及生产客户端冒烟；隔离 Desktop carrier 核对真实包来源、Provider／路由／配置、取消和重放，原生窗口核对六标签、保存／重置、深浅色、窄宽、键盘及草稿。
- 实际外部三来源调用、官方资料同步、真实 ArkCLI 登录和账户查询分别记录；未执行或凭据不足不宣称通过，mock／HTTP 拦截不能冒充真实上游。未确认的批量测试不附带实现，也不在日常偷偷生成测试会话或发推理请求。
- 源码验证与固定提交安装通过后，按既有授权正常退出日常 Desktop，独立确认进程结束、冷备份、安装固定提交、重开核对实际版本／入口及原配置，留供用户试用；只有当前 Agent 承载其中时才按交接约定交由外部操作。
- 收尾同步 README／规格／契约／验证与实际候选记录、受影响清单和 Skill；新核心运行代码不混入旧核心正式锁；快照只由脚本采集，未变保留。未完成全组合／真实服务验收保持 verified=false，不自动推送／发布，不恢复 Web。
