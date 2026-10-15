# 配置说明（Desktop v4／0.13.0）

目标文档版：`model-manager-desktop-20261015-v1`，已确认并实现；本版验证见 [验收记录](VERIFICATION-0.13.0.md)。行为与接口见 [Desktop 0.13.0 契约](DESKTOP-0.13-20261015.md)，持久层接缝见 [升级适配契约](DSH-UPGRADE-20261011.md)。当前包 0.13.0／配置 v4；下文旧 settings.yaml 与 v3 条目为历史实现，目标宿主接缝以本节为准。

## Desktop v4 配置与 UI（已实现）

在既有 ManagerConfig 基础上新增下列字段；原始未知键保留。sourceKind='deepseek'|'ark-agent-plan'|'opencode-go'，TaskType='coding'|'writing'|'research'|'analysis'|'general'，TaskGrade 保持 simple／normal／complex。

| 路径／类型 | 默认与校验 | UI／所有者／生效 |
| --- | --- | --- |
| version:4 | v1–v3 有效迁移，v4 幂等；更高版本拒绝写入 | 迁移预览／管理器；首次成功保存或迁移应用才改原始版本 |
| sources?: Record<string,SourceConnection> | 缺省不持久补空对象；每项 {kind,providerId,arkProfile?}；来源键由宿主生成，kind 与 Provider 唯一关联 | 模型来源／管理器；选中导入应用后生效 |
| sources.*.arkProfile?:string | 火山账号查询必须明确选择；非空名称从 CLI 状态摘要选择，其他 kind 不创建该字段 | 模型来源／管理器；只控制目录查询，不切 CLI 默认或 DSH 调用身份 |
| aliases.*.recovery?:AliasRecovery | 可选局部字段，缺失采用下述默认；不用已退役 reliability 命名 | 别名卡“冷却与恢复”／管理器；下一轮使用新策略，正在执行的尝试不变 |
| recovery.transientCooldownSeconds:number | 缺省 60，整数 1–604800 秒 | 同上，“临时故障冷却” |
| recovery.rateLimitCooldownSeconds:number | 缺省 300，同范围；服务端有效等待优先 | 同上，“限流冷却” |
| recovery.quotaCooldownSeconds:number | 缺省 3600，同范围；服务端明确等待优先 | 同上，“额度冷却” |
| auto.evaluatorReasoningEffort?:string | 必须是评估模型实际公开值；缺失省略，不自动选 low／off | AUTO 评估设置／管理器；下一轮；切模型清空旧档位草稿 |
| auto.rules?:AutoRule[] | 缺省空规则，原始不存在不主动补写；按数组顺序优先 | AUTO 可选规则／管理器；下一轮 |
| AutoRule | {id,name,enabled,taskTypes,grades?,selection}；id 唯一稳定，name 非空；enabled 新建默认 true；taskTypes 为非空去重集合；grades 缺失不限，存在则非空合法集合；selection 使用现有 Selection | 添加／编辑／排序／启停／删除规则；启用的目标须完整可用 |
| vision.automatic?:boolean | 有效默认 true；只有 enabled 时执行，显式 false 保留旧图片工具路径 | 视觉“自动理解图片”／管理器；下一轮，进行中请求用原快照 |

来源 apiKeyEnv／baseURL／api／models 等字段仍只存实际原生所有者，不复制到 sources。原生新来源高级表单按实际 schema 提供，只写明确编辑字段；OpenCode Go 只导航原插件设置。保存凭据是独立动作，新增引用使用 DMM_DEEPSEEK_ 或 DMM_ARK_AGENT_PLAN_ 加随机合法后缀，由服务端分配；不覆盖已有名字。凭据保存成功后可继续预览，取消预览不删除已保存 Key；旧 Key 更换在原生凭据入口完成，不进入管理器目录回滚。

自有 schema 的实时字段通过实际 entry ID 的 SettingsForms 保存；官方非 volatile 字段走 configEditor.edit，以原始＋继承层指纹作 CAS，不改变上游 volatile 语义。自有参数更新对后续轮次生效；原生来源参数按其 Loader 生命周期生效，保存前阻止相关在途操作，返回真实的生效／重挂载结果。普通全量草稿保存不覆盖刚独立完成的来源、凭据或目录操作。

