# 架构契约（v3）

## 智能补全已有模型参数（文档版 model-parameters-20261010-v1，待确认／待实现）

对应 SPEC F011 及 F001／F006／F009。本节基线 0.10.0／`5e33bec0bf1b66aeeac92a79cf86c2d7a3fd301b`，规划 0.11.0；尚无本功能源码，既有目录／官方事务继续按已实现契约运行。用户已要求实施计划，具体本版文档尚待明确确认。本节不改变原官方清单完整性、替代／迁移、原生 Subagent 或旧偏好停用规则。

### 字段边界与来源

只分析已加载真实模型，键为 ModelRef；客户端通过 ID／name 不区分大小写子串筛选，实际请求只提交已选 ModelRef。重复引用在服务端去重保留顺序，最多 100 个目标；未知目标、空列表或管理 Provider 在外部调用前拒绝。Provider 名称／协议来自宿主，不能由 LLM 改写。

| 宿主契约 | 可分析与写入的模型字段 | 限制 |
| --- | --- | --- |
| llm-pi-ai PiAiModelProfile／PiAiModelOverride | name、contextWindow、maxTokens、input、reasoningEfforts、compat 的全部公开叶字段 | id 固定；models 显式数组优先，合法内置目录覆盖才写 modelOverrides；reasoningEfforts 为 false 或完整合法映射，off 可用 null，其余档位须合法 wire 值。 |
| llm-deepseek DeepSeekCatalogModel | name、description、contextWindow、maxTokens、inputModalities、imagePixelBudget、imageMaxBytes、systemPromptUpdate | 按该宿主字段类型校验；没有模型级 reasoningEfforts／compat 写入入口，不伪造。图片预算是配置策略，没有平台明确建议则无建议，不以模型知识任意推算。 |
| 其他 Provider | 展示目标、无建议或不可写原因 | 未适配的配置契约不提供应用；后续增加适配需独立明确字段与验收。 |

字段定义严格以锁定 DSH 0.1.5-rc.2 已安装宿主公开类型／校验为基线。llm-pi-ai compat 按 Completions、Responses（含 Azure／Codex）、Anthropic、Bedrock 实际协议提供对应字段；宿主 withheld 字段不开放。布尔、枚举、数值、结构化 kwargs 等分别用明确 schema，不接受任意对象／路径。升级时核对字段表与宿主，不根据 LLM 输出扩展白名单。Provider api／baseURL／headers／apiKeyEnv、路由默认容量／输出、运行偏好均不可写。

新增 `ParameterFieldDescriptor`：`{field: string[], label: string, schema: object, writable: boolean, reason?: string, effect?: string}`；field 是目标模型内部、服务端生成的路径段，不能含 id／Provider 路径或原型属性。`ModelParameterTarget` 固定含 model、name、api、writable、reason?、fields、currentValues、currentSources；不得携带密钥、完整 Provider 原配置。currentValues 记录实际可观察值，不能把 LlmResolvedModelInfo 结构直接写进 models。

来源枚举 `user | catalog | provider-default | runtime-default | unknown`：先用 settings.describe.user 判定原始用户模型叶值，再用适配器原始内置目录判断 catalog，再判 Provider 兜底／宿主常量默认；无法证明时 unknown，禁止由数值碰巧相等猜来源。对于 reasoningEfforts 要保留原始 wire 映射，不能用展示 label 反推；compat 来源按叶字段识别。目标源、协议及现有元数据在分析开始冻结，之后应用不重新解释来源。

### 分析服务与搜索

规划模块：`model-parameters.ts` 提供描述、结构校验与建议规划；`parameter-analysis.ts` 负责搜索／正文／独立 LLM；`client/parameter-panel.tsx` 提供目标选择、进度及字段预览。通过现有 official-host 的事务入口接入，不建立另一套无版本保护的直接写配置通路。

- `describeParameterTargets(state, hostCatalog): ModelParameterTarget[]`：状态为原始与有效配置，hostCatalog 提供已安装原始目录／协议元数据，不含调用凭据；返回全部当前真实模型及其字段来源。
- `validateParameterSuggestions(value: unknown, target: ModelParameterTarget, pages: OfficialPage[]): ParameterSuggestion[]`：逐字段解析、类型／协议／证据校验；非法建议导致该目标 failed，不生成其可应用字段，其他目标继续。合法未知项无 value，不构造更新。
- `analyzeModelParameters(llm, search, targets, options, signal, progress): Promise<ParameterAnalysis>`：options 固定 analyzer、reasoningEffort?、analysisTimeoutSeconds；串行目标，结果与调用计数不写宿主设置。取消竞争覆盖不响应 AbortSignal 的流读取，失败与 effect 清理及时释放 handle。
- `parameterIntents(state, analysis, selectedFields): CatalogIntent[]`：selectedFields 为当前分析发出的 opaque 字段 id，只生成选中字段的 update 意图，模型 ID 固定；同一模型归为一个依赖一致的操作。

