# F009 设置页面与 HTTP 接口

## Purpose

为 dsh-model-manager 的设置页面与 HTTP 接口维护唯一可编辑的行为与验收规格，保留原编号 F009，区分当前预期、尚未实现设计和历史验证；原始需求、项目资料及旧文档继续原位只读保留。

## Requirements

### Requirement: F009 设置页面与 HTTP 接口

系统 SHALL 按下列完整场景落实设置页面与 HTTP 接口的预期、边界与验收。本节迁入已有功能规则；本次仅迁移文档，没有重新执行产品验收。

#### Scenario: F009-S01 Desktop 契约

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** Desktop 契约：原生插件详情六标签（新增模型来源），使用公开原生路由与传输地址。自有实时字段用实际 entry 的 SettingsForms，官方普通字段用 configEditor；草稿独立、未知／秘密字段保留。新增来源／登录／健康接口按 path 聚合注册，返回完整状态；见 Desktop 契约第 2、7 节及升级接缝。

#### Scenario: F009-S02 行为与边界

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 移除插件图片下拉、pluginImage 实测建议及对应应用提示，模型页按原始层 legacyImageOverrideCount 显示一次性旧字段清理入口；新增独立 clearLegacyImageOverrides 目录操作，复用完整预览／应用／恢复，清理后入口消失。

#### Scenario: F009-S03 行为与边界

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 模型页增加“智能补全参数”，按 Provider 分组，以 ID／名称筛选并勾选多个或全部已加载真实模型；组内全选只作用于当前筛选结果。临时分析参数、进度、逐字段选择和最近参数操作恢复独立于全局草稿；新增 model-parameter-preview POST SSE，复用 catalog-resolve／apply／restore。原路径与已有客户端输入保持兼容，新增字段详见架构同版契约。

#### Scenario: F009-S04 行为与边界

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 设置页只保留“模型、别名与兜底、AUTO 自动选模型、视觉、日志”，更新使用指引，说明 Subagent 由官方配置。移除 GET／PUT /api/model-manager/subagents、未使用的 subagents 注入、类型及包依赖，保留视觉仍使用的系统提示服务。

#### Scenario: F009-S05 本次接口

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 本次接口：CatalogOperation 增加独立的 `{kind: 'clearLegacyPreferences'}`，只允许单项提交，不携带模型目标，复用 catalog-preview／catalog-apply／catalog-restore（catalog-resolve 保持现有协议）。预览显示清理内容，不显示模型数量变化；完整响应、事务、草稿保护及版本冲突规则见同版架构契约。

#### Scenario: F009-S06 本次验收

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 本次验收：旧路由不再注册，其他路由唯一；配置清理不需要可写模型 Provider；不生成虚构模型条目；清理写集只有 auto.preferences，恢复原始字段并返回完整 snapshot，草稿、后续编辑、官方范围及凭据不受影响。

#### Scenario: F009-S07 行为与边界

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 别名卡片删除进入独立引用预览，处理选项不修改全局草稿；应用前若存在其他插件草稿，先保存或放弃并重新预览。引用以中文用途及字段位置显示；应用成功返回完整 snapshot，提供恢复本次操作入口。尚未保存的新别名可直接取消草稿，不向服务端删除不存在的条目。

#### Scenario: F009-S08 本次接口

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 本次接口：CatalogOperation 增加 `{kind: 'removeAlias', name: string}`，复用四个 catalog POST 路径及完整写集事务，不调用 API／LLM；逻辑别名操作不影响真实模型计数。模型 CRUD／官方同步原输入与返回字段保持兼容，详见架构“别名删除引用处理契约”。

#### Scenario: F009-S09 本次验收

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 本次验收：点击删除不立即修改已保存设置；无效引用原值可见、错误持久显示、未处理引用不能应用；改选／取消／并发失败不丢无关草稿；development 页面删除／恢复与构建客户端冒烟完成后才记录通过。

#### Scenario: F009-S10 行为与边界

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 模型页新增“新增模型”和各卡片“修改显示名称／删除”。独立目录操作表单及预览不计入全局插件草稿；只应用本次选中操作，不要求保存全部标签。已有其他插件草稿按写集保护：仅宿主写入不清空草稿，需写插件配置时先保存或放弃，再重建预览。

#### Scenario: F009-S11 新预览交互

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 新预览交互：直接列出可处理的字段冲突、使用引用、附属设置及来源；删除图片辅助模型时提供 F004 三个选项。手动替代、视觉替代／关闭及冲突选择只重新计算差异，不调用 LLM、不写设置。展示各 Provider 当前／预计模型数和操作数；未解决项可跳过。修改意图或刷新作废旧 token，重新计算期间禁止应用，错误后可继续处理。

#### Scenario: F009-S12 新接口

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 新接口：catalog-preview／catalog-resolve／catalog-apply／catalog-restore 共享安全规则；保留 official-preview／official-apply／official-restore，官方 token 也可交 catalog-resolve。原 GET snapshot 增加目录操作权限与元信息，返回完整状态，不改变既有 native 单字段接口。具体结构见架构 0.8.0 契约。

#### Scenario: F009-S13 分析时限（0.7.0，与 F007 同版确认）

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 分析时限（0.7.0，与 F007 同版确认）：官方同步面板增加“每轮分析时限（秒）”输入，默认 180，可填写 30–600 的整数；与入口／模型／推理档位一起临时使用，无需保存。分析中展示本轮已用秒数和设定时限，进度来自宿主本轮开始时间；其他阶段保持原提示。取消按钮持续可用，失败后恢复操作。