### v1–v4 迁移与遗留配置矩阵

| 原始数据 | 有效 v4／写入规则 |
| --- | --- |
| v1／v2 的模型、别名数组、主模型、角色与档位 | 先执行既有保值语义，再归一为 v4；tiers／legacyTiers 和仍有效主／视觉绑定保留，不生成 preferences |
| v3 的 aliases／efforts／auto 三档／vision／models | 保留原值，增量默认仅存在有效层；不自动开启 AUTO 或原本关闭的视觉 |
| 缺少 recovery／rules／sources／automatic | 有效采用新默认；首次保存仅写实际选中修改和 version=4，不全量物化 schema 默认；已经开启的视觉在本版 automatic 默认 true 下改为自动辅助 |
| 已有 vision.enabled=false 或限定策略 | enabled 和 policy 原值保持；automatic 不绕过禁用或 native-only |
| models.*.capability.image、auto.preferences、aliases.*.reliability 三键 | 继续按各自已确认独立清理／备份恢复规则处理；raw 保留至明确清理，不参与运行，不从恢复或默认值复活 |
| auto.main／roles、official 历史字段及未知键 | 仍有效部分继续读取并纳入引用；未知值原样保留，不借版本升级清除 |
| AUTO 新规则目标／相关参数 | 新增为完整使用引用；目录改名／删除、官方迁移和恢复一并检查，不产生悬空规则 |
| 原生来源旧七档／input=[]／maxTokens | 不由本次迁移猜测校正；预览独立选择，未选字段和未知模态保留，输出上限默认不选 |
| 历史 v2／v3 目录备份、证据和会话 | 保留原件；旧证据签名不改成新验证；跨宿主旧备份不能直接覆写新 owner，无法证明完整映射与基线时拒绝恢复 |

启动对旧值只读归一，尚未迁移的原始层在页面可见；实际迁移应用前完整备份并核对原始用户层、继承层、全部引用及目录。schema 须接纳可迁移的旧配置输入，不先用 version=4 校验把旧插件挡在挂载阶段。配置异常展示诊断，不能静默恢复默认并覆盖原件。

### 独立健康状态

目录使用实际 Profile 配置文档所在目录下 data/dsh-model-manager，沿用同 Profile 原有 verification／vision cache／catalog-backups；不能缺省落到 web。不自动把其他 Profile 或旧共享目录数据搬进来。

alias-health.json 保存 {version:1,revision,entries}。AliasHealthEntry 为 {alias,model:{providerId,modelId},signature,kind,failedAt,retryAt?}；kind 限 transient／rate-limit／quota／auth，时间为 UTC 毫秒，auth 无 retryAt。signature 绑定候选／来源与相关配置／凭据代次，客户端不回传私有凭据指纹。健康文件不含 Key、完整错误正文、提示词、图片、alias 顺序或 Selection。

使用文件锁、CAS、原子写和损坏备份回退；状态损坏明确提示并丢弃不可验证条目，不写模型能力。到期条目仍留作一次恢复竞争记录，恢复租约与本轮成功候选只在内存，进程重启后无悬空租约。候选移除、相关配置／凭据变化删除相应失效状态；成功清除对应条目；其他 Profile 不受影响。手动重置只清状态，不能同时更改凭据、发模型请求或修改验证证据。

新增 source 操作备份使用目标版完整写集格式，latest 指针按 source／manual／official／parameter 分开；恢复使用后写状态 token 和实际所有者版本，跨重启或后续编辑不匹配时保守拒绝。冷却状态不随目录备份恢复复活，恢复后的相关来源重新计算健康签名。

## 别名候选恢复（alias-failover-20261010-v1，已实现 0.12.0）

对应 SPEC F002 和架构同版契约，基线 0.11.0，当前实现 0.12.0。用户审阅本版文档后回复“继续实现”明确确认；以下为当前实现，不影响另行待确认的批量测试。