豆包搜索客户端使用原生 fetch，不在公开插件绑定用户机器上的 Python skill／arkcli 文件。固定 `POST https://open.feedcoopapi.com/search_api/web_search`，Bearer Key 仅由 ctx.credentials.resolve(credentialRef(name)) 获取；请求 `{Query, SearchType:'web', Count:5, NeedSummary:true}`，按 Result.WebResults 取标题、URL、Snippet／Summary 作为线索，业务错误与 HTTP 错误都检查。请求含 skill 已使用的 `X-Traffic-Tag: skill_web_search_common`。每请求总时限 30 秒，不自动重试；每目标最多两次搜索、三个正文页面、两轮 LLM，正文每页 10 秒／最多 2,000,000 字符，沿用 HTML 文本提取。第一查询按公开平台名、精确 ID／名称、model specifications／API parameters；资料不足第二查询补充精确型号与缺失字段关键词。

搜索只发送公开平台名、型号与参数关键词，不发送完整配置、密钥、内部地址或 headers。结果地址只允许公开 HTTPS、无 URL 凭据；校验域名／DNS／重定向，不访问本地／私网／保留地址。每个官方候选页面及后续链接限定其已核实平台官方 hostname；LLM 不能以任意网址请求追加页面。官方站点身份与型号关系随预览证据展示；无法核实的站点不升级为 official。原基础模型文档缺少当前 Provider 关系时至多作为 knowledge 线索。

第一轮 LLM 根据实际正文给出有证据的字段或未知项；仍有缺失且未遇官方冲突时，第二轮允许知识建议（或追加正文分析），官方结果优先，不用知识覆盖冲突。搜索缺凭据／401／额度／网络／正文失败作为 notes 展示，可继续知识判断；LLM 格式错误或调用失败将该目标标 failed，不在同一目标自动重试。流式输出限 2,000,000 字符；每轮分析默认 180 秒、30–600 整数，取消／总截止不因输出延长。分析模型必须是已加载真实模型，null／省略使用当前宿主默认并解析真实目标，不能递归进入 AUTO／别名；公开档位校验沿用官方分析。

LLM 输出固定 `{suggestions:[{field:string[], basis:'official'|'knowledge'|'unknown', value?:unknown, reason:string, evidence?:{source:string,quote:string}[]}], notes:string[]}`。unknown 禁止携带 value；official 必须有对应已读 URL 与连续原文，同时保留本目标精确 ID／平台身份证据；knowledge 不得伪造已读引文。校验白名单、重复字段、JSON 类型、引文存在、字段组合；格式／引文通过不声明程序证明语义或官方能力。未返回字段保持未知，不把缺失视为不支持。

### HTTP、SSE 与字段选择

各 exact path 只注册一次，保留 trusted caller、405／Allow、409 冲突、1 MiB 请求体上限。

| Path | Method | 契约 |
| --- | --- | --- |
| `/api/model-manager/model-parameter-preview` | POST | `{models: ModelRef[], analyzer?: ModelRef|null, reasoningEffort?:string, analysisTimeoutSeconds?:number}`；先验证目标与参数并冻结原配置，再分析；Accept:text/event-stream 使用下述 SSE，未声明时返回同形状 JSON。 |
| `/api/model-manager/catalog-resolve` | POST | 原 `{token,selected,resolutions}` 增加可选 `selectedFields:string[]`，仅 parameter origin 支持；缺省保持冻结默认／上次字段选择。未知／重复 id 拒绝，其他 origin 提交 selectedFields 拒绝。只重算、不搜索、不写配置；成功返回完整新预览并使旧 token 失效。 |
| `/api/model-manager/catalog-apply` | POST | 原 `{token,selected}` 不变；使用 token 中已确认的字段集合和依赖选择，不能临时提交路径／值。返回既有 applied／backupId／backupAt／完整 snapshot。 |
| `/api/model-manager/catalog-restore` | POST | 原 `{backupId}` 不变，支持 parameter 写集；恢复后返回完整 snapshot，并作废有关预览。 |