#### Scenario: F009-S14 时限接口

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 时限接口：预览 POST 增加可选 analysisTimeoutSeconds，省略采用 180；响应、分析进度和同步备份记录实际时限，字段及兼容规则见架构／配置同日章节。修改输入作废旧预览；其他草稿保护、应用／恢复写集不变。

#### Scenario: F009-S15 场景与预期

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 场景与预期：Desktop 原生详情以六个标签管理模型与策略；HTTP 接口提供配置、刷新、探测、推荐、官方同步及日志等操作。

#### Scenario: F009-S16 边界与异常

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 边界与异常：同 path 只注册一次；插件草稿与宿主字段保存隔离；revision 冲突返回 409；高成本操作须显式发起。

#### Scenario: F009-S17 验收条件

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 验收条件：页面保存后获得完整状态；宿主设置刷新不丢插件草稿；路由唯一；冲突不覆盖新设置。

#### Scenario: F009-S18 官方同步面板

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 官方同步面板：用临时入口网址、可选分析模型与公开推理档位取代三个必填网页；明确点击会调用一次或多次 LLM。展示“读取网页／分析资料／生成差异”进度并支持取消，成功后列出 API model name 清单、数量、原文证据和实际读取页面。分别显示本地数量、选中操作后预计数量和差异项数；新增、更新及无冲突迁移默认勾选，无替代关系的移除默认不勾选，阻止项不能勾选。无差异且无保留旧模型时才提示完全一致。

#### Scenario: F009-S19 草稿与接口

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 草稿与接口：入口／分析模型／推理档位／时限仅作为本次预览参数，不保存、不触发插件 dirty。只有其他插件草稿会阻止应用／恢复，可保存或放弃后重新预览。保留三个同步路径；预览支持 JSON／事件流，默认档位省略，非法档位或时限在网页／LLM 前拒绝。应用和恢复返回完整 snapshot。

### Requirement: F009-Desktop 7. 模块与 HTTP 接口（F008／F009／F013）

系统 SHALL 遵守已确认并实现的 Desktop 契约；本节替代对应旧平台接口与旧默认表述，不恢复已退役能力。

#### Scenario: F009-Desktop-S01 7. 模块与 HTTP 接口（F008／F009／F013）

- **WHEN** 用户在原生详情页操作设置或调用 HTTP 接口
- **THEN** 满足以下完整契约：

客户端通过本地 transport.hostRouteUrl 统一生成主机路由；原生普通 HTTP／SSE fetch 使用 dsh-app://app 的官方认证转发。公开 streamBaseUrl 供对应流式连接使用，不将回环 HTTP 直接交给原生 fetch（实际原生检查发现会被浏览器拦截）。原生 dsh-app://app 请求按实际 Host／Origin 精确校验，不从 location 拼回环地址、不放行任意 null Origin。每个 path 只注册一次并按 method 分发；取消、卸载和页面关闭释放请求、流、计时器及子进程。

新增模块边界：source-connections 发现及生成 SourcePreview；desktop-settings 解析所有者并提供脱敏 describe／CAS apply；alias-health 管理冷却和恢复租约；vision-analysis 共用于自动摘要与 inspect_image。既有 service／adapter／auto-router／catalog 继续编排，纯模块不反向取得 live ctx。

| 本版导出 | 输入与返回契约 |
| --- | --- |
| source-connections.describeSources(deps) | Promise<SourceDescription[]>；每项 {sourceId,kind,providerId,ownerEntryIds,credential:{ref?,configured,writable},arkProfile?,loaded,modelCount,checkedAt?,reason?}，不包含原始配置或秘密 |
| source-connections.previewSource(input,signal,deps) | 输入等于 /sources/preview；Promise<SourcePreview> 为 {sourceId,kind,providerId,fetchedAt,connectionChanges,models,catalog,notes}；connectionChanges 每项 {fieldId,label,before,after,selected}，models 每项 {model:ModelRef,fields,evidence}，未知资料不补值，catalog 为既有扩展 CatalogPreview |
| desktop-settings.describeOwners(ctx) | Promise<OwnerDescription[]>；每项 {owner,entryId,revisionToken,writable,applies,fields}，applies 为 live 或 reload；fields 仅目标允许编辑的 {path,value,inherited,userPresent}，秘密只描述是否存在 |
| desktop-settings.applyOwner(ctx,entryId,expectedRevisionToken,operations) | Promise<OwnerDescription>；operations 使用现有 set／unset 路径形状，服务端确认所有者／白名单／CAS，返回写后完整描述，不能由页面指定任意 entry |
| alias-health.openAliasHealthStore(profileDataDir) | Promise<AliasHealthStore>；提供 snapshot、eligible、claimRecovery、recordSuccess、recordFailure、release、reset 和 dispose；recordFailure 使用 LlmFailure／AliasRecovery，reset 使用 alias／expectedRevisionToken；快照只输出第 4 节健康状态，恢复租约为不透明内存 token |
| vision-analysis.analyzeImage(session,ref,question,region,signal,deps) | 每张 ImageAttachmentRef 返回 Promise<VisionAnswer>={answer,model:ModelRef}；imageRefs 去重多图，visionNotice 生成带附件编号与实际视觉候选的 notice，由 pre-step 或显式工具接纳 |

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