- 配置保持 v3，别名仍保存 candidates 与 efforts。新固定规则：按顺序遍历全部去重候选；临时网络／超时／服务端故障每候选最多实际调用五次，含首次、重试间隔 0.5／1／2／4 秒；其他错误立即下一候选；用户停止立即结束。没有全局三次总上限，也不新增可调重试字段。
- 别名回答成功后才显示完整结果，中途失败的半段回答／推理／工具调用丢弃。重新请求当前模型调用，不重跑之前完成的工具；暂存 32 MiB 上限、取消、耗尽反馈见架构同版契约。直接别名和 AUTO／视觉／覆盖最终选到别名均一致。
- 别名页移除三个旧策略覆盖控件，展示固定规则及完整结果暂存说明；页底全局 reliability 改为“具体模型恢复策略”，明确不控制别名。具体模型入口仍读取 reliability.maxAttempts（1–3）、retryTransient 和 parameterDowngrade，不清理有效全局值；具体模型旧长上下文逻辑保留。

### 失效字段与完整引用

| 原始路径 | 新版判定 | 读取／保存／清理 |
| --- | --- | --- |
| aliases.<name>.reliability.maxAttempts | 失效的旧总尝试限制 | 不读、不校验；仅原始层保留待独立清理 |
| aliases.<name>.reliability.retryTransient | 失效的旧网络重试开关 | 不读、不校验；仅原始层保留待独立清理 |
| aliases.<name>.reliability.parameterDowngrade | 失效的旧参数降级开关 | 不读、不校验；仅原始层保留待独立清理 |
| aliases.<name>.reliability 的其他键／未知整体值 | 未知，不能认定失效 | 原始层保留；清理不覆盖、不误删 |
| 顶层 reliability 的同名三个键 | 具体模型仍有效 | 保持既有默认、校验和设置入口 |

- 不把旧总次数转为新“每候选次数”，因为两者含义不同；新别名固定五次，无隐式参数降级。旧原始 maxAttempts=1／2／3、类型错误或曾保存的开关均不得改变新别名行为或阻止正常操作。启动及普通读取不自动写入／清理。
- 独立清理按钮只在检测到旧叶键时显示；GET snapshot 新增 legacyAliasReliabilityCount 为相关别名数。先保存／放弃其他草稿，调用现有目录预览接口的 `{operations:[{kind:'clearLegacyAliasReliability'}]}`；预览显示每个别名三键的原值及删除后差异，明确勾选再通过原应用接口写入，不混入其他目录或清理操作。
- 删除只作用于原始用户层的三叶键；全部删除后 reliability 为空则删除空对象，未知键保留。别名名称、candidates、efforts、AUTO／旧有效绑定、视觉、宿主默认、原生 Subagent、未来覆盖、全局 reliability、其他未知设置及凭据均不改；这些引用继续指向同一个别名。
- 使用既有 v3 manual 目录操作备份／CAS／安全回滚／恢复，恢复叶值及是否存在；取消预览不写入，后续配置／目录／覆盖变化拒绝覆盖应用或恢复。恢复旧叶值仍不执行旧策略，清理后重复清理为空，不生成伪操作。
- 普通保存保留原始尚未清理旧值；有效层不携带退役键，界面不可再创建／改写。清理后保存不根据默认值、旧草稿或旧有效快照补回键。目录／官方迁移仍保留 unknown，不把退役值当有效校验输入；从旧备份／配置导入恢复后按同样规则识别，不借本次规则改变其他历史数据。
- 验收使用脱敏真实旧配置，比较原始持久文本／对象和写入差异，覆盖缺失 aliases／reliability、部分键、任意类型旧叶值、未知嵌套值、多个别名、全部引用保留、重复清理、保存不复活、备份恢复、写入失败回滚和并发冲突。已开始请求继续用原快照；日志与验证记录不迁移。

## 模型一键批量测试（batch-verification-20261010-v1，待实现）

对应 SPEC F006 和架构同版契约，基线 0.11.0。本节尚待用户确认及实现，不是当前可用设置。