SSE 事件 progress／result／error 与 15 秒 keepalive；progress 含 stage（searching／reading／analyzing／planning）、model?、modelIndex、modelCount、searchCount、analysisCount，以及 analyzing 时 round／analysisStartedAt／analysisTimeoutSeconds。result 唯一终止并返回 ModelParameterPreview，不能借用官方 parser 的 analysis.complete 判定；断开连接／重新分析／effect 卸载取消作废旧任务与 token。单项失败记录到 result，整体取消／基线变化／全部无建议无有效 token；有建议但初始未选择可给 token，禁止空应用。正常全同值时展示 no-change，不提供应用 token。

`ParameterSuggestion`：`{id:string, model:ModelRef, field:string[], currentValue?:unknown, currentSource:ParameterValueSource, value?:unknown, basis:'official'|'knowledge'|'unknown', reason:string, evidence:OfficialEvidence[], writable:boolean, blockedReason?:string, effect?:string}`。id 由服务端生成，仅 within token 有效；value 是合法模型内部字段值，客户端无通用编辑路径入口。

`ParameterModelResult`：`{model:ModelRef,status:'ready'|'no-change'|'failed'|'unsupported',suggestions:ParameterSuggestion[],notes:string[]}`。`ModelParameterPreview` 在 CatalogPreview 基础增加 `parameterAnalysis:{analyzer,reasoningEffort?,analysisTimeoutSeconds,searchCount,analysisCount,results:ParameterModelResult[]}` 和 `selectedFields:string[]`；CatalogPreview.origin 扩为 manual／official／parameter，旧数据／客户端输入保持兼容。GET 完整 snapshot 增加可选 parameterBackupId，展示最近已应用参数操作；备份恢复始终按指定 id 与版本校验，不以页面记录绕过保护。

缺失／兜底默认项只有 official 且无用户或实际 catalog 冲突才默认选择；已有不同值（包括有效目录值）、名称来源不明／自定义、knowledge、maxTokens、模型图片预算策略始终不默认选择。未显式配置但已继承有效目录同值时展示一致，不物化用户覆盖。compat 按已声明 schema 叶字段选择，未选叶值保留；数组／reasoningEfforts／结构化 kwargs／args 各作为原子字段选择，不按任意深路径拆分。

### 组合校验、事务与配置生命周期

选中字段须先合并到原始模型，按对应宿主公开 schema／协议验证并重新推导有效图片、容量、输出和档位。不单纯沿用旧 service.records 的能力判断；推理映射更改后检查全部仍有效的 AUTO／别名／旧主模型／视觉兜底／未来 session 与 nextTurn 选择。新推理映射必须使其 compat 有效，字段未选造成缺必要设置时列为阻止，不能隐式勾选其他字段。模型输出大于组合上下文等宿主非法组合拒绝，不自动修约束。

图片声明与插件覆盖冲突，提供保留原值并跳过冲突字段／同步覆盖／清除覆盖继承宿主的服务端选项；有效视觉目标失去图片声明提供替换有效原生图片模型／明确关闭与清理相关目标／跳过该目标变更，保留无关视觉配置。推理引用不兼容提供公开档位／使用模型默认／跳过目标变更，不静默降档。停用 auto.preferences 不因本次补全复活或重新成为有效使用引用；旧 main／有效视觉兜底按当前已有契约处理。一个模型的选中字段与明确引用修正同组应用，未解决则阻止该模型，不拆成半完成写入。

参数名改动遵循现有 catalogMetadata 自定义名称保护，用户采用官方名称时 customName=false、知识名称时 customName=true，保留 origin 与未知元信息。仅模型宿主字段的应用不清空插件草稿；有元信息、覆盖或引用写集时须先保存／放弃无关插件草稿并重新预览。搜索引用保存是独立单字段操作，不能顺带保存全局草稿。

所有 parameter 操作进入 existing writesQueue；完整读原始 user 层／冻结 namespace revisions、目录和未来覆盖 fingerprint，按宿主配置路径构造 models／modelOverrides 字段更新，保留未知字段、不把全部有效默认 models 导出为新用户数组。不满足合法 modelOverrides 时不可写；DeepSeek 显式数组按已有完整目录事务保留其他项。备份 version:3 沿用现有状态机，origin 增加 parameter，保存 parameterAnalysis、selectedFields、原值及存在状态／写后 revision；`catalog-backups/latest.json` 增加 parameter 指针，保留 manual／official 指针和旧 v1／v2／v3 恢复范围。

配置 v3 只新增可选 parameterCompletion.searchCredentialName，按 CONFIG 同版规则维护；旧配置不补空 section、不清理未知字段、不改已有模型参数或停用字段。失败回滚、坏备份 .bak、后续修改／跨重启拒绝恢复、完整响应与日志脱敏沿用 F010。实现后必须将来源判定、请求实际参数、老配置保存与恢复分别验证，不能用补全结果充当真实探测证据。

## 子 Agent 配置入口移除与旧偏好清理（0.10.0）

文档版本：2026-10-10；基线 0.9.0／`ddafc33142be0423c361ee474a0bd1f1ae4cd345`，对应 SPEC F002／F003／F005／F009。用户审阅具体文档后回复“继续”明确确认，已按该版实现；实现状态：已实现。此节替代下文关于偏好提示、六标签页及插件 /subagents 路由的旧规则；历史版本契约与验证保留。配置仍为 v3，目标包版本 0.10.0。

### 页面、运行与引用边界

- 移除“子 Agent”标签页及分工偏好编辑器；保留五个标签页，在使用指引说明原生模型范围到 DSH 官方设置配置。删除 /api/model-manager/subagents GET／PUT 的注册、未使用的 SubagentRuntime 类型、subagents 服务注入及对应包依赖。systemPrompt 仍用于视觉提示，仅移除其中分工偏好文本。
- 原生 subagent 的启动、模型选择、后台运行和回收继续由 DSH 提供。保留现有父子会话识别及受管理请求隔离：子任务不评估 AUTO、不继承主任务临时覆盖，fork 继承父模型；父入口为 AUTO 时延续父任务已经选定的执行模型，不重新评估。
- auto.preferences 成为可选历史字段，保留显式值及未知键；缺失时不物化，旧 roles 也不生成 preferences。删除／迁移引用访问器不再将它作为有效使用引用，也不修改其历史值。auto.main／roles、视觉、别名候选、宿主默认、原生 subagent-model-selection.allowedModels 和未来覆盖继续按既有使用规则处理。

### 独立清理接口和类型

- CatalogOperation 增加 `{kind: 'clearLegacyPreferences'}`，只允许 operations 数组包含这一项，拒绝未知键、混合或重复操作；字段不存在时返回 400，提示“无需清理旧分工偏好”。空对象属于存在的字段，可清理。不要求加载可写模型 Provider，不调用网页或 LLM。
- CatalogIntent／CatalogDiff 增加配置清理分支：kind 为 clearLegacyPreferences，稳定 id 为 clearLegacyPreferences，path 为 auto.preferences；不携带 model。既有目录分支继续要求 model，不把配置目标伪装成 Provider／Model。before 展示历史偏好完整内容，after 为 null（表示字段移除）；references／attachedSettings／conflicts／choices／blockedReasons 沿用现有结构，清理分支为空列表。实际删除与缺失状态以事务写集记录为准，不用 null 写入设置。
- POST /api/model-manager/catalog-preview 输入为 `{operations: [{kind: 'clearLegacyPreferences'}]}`；返回 CatalogPreview，origin=manual、writesPlugin=true、counts=[]，清理项默认未选中。用户明确勾选后应用；catalog-resolve 沿用 token／selected／resolutions 协议，清理不产生可选冲突项。配置清理独立于模型目录规划，所有 model 访问和统计先按 kind 分支。
- POST /api/model-manager/catalog-apply 使用现有 `{token, selected}`；成功继续返回 applied／backupId／backupAt／完整 snapshot。catalog-restore 使用现有 `{backupId}` 和完整 snapshot。无新增路由；原模型、别名、官方接口及旧备份兼容保持。

### 写集、备份与交互

- 清理只构造 dsh-model-manager 分节 `['auto', 'preferences']` 的 unset 写操作，不能写整个 auto，也不能因规范化迁移写入默认层。保存原始 user 字段值及存在状态，备份沿用 version=3／origin=manual；使用既有 token 作废、信任栅栏、串行事务、revision／指纹检查和安全回滚／恢复。预览、失败和取消不删除配置；应用与恢复保留所有其他字段、原生 Subagent 设置和凭据。
- AUTO 页仅在已保存 snapshot 中字段存在时显示停用卡片及内容；有未保存插件草稿时阻止预览／应用／恢复，提示先保存或放弃再重新预览。独立预览不修改草稿；仅明确勾选并应用才清理。错误持久显示，旧 token 不继续应用。
- 成功后刷新完整状态并移除停用卡片；沿用最近目录操作备份发现机制，即使字段消失、切换标签或重开页面仍能发现恢复入口。恢复显示原始历史内容，但不重新启用提示；后续设置已变化或重启导致 revision 不匹配时按既有规则保守拒绝恢复。

### 验证与交付