- 配置保持 v3，不新增持久字段；并发两个模型、默认文字＋工具＋已声明图片、单项 60 秒均为本次固定行为，不新增只可文件编辑的配置。timeoutSeconds 是验证 HTTP 请求的临时参数，批量固定传 60，单模型省略保持原行为；不会写入模型、AUTO 或 Provider 配置。
- 队列、筛选、本轮汇总仅保存在当前页面；关闭取消、刷新不续跑。verification.json 仍按 Provider＋模型＋项目保存最近一条，新增可选 timedOut 字段，旧记录缺失即 false，无需批量迁移或清理。重测只替换同项目，未重测历史项保留。
- 批量不临时提权图片、不应用探测建议、不写模型能力；运行锁定当前页面配置写入，其他未保存草稿保留，刷新证据不能把有效默认配置写成用户覆盖。
- 本次无失效配置字段或引用删除；旧 v1／v2／v3、未知键、停用偏好和旧图片原始值按已有契约保留，不借批量测试清理。运行验证需比较原始持久设置前后内容、旧证据读取和新字段重启读取；过期仅展示，不自动更新历史签名。

## 智能补全模型参数（文档版 model-parameters-20261010-v2，已实现 0.11.0）

对应 SPEC F011／F001／F006／F009 和架构同版契约，基线 0.10.0，功能版本 0.11.0；用户回复“好，按照设计文档修改并开发吧”确认本版，已按以下契约实现。配置版本仍为 v3。

新增可选 `parameterCompletion?: {searchCredentialName?: string}`，只保存搜索凭据引用名。字段缺失时有效使用 `WEB_SEARCH_API_KEY`，不在启动／迁移／普通保存时补写 section 或默认名；显式值必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，空字符串／null／非字符串拒绝。页面“搜索凭据引用”独立保存到宿主同名分节，通过 revision/CAS 仅 set 该叶字段；“使用默认”仅 unset 该叶字段，若原 section 无其他键则 unset 整个空 section，未知 section 键保留。已有插件草稿仍保留，草稿与该已保存字段基线同步，后续全局保存不能覆盖刚更新引用。