覆盖迁移幂等、字段存在／缺失／空对象／未知键、旧角色不再生成偏好、不注入提示、五标签页、旧路由和依赖移除；清理取消／应用／恢复／重复输入／混合操作／草稿保护／冲突／失败回滚；历史偏好不阻止模型与别名删除且不被官方迁移改写；原生有效引用仍需解决；子任务隔离、AUTO 不重复评估及 fork 继承。依次 typecheck、build、全量 test 和生产客户端冒烟，再在 development 专用页面及会话实测；不以模拟测试冒充真实原生链路验收。

本版确认后完成开发，typecheck、build、15 文件 228 项测试及 development 页面清理／恢复通过；真实原生 Subagent 调用尚待验收，详见 V1-COVERAGE。同步当前说明、AGENTS、CHANGELOG、V1-COVERAGE 和受影响的维护 Skill；插件独立提交后同步完整版本锁，安装快照仅由脚本生成，只重启 development、不自动推送。未完成真实调用／完整巡检单列，verified=false 保留。

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

## 别名删除引用处理契约（0.9.0，2026-10-10）

对应 SPEC F002／F004／F009，基线 0.8.0。用户审阅具体规格及本节／配置契约后以“继续实现”明确确认，随后实现。配置版本维持 v3，现有模型 CRUD 和官方同步仍按下节已实现契约运行。纯规划实现位于 alias-removal，复用 catalog-state 和 official-host 的选项验证及事务执行器。

- `CatalogOperation` 新增互斥输入 `{ kind: 'removeAlias'; name: string }`。name 是不含 @ 的现有合法别名键；不存在、格式无效、未知键及重复删除意图返回 400。别名候选真实模型不作为删除对象，不修改对应目录、能力覆盖或其他别名。
- 内部 `CatalogIntent`／`CatalogDiff` 的 kind 增加 removeAlias，沿用 model 作为逻辑主体 `{providerId: 'dsh-model-manager', modelId: 'alias:' + name}`；客户端按 kind 显示“删除别名 @name”，不得把它当作真实目录模型访问 Provider profile。before 保存完整别名配置，after 表示删除；references／choices／referenceChanges 延续现有形状。counts 仅统计真实模型目录变化，别名删除不减少任何 Provider 的模型数量。
- 纯规划器逐一定位规范化配置中的 @name 引用：auto.main／simple／normal／complex、preferences、roles、vision.target、未来 overrides.session／nextTurn；宿主默认及 Subagent 范围识别受管理 Provider 的 alias:name。未来覆盖缺失与显式存在分别保留；进行中 active 快照不纳入迁移。未知字段保留但不解释为新的可执行引用。
- 普通选择引用提供已加载真实模型替换和允许时的清除选项；启用 AUTO 的必填三档、宿主默认只能替换。原生 Subagent 范围可移除该别名入口，结果须通过宿主约束。替换后按现有真实参数校验规则处理不兼容档位，不静默降档；清除目标同时移除 reasoningEffort／tier／thinking，保留独立输出上限及未知字段。旧主模型清除选项明确提示旧 AUTO 入口回退宿主默认；宿主默认若也引用该别名，须先另选真实默认模型。
- vision.target 和 roles.vision.target 单独提供原生图片模型替换选项。当前视觉目标有效且与删除别名无关时，清除旧视觉兜底只改该兜底；当前辅助目标使用该别名且已开启时，“关闭辅助并清除相关目标”与别名删除同组，enabled=false。辅助已关闭时清除遗留目标不额外改变其他视觉字段。用户选取消则不应用。必须处理全部引用，不能仅跳过其中一个字段后删除别名。
- `/catalog-preview` 接受新输入；`/catalog-resolve` 仍使用服务端产生的 opaque 选项 id，不接受任意路径写入；`/catalog-apply` 整体执行别名删除和引用变更；`/catalog-restore` 整体恢复。现有 token 作废、信任栅栏、revision／目录／覆盖指纹检查、串行完整写集备份、安全回滚和恢复限制不变，未确认选项不给默认清理。新备份仍 version=3、origin=manual，记录完整别名原值及相关 namespace／未来覆盖，旧备份兼容不变。
- 别名卡片不再直接 delete 草稿键，点击后进入独立预览。其他未保存插件草稿必须保存或放弃，再重新预览；引用选项变化仅重算差异。视觉目标及旧兜底在辅助关闭时仍显示，失效目标加入标注原因的当前值选项，必须显式修改才清除；当前目标清除时若仍有旧兜底，显示并要求明确处理，不暗中继续使用。普通模型选择器同样保留失效当前值，防止空白误导。
- 本次日常配置拟应用：删除 deepseek-v4-1，清除旧 auto.main 与旧 roles.vision 的同名目标及依赖档位，保留 main 的独立输出上限／未知字段；保持当前 vision.enabled／policy／glm-5-3-flash 和新 AUTO 三档。应用时以新预览的实时引用为准，发现额外引用必须先解决，不套用调查时的旧 revision。

验收覆盖隐藏旧主模型报错、无引用、全部使用位置、关闭后的视觉残留、无效下拉选项、必填项阻止、图片能力限制、无关视觉保留、真实目录计数不变、参数与未知字段保留、草稿保护、并发拒绝、失败回滚、同生命周期恢复及生产客户端冒烟。按 typecheck → build → 全量 test 验证，并在 development 专用页面操作删除／恢复；日常应用前独立预览完整写集，不修改凭据，不改历史及进行中请求。实测证据与未完成事项写入 V1-COVERAGE。

## 模型生命周期与统一操作预览（0.8.0，2026-10-10）

对应 SPEC F001／F004／F007／F009／F010，基线 0.7.0，目标 0.8.0。本节经用户“可以，实现吧”明确确认后实现；规划模块为 catalog-state／catalog-types，目录桥接为 service／official-host，页面为 catalog-panel。与后文历史官方契约冲突时，本节替代“到其他页面调整冲突”“模型键设置本身阻止删除”及“只能同 Provider 迁移”的相关规则；官网识别、六页三轮、临时参数、严格证据和取消／截止机制不变。

### 宿主目录与字段来源

- 建立独立目录桥接与纯操作规划模块，官方同步和手动操作均调用同一规划器与事务执行器。使用 `listConfigurableProviders()` 的 settingsNs／settingsPath 及 settings.describe 的可写状态和 revision；首版适配 llm-deepseek 的 models 数组、llm-pi-ai 的 Provider profile models／modelOverrides，其他未知契约返回不可编辑原因。
- 状态同时保存原始 user 配置、有效模型目录与 userFields 字段来源（结合 Provider 默认、运行时推导及官方证据区分 user／provider／derived／official）。模型主键是 ModelRef，绝不只按 ID 匹配。原始 user 值优先用于写回，resolveModelInfo 的 context／reasoning 等运行时结构不直接写进 models。显式数组未知键原样保留；没有 user 字段不意味着未知官方字段可随意补写。
- 对 llm-pi-ai 默认目录的改名使用 modelOverrides.name；已有显式数组修改对应条目。新增／删除需要显式数组时物化当前有效目录的宿主配置字段，将已有 modelOverrides 合入并移除其原位置，因为该宿主不接受 models 与 modelOverrides 同时生效；备份保存两者原值及存在状态。不同未操作模型、推理／compat 设置及未知用户字段必须保留，不能把推导默认的输出上限当新用户覆盖。llm-pi-ai 删除后模型数不得为零。
- DeepSeek 通过显式 models 数组新增／改名／删除，支持合法空数组但须先处理全部使用引用。不写 Provider 凭据、端点或协议。自定义 Provider 新型号缺少宿主必要默认／协议时拒绝预览并显示具体缺项，不擅自为整个 Provider 修改协议。
- GET `/api/model-manager` 的完整 snapshot 增加可选 catalogBackupId／catalogBackupWritesPlugin（最近 applied 手动操作及其插件写集标记，切换页签或重开页面可发现；恢复仍须通过版本校验）和 `catalogCapabilities: {providerId, canAdd, canRename, canRemove, minimumModels, reason?}[]`；ModelRecord 增加可选 `catalogOrigin: 'manual'|'official'|'unknown'`、`customName: boolean`。原字段及 native 接口保持兼容。可配置且有合法宿主设置的既有 Provider 可用于新增；AUTO／别名不是目录 CRUD 的真实模型。

### 统一操作及引用规划

`CatalogOperation` 的手动输入固定为下列互斥形状：

```ts
type CatalogOperation =
  | { kind: 'add'; model: ModelRef; name?: string; image?: boolean;
      contextWindow?: number; maxTokens?: number }
  | { kind: 'rename'; model: ModelRef; name: string }
  | { kind: 'remove'; model: ModelRef }
```

ID 和提供的 name 必须非空、无首尾空白；数字为正安全整数。普通 rename 不能修改 ID。新增已有 ID 返回 400 和 `existingModel: ModelRef`，客户端保留输入并提供打开该模型编辑入口。名称不要求唯一。官方更新与 migrate 的内部意图只由验证通过的 OfficialAnalysis 构造，不能从客户端提交伪造官方证据。