Key 由 DSH Credentials resolve 获取，浏览器只显示引用名与是否可用，不回显 Key；可填写当前 Agent Plan 使用的已有合法引用名。固定豆包搜索 API 使用 Agent Plan 专属 Key，控制台须已开通豆包搜索；凭据无效／额度／网络失败展示原因，并允许知识兜底，不能伪造官方证据。认证和服务说明见[火山官方文档](https://docs.volcengine.com/docs/ark/agent-plan-personal-search?lang=zh)；Key 不写进插件仓库、运行配置正文或日志。

分析目标、分析模型、推理档位、每轮时限、勾选字段和预览 token 都是本次临时状态，不放 localStorage、不保存成设置。默认宿主真实分析模型、模型默认档位、每轮 180 秒，可选 30–600 整数秒；参数更改使旧预览失效。搜索引用修改也使旧预览失效，已开始任务使用固定的本次引用，不中途换凭据。名称／ID 搜索只筛选模型列表，实际目标始终为 Provider＋ID。

应用后的持久配置仍使用 Provider 原生模型字段：llm-pi-ai 显式 models 或合法 modelOverrides；DeepSeek 的 models。只写选中模型内字段及明确解决的依赖，不改变 Provider api／baseURL／headers／凭据及运行偏好、不新建／删除模型。字段范围、不同协议白名单及逐字段原始层来源见架构；价格／工具能力等没有宿主模型字段时不创造配置键。name 来源标记和推理／视觉引用若修改，加入同事务备份；插件图片声明按下节退役，不提供同步覆盖选项。

用户显式已有值与官方不同只提供可选校正；继承目录同值不写覆盖。maxTokens 永远默认不勾选，因为显式模型配置还影响请求默认输出；知识建议与自定义／未知来源名称也不默认应用。unknown 不写值，明确 false 必须保留；推理映射与 compat 组合由宿主 schema 校验。Provider 默认值不通过本功能修改，不能用补字段把有效默认层全量落盘。

旧 v1／v2／v3 模型、别名、tiers／legacyTiers、旧有效 main／视觉兜底、official 历史来源及未知键按已有契约保留；auto.preferences 保持可选停用，缺失不复活，本次不自动清理旧设置。新增 section 无需旧字段改名或迁移。开发验证须覆盖缺失／部分 section、显式 false、未知键、旧配置重复迁移／保存，以及字段 unset 后不复活。

备份仍在 profile 隔离数据目录 catalog-backups，每次 parameter 操作独立 UUID、完整原值与存在状态、选中字段、分析证据和写后版本；最近 parameter 指针独立于 manual／official。恢复按既有完整写集和版本校验，拒绝覆盖后续编辑及跨重启 revision 不匹配；历史格式不补造新的参数写集。保存／分析参数不污染真实验证证据，真实请求与页面验证结果单独记录。

## 插件图片声明退役（model-parameters-20261010-v2，已实现 0.11.0）

对应 SPEC F012 及架构同版章节，用户要求移除图片卡片中的“插件图片声明”；用户已明确确认本版，已实现于 0.11.0。原生图片 input／inputModalities、上下文 contextWindow、模型最大输出 maxTokens、推理档位及 wire 映射 reasoningEfforts 都进入搜索补全，当前值不是已核实证据；查到不同值可选校正，未证实值保留原值。maxTokens 的请求默认影响与默认不选规则保持。

退役路径只有 `models[modelKey].capability.image`；任何旧值都不影响 AUTO、图片路由或视觉候选资格。不移除整个 capability、models、tiers／legacyTiers，不修改 vision 开关／策略／目标；thinking／contextWindow／maxOutputTokens 及未知能力属性仍按已有契约保留。模型原生声明是唯一原生图片能力来源，辅助功能仍是独立组合能力。

启动不改持久配置；有效迁移忽略旧 image，普通保存仅保留仍存续模型的原始退役叶值到明确清理，不让新的编辑值改写或重新创建。界面不再显示该项编辑器，有旧值时仅显示一次可消失的清理提示，输入 `{operations:[{kind:'clearLegacyImageOverrides'}]}` 独立预览，明确应用才删除全部原始退役叶及本次变空的包装。失效模型键也可清理，Provider 不可写不阻止该插件设置操作；需要先保存／放弃其他插件草稿。具体请求、计数和存在状态见架构。

清理完整备份／版本检查／回滚与恢复沿用目录事务；原始值不会默认为宿主图片能力。清理后普通保存、重复迁移、目录合并不复活；恢复历史原始 image 数据时仍停用，清理提示重新出现。没有自动配置迁移写入或无备份删除，不清除无关未知键。验证建议从新版本只返回宿主支持建议，拒绝／未识别／失败只记证据，不自动否定原生图片能力。

## 子 Agent 入口移除与旧偏好清理（0.10.0）

文档版本：2026-10-10，基线 0.9.0，目标 0.10.0；对应 SPEC F002／F003／F005／F009 和同版架构契约。用户审阅具体文档后回复“继续”明确确认，已按该版实现；实现状态：已实现。本节替代下文“旧角色生成分工偏好”和“插件页面读写原生范围”规则，历史记录不作为新功能已实现证据。

- 配置仍为 v3，auto.preferences 改为可选停用历史字段。显式存在时原样保留内容与未知键，缺失不补 `{}`，旧角色迁移不再生成该字段。启动、普通保存、其他目录操作和官方迁移不自动清理或改写；不再注入分工提示，也不作为模型／别名删除的有效使用引用。清理后再保存或再次迁移不能复活该字段。
- AUTO 页在已保存字段存在时显示“旧分工偏好已停用”，可查看和预览清理；空对象也可清理。没有新增／编辑入口，字段不存在时不显示清理卡片。原生模型范围到 DSH 官方设置配置，不再提供插件的 /subagents 路由。
- 独立预览输入 `{operations: [{kind: 'clearLegacyPreferences'}]}`，只允许单项且不携带模型目标。字段缺失时提示无需清理；预览不调用 LLM、不写设置、不修改草稿。有未保存插件草稿须先保存或放弃，再预览。
- 明确选中并应用后，仅 unset `dsh-model-manager.auto.preferences`，备份该字段原值与存在状态；沿用版本检查、失败回滚及同生命周期恢复。原生 subagent-model-selection、旧 auto.main／roles（特别是视觉兜底）、AUTO 三档、模型目录、别名、凭据和未知字段保留。
- 清理完成后卡片消失，最近操作恢复入口仍可发现；恢复原始字段后卡片重新出现，偏好仍停用。恢复不会重新启用已移除的功能，也不自动改写历史引用；若后续配置或宿主 revision 已变化，则拒绝覆盖。

接口响应、配置清理类型和备份边界见 [架构契约](ARCHITECTURE.md) 的“子 Agent 配置入口移除与旧偏好清理”节。本次实现及验证见 V1-COVERAGE；测试后 development 配置恢复原始文本，未修改日常配置或原始需求。

## 别名删除与视觉引用清理（0.9.0，2026-10-10）

对应已确认并实现的 SPEC F002／F004／F009 及架构“别名删除引用处理契约”。0.9.0 通过独立预览处理隐藏的旧 auto.main 引用，修复原 0.8.0 删除别名后保存失败的界面缺口；不能通过关闭视觉辅助消除旧主模型引用。

- 配置仍为 v3，不增加持久配置字段，不自动迁移或清理旧目标。独立删除预览使用 `{kind: 'removeAlias', name: string}`，选项仅临时保存于本次 token；应用才删除 aliases[name] 和明确处理的使用引用，不删除底层模型或模型覆盖。
- 旧 auto.main 仍参与未启用新 AUTO 的入口选择，不能视为无用字段静默删除。用户明确清除旧目标后，旧 AUTO 使用宿主默认；清除依赖目标的 reasoningEffort／tier／thinking，保留独立 maxOutputTokens 和未知字段。新 AUTO 已启用的三档及宿主默认必须提供替代模型。
- vision.target 与旧 auto.roles.vision.target 均可在界面查看、替换或清除，即使视觉辅助已关闭。清除当前目标时需明确处理仍存在的旧兜底；失效值显示原值及原因。删除只涉及旧兜底且当前目标有效时，不关闭辅助、不清除当前目标、不改变策略。
- 本次已选配置意图：清除指向 @deepseek-v4-1 的旧主模型及旧视觉兜底引用后删除别名；保持当前视觉辅助、arkcli-coding-plan/glm-5-3-flash 及 AUTO 三档。实时预览若有其他引用，仍须逐项明确处理，不能先删别名绕过校验。
- 未处理引用阻止应用；未保存草稿须先保存或放弃并重新预览。写入、备份、失败回滚和恢复复用完整事务，恢复拒绝覆盖后续编辑。启动、预览、取消均不写配置，不改凭据或历史请求。

## 目录来源元信息（0.8.0，2026-10-10）

对应 SPEC F001／F004／F007／F009／F010 和架构“模型生命周期与统一操作预览”，基线 0.7.0，目标 0.8.0。本节经用户“可以，实现吧”明确确认后实现；原配置版本仍为 v3，不改原始需求、启动时不自动写配置。

新增可选 `catalogMetadata?: Record<string, { origin?: 'manual'|'official'; customName?: boolean }>`，键仍为 `modelKey({providerId,modelId})` 的 JSON 复合键。字段缺失表示来源 unknown／无新标记；不得据此认定旧名称来自官网。迁移旧 v1／v2／v3 时保留元信息及其未知键，不要求用户先保存。

- 手动新增记录 origin=manual；官方新建记录 origin=official。改名写宿主模型的 name 并记录 customName=true，不改变已有 origin、不修改 API ID。既有显式名称且来源不明时按本地名称保护；官网建议名称仍可审阅并明确选择采用，该次采用设 customName=false。
- 官方同步不默认覆盖 customName=true 的显示名称；手动新增未列入官网当前清单时提示核对，删除需明确勾选，不自动删除。官方明确兼容迁移时元信息同步到目标，保留已有目标来源；不同自定义名称列为冲突，用户选择最终值并保持其来源标记，不静默舍弃名称。
- 删除同时删除该条元信息；能力覆盖／档位／孤立 efforts 键是附属设置，需预览明确清理。元信息、宿主 name 和目录条目随同一事务备份／恢复，不能只写一半。
- 真实目录分别写 llm-deepseek.models 或 llm-pi-ai 的 configurable settingsPath；models 与 modelOverrides 的宿主约束和原值保存见架构。手动目录管理不新增密钥、Provider、协议或端点。新增／改名／删除表单是临时意图，只有应用选中操作才写设置，不随全局保存混入。
- 图片辅助引用处理：替换真实图片目标，或整体设置 vision.enabled=false 并清除删除对象的直接／别名视觉目标及旧 roles.vision 兜底；保留无关目标和共享别名。即使已关闭，遗留引用也可显式清理。其他未处理使用引用仍阻止该组，图片模型存在本身不影响无关删除。
- 普通引用手动替代允许跨 Provider，defaultModel 的 provider／model 一起更新；不将旧目录能力或 Provider 字段复制给另一模型。已知不兼容档位在预览改选或清除为默认，未知属性不据此覆盖设置。官方兼容迁移按字段来源及用户冲突选择保留配置。
- 临时官网入口、分析模型、推理档位、时限仍不保存。官方资料识别只处理 DeepSeek；手动跨 Provider 替代仅处理用户明确选中的引用，第三方目录不被官网清单增删或覆盖。
- 新事务备份 v3 每次独立保存，记录选择、全部前后值和存在状态；恢复只在写后版本／覆盖未变化时执行。原官方 v1／v2 备份按原范围恢复，不推断新的元信息或跨 Provider 字段。完整接口与存储路径见架构 0.8.0 契约。

## 临时分析时限（0.7.0）

按 2026-10-10 用户明确确认的 SPEC F007／F009，新增页面输入与预览请求字段 `analysisTimeoutSeconds`，默认 180，允许 30–600 整数秒；表示单轮分析总等待时间，包含推理和输出，不是空闲超时。从 0.7.0 起替代固定 60 秒。

该值与资料入口／分析模型／档位一样仅本次临时使用，不保存、不计入草稿、无需点击保存，不新增 official 设置键或更改配置 v3。预览和新备份记录实际时限用于审阅；应用／恢复不把该参数存成用户偏好。其余网页、轮次、证据、迁移与恢复规则保持，接口和进度字段见架构同日章节。

## 临时同步参数（0.6.0）

按已明确确认并实现的 SPEC F007／F009，资料入口、分析模型和 reasoning_effort 改为本次预览的临时页面参数；更改与刷新不要求保存，也不写设置。旧 official.sourceUrl／official.analyzer 保留兼容，可用于首次初始化，不迁移或删除既有值；不新增持久化推理档位字段。

推理档位仅可选择真实模型公开值，留空表示请求省略该字段，使用模型默认，不自动选 low。同步应用只写用户选中的模型／引用差异及同步记录，不保存本次分析参数。其他插件草稿仍与同步参数分离；用户可放弃其他草稿后重新预览，无需为了试分析参数保存全局设置。细节见 [临时分析契约](ARCHITECTURE.md#2026-10-09-临时分析参数契约)。以下字段保留兼容，新面板不再保存本次分析参数。

`dsh-model-manager` 设置保存在 DSH 的同名设置分节。模型键由 Provider ID 和模型 ID 组成，避免不同 Provider 的同名模型冲突。

0.5.0 的可读受管理路由 ID 为分别 URI 转义的平台／模型 ID，继续接受旧 Base64url ID。它不改变配置 v3、`{providerId, modelId}` 引用对象或 JSON 复合存储键 `modelKey()`，无需迁移设置或历史会话；格式见 [架构契约](ARCHITECTURE.md#可读受管理模型标识契约)。

| 字段 | 用途 |
| --- | --- |
| `aliases` | 有序候选和别名级兜底策略；`efforts` 按候选模型键保存实际推理档位 |
| `models` | 用户能力覆盖和旧配置迁移映射；新选择用实际 `reasoningEffort` |
| `auto` | `enabled`、`evaluator`、`simple`、`normal`、`complex`；`preferences` 为可显式清理的停用历史字段 |
| `vision` | 是否启用、原生／辅助优先策略和辅助模型 |
| `reliability` | 请求重试、参数降级和最大尝试次数 |
| `official` | 最近一次官方资料抓取时间与来源链接 |

执行档 `Selection` 可用 `target` 指向具体 `{providerId, modelId}` 或 `@别名`，并可配置 `reasoningEffort`、`maxOutputTokens`。推理档位留空即模型默认；关闭思考只在模型声明 `off` 时可选。`simple/normal/complex` 是任务分类，和模型档位无映射关系。评估器独立配置，不能引用 AUTO。

旧 v1/v2 读取时迁移到 v3。旧别名数组转为候选对象，长上下文候选转为 `@long-context`；旧 `auto.main` 保留为固定入口，并初始化常规／复杂执行档；旧角色模型转成可选分工偏好。旧 `fast/balanced/deep` 按每个模型的原值保存在 `legacyTiers`，避免不同旧档位折叠后丢失。新 AUTO 默认关闭，启用前不会增加评估调用。迁移可重复执行。

原生子 Agent 模型范围不在此分节，统一在 DSH 官方设置配置 `subagent-model-selection`，插件不提供重复编辑入口。其修改对新会话生效。

DeepSeek 官方同步保留 `/api/model-manager/official-preview`、`/official-apply` 与 `/official-restore`；预览从可配置入口读取资料，写入范围及备份规则见下文。官方识别不增删第三方目录；0.8.0的手动引用替代及目录管理见前文。

## LLM 官方同步配置

2026-10-09 已确认契约，0.4.0 实现；替代旧固定域名／三页读取及两份配置备份限制。

| 字段 | 类型／默认 | 行为 |
| --- | --- | --- |
| `official.sourceUrl` | 可选 HTTPS URL，缺省 `https://api-docs.deepseek.com/zh-cn/` | 每次显式刷新重新读取的入口，可手动修改 hostname 和路径；后续页面和重定向限该 hostname。 |
| `official.analyzer` | 可选 `{ providerId, modelId }` | 单独的真实分析模型，未配置使用宿主默认；不接受受管理 Provider、AUTO 或别名，不回退 AUTO 评估模型。 |
| `official.checkedAt` | 可选 ISO 时间 | 最近一次成功应用使用的网页抓取时间；仅预览不会修改。 |
| `official.sources` | 可选 `Record<string, string>` | 旧三页来源保留为历史，不驱动新抓取；新来源证据在完整预览和备份中记录，不用新的入口覆盖旧历史。 |

这些可选字段仍属于 v3，旧 v1/v2/v3 迁移保留原 official 内容；只补缺省行为，不在启动时自动联网或调用 LLM。入口与分析模型仅用于首次初始化，新面板独立临时参数无需保存；预览请求显式字段优先于已保存值，未提供再取缺省。用户修改分析模型不会修改 `auto.evaluator`、宿主默认模型或原生 Subagent 设置。

新同步由 LLM 识别当前 model name、替代关系和有原文依据的属性；模型数量、型号、表格布局、价格／思考页面路径不固定。最多六页、三轮分析，具体结构、限额、事件流、差异依赖及备份契约见 [架构](ARCHITECTURE.md#llm-官方同步契约)。

0.7.0 已有模型保留用户 maxTokens、凭据和未知字段；迁移包含官方目录、插件引用／模型键、默认模型、Subagent 范围及未来覆盖，进行中请求与历史证据不改。该版有引用移除及用户字段冲突会阻止，需要到其他页面调整后重新预览；0.8.0以本文前节的预览内处理、附属设置清理和视觉三选项替代此限制，不把历史验证当新实现证据。

无效结果或不完整证据不提供可应用预览；分析可能多次调用 LLM，点击前显示用量提示。官方声明的当前清单不等于当前账号可调用验证，也不改变宿主真实公开的推理档位。

### 0.13.0 实装核对

最终日常读取 v4，但只读归一没有把默认设置写成用户层。原主模型及来源配置保持，AUTO 与视觉仍由用户明确开启。实际安装／保留证据见 VERIFICATION-0.13.0.md；本机火山账号查询需要重新授权，调用 Key 与登录独立。