- 规划快照包括目录、原始 namespace 值／版本、未来覆盖指纹及元信息。同目标的全部官方旧 ID 归并一组；组内创建／更新目标、引用迁移、附属设置和旧目录删除不可拆选。其他独立组可以跳过，不解决被跳过组的冲突也可应用有效组。
- 引用访问器明确覆盖 aliases.*.candidates／efforts、models 的 modelKey、auto.evaluator／simple／normal／complex／main／roles／preferences、vision.target、历史 official.analyzer、宿主 agent-default-model.{provider,model}、subagent-model-selection.allowedModels 和 session／nextTurn。区分 `usage` 和 `attached`；models 配置和孤立 efforts 键属于附属设置，实际候选及选择才是使用引用。禁用功能的遗留使用目标仍要处理或清理，不永久阻断删除。
- 普通移除的手动替代可跨 Provider，defaultModel 的 provider／model 同步变更。删除旧模型附属设置需独立确认清理；旧目录的能力、未知字段及输出上限保存在备份，不复制到不同模型的宿主目录。迁移的候选／Selection 参数保持并校验，已知不支持的 reasoningEffort／tiers 提供真实支持档位或使用模型默认的选择；不静默降档。无法确认必要参数兼容时保持该组阻止并定位原因。
- 官方兼容迁移的模型键及原用户字段按缺失字段补齐、相同值保留、不同叶值生成冲突处理。已有目标优先作为基线，但冲突不得默认消失。不同 user 值，即使与内置值相同也仍是显式设置；provider／derived 值不伪装成 user 冲突。官方未知字段保留目标已有声明，不从旧型号默认值推断新能力。两侧显式不同值必须由用户选择。
- 冲突给出稳定 opaque id、字段路径、各方值与来源、可选官方证据以及可用 optionId；客户端只提交 id／optionId，不提交任意配置路径和值。每次模拟校验宿主输入模态和图片限制等字段组合；选择文本能力时须明确解决图片限制，不能静默生成非法配置。跨 Provider 同 ID 始终隔离。候选去重保留原顺序，重复参数不一致也生成冲突。

### 图片辅助删除与迁移

- 仅当删除对象出现在 vision.target 或旧 auto.roles.vision.target 的直接／别名解析链中，才产生视觉处理项；不能因“视觉辅助已启用”或目录存在其他图片模型阻止无关删除。
- 视觉处理的 optionId 包含：替换为候选真实图片模型、disable、取消该组选择（复选框或取消删除按钮）。图片候选以宿主原生输入声明为准，不能只凭插件能力覆盖或 LLM 记忆认定可看图；未知和文本模型不可作为视觉替代。迁移后的目标声明也需按最终预览校验，官方目标失去图片能力时必须处理。
- replaceVision 可以不同于普通引用的迁移目标，也可跨 Provider。直接目标改为对应 ModelRef；视觉通过别名时只把该视觉选择重绑到真实图片模型，不擅自改共享别名的候选。若别名仍引用待删除对象，作为其他使用引用单独显示、解决；不能绕过未处理引用校验。
- disableVision 在该组里设 vision.enabled=false，清除指向删除对象的 vision.target（含受影响别名目标）和旧 roles.vision.target 兜底；保留无关策略、无关目标及共享别名。关闭状态下遗留目标提供明确清理选项；取消不修改配置。其他使用引用仍有阻碍时不能只写关闭开关而不执行删除。
- 视图须列出视觉开关前后值、解析链、将清除／替换的目标和其他剩余引用。关闭后的行为沿用现有关闭规则：原生图片模型可直接处理，文本模型不再使用辅助。正在执行的旧请求和历史日志／缓存／证据不重写；后续新调用按新的配置处理。

### HTTP 接口与预览状态

前缀 `/api/model-manager`，各路径只注册一次；保留 trusted caller 校验及 405／Allow。

| Path | Method | 请求／响应 |
| --- | --- | --- |
| `/catalog-preview` | POST | `{operations: CatalogOperation[]}`；刷新目录，生成稳定快照及 `CatalogPreview`，不调用 API／LLM，不写设置。 |
| `/catalog-resolve` | POST | `{token: string, selected: string[], resolutions: {id: string, optionId: string}[]}`；接受目录或官方预览 token，替代模型、视觉操作、附属清理及参数选择均以服务端提供的选项解析。仅按缓存分析及冻结基线重建差异、校验原 revision／目录／覆盖，返回新 token；旧 token 即失效。无效／重复／未知选项拒绝，不替用户决定。 |
| `/catalog-apply` | POST | `{token: string, selected: string[]}`；仅执行当前 token 中唯一、非空、无阻止的整体操作，重新模拟及 CAS 校验；返回 `{applied, backupId, backupAt, snapshot}` 完整状态。 |
| `/catalog-restore` | POST | `{backupId: string}`；恢复完整 applied 的指定新备份，返回 `{restored: true, snapshot}`，并作废有关预览。 |

`CatalogPreview` 固定含 token、origin（manual／official）、fetchedAt、operations（id／kind／model／before／after／references／referenceChanges／attachedSettings／conflicts／choices／blockedReasons）、selected、counts（每 Provider 的 before／after 及 operationCount）、revisions、catalogFingerprint、overridesFingerprint、writesPlugin。writesPlugin 按选中操作判断是否更改插件配置，保护其他标签草稿；referenceChanges 展示视觉开关／目标、AUTO／别名及宿主引用前后值。references 提供位置、类型与可选别名链；conflicts 提供 id、path、候选 value／source／optionId、可选 evidence 和 resolution；choices 为替代／视觉／参数／附属设置等服务端允许的选择。不在响应中下发凭据，客户端不接收任意字段写入能力。

- 现有 OfficialPreview 保留分析输入、完整性、原文证据、pages、diffs 与 localModelIds，增加同一操作视图／选项和 counts。official-preview 的严格失败路径无有效 token。catalog-resolve 接受其 token 并返回含相同官方资料的更新结果，不重新获取网页或分析；official-apply 仍按 `{token,selected}` 通过同一执行器应用。
- official-restore 的 `{}` 保持恢复最近一次官方操作；新备份由共用执行器读取，原 v1／v2 备份按旧范围兼容，不补造新写集。手动操作备份不覆盖官方最近备份指针。
- 修改目录意图、官方临时分析参数或重新刷新立即作废旧 token。resolve 请求串行，旧响应不能覆盖新操作；处理期间禁止应用。counts 按选中整体操作的完整模拟结果算，不把字段／引用数当模型数。未解决或未选中的项不计预计变更。
- 新增／改名／删除表单独立于插件草稿。需要写 dsh-model-manager（包括 catalogMetadata）时已有其他草稿阻止应用／恢复，提供保存或放弃后重建预览；仅宿主写入刷新不丢插件草稿。候选替代及冲突处理均无需保存。

### 事务与备份

- 同一执行器冻结并完整预检选中操作的原始写集（相关宿主 models／modelOverrides、catalogMetadata、插件引用／附属设置、defaultModel 的两个字段、subagent 范围、未来覆盖）。按 namespace 合并 CAS，保留原始配置未知字段和 Provider 其他值；不使用全局迁移后的默认对象覆盖原始 namespace；describe 缺少 user 时视为未显式配置，不能回退用有效默认值备份。还校验目录指纹，不能无条件以最新 revision 重试旧意图。
- 新备份 `version: 3`、不可复用 UUID backupId，每次操作独立保存在 profile 数据目录 `catalog-backups/<backupId>.json`。包含 origin、token、时间、选中操作／用户选项、可选官方来源审计、每项原值及存在信息、写后值／revision、未来覆盖前后指纹和状态。另以原子文件 `catalog-backups/latest.json` 保存 manual／official 最近 backupId；旧 official-sync-backup.json 保留读取兼容，不覆盖。
- 沿用 prepared／applying／applied／rolled-back／recovery-required／restored 状态、串行队列、临时文件原子替换和 .bak；每个写入成功后记录进度。失败逆序按已写 revision 和覆盖指纹回滚；后续编辑已变化时不得强制恢复，显示具体未恢复位置。恢复前统一检查完整写集及备份状态；宿主 revision 为进程内版本，重启后的旧备份若版本不匹配也保守拒绝，不以当前版本强行重试；恢复失败保留可核对进度，不虚报成功。读坏备份时尝试其 .bak，无合法备份拒绝。
- 事务成功后刷新宿主目录及完整 snapshot，使设置卡片与宿主模型选择器观察新目录；不手改缓存或历史证据，不重写运行中已固定请求及本轮 active 选择。

### 验收证据

覆盖 SPEC F010 的 CRUD、物化、元信息、普通引用、冲突、指纹／CAS／回滚／恢复和 F004 全部视觉场景。客户端构建 bundle 验证独立表单、重复 ID 编辑入口、视觉三选项、别名链、关闭后的提示、未解决项跳过及模型／操作计数。development 专用临时模型和配置完成实际选择器更新及应用／恢复，测试后恢复原配置；日常仅 glm-5.3／medium 官方预览，不自动应用。源码验证依次 typecheck、build、完整测试与客户端冒烟，实际结果见 V1-COVERAGE，包版本 0.8.0。未验证项目必须单列，不登记整体兼容通过。

## LLM 官方同步契约（0.4.0 历史基线）

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
