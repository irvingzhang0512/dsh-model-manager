# 批量验证队列、接口、签名与证据存储

## Purpose

迁入已有文档中的批量验证队列、接口、签名与证据存储完整技术边界和验收条件，以 OpenSpec 维护待确认的行为契约；本次不改变产品规则、不写配置、不执行迁移，也不把文档结构校验当成运行通过。

## ADDED Requirements

### Requirement: batch-verification-contract-C1 模型一键批量测试（batch-verification-20261010-v1，待实现）

系统 SHALL 在实现本变更时遵守以下接口、状态和异常处理契约。

#### Scenario: batch-verification-contract-C1-S01 模型一键批量测试（batch-verification-20261010-v1，待实现）

- **WHEN** 执行模型一键批量测试（batch-verification-20261010-v1，待实现）相关操作
- **THEN** 满足以下全部规则，任何未实现部分保持待实现状态：

对应 SPEC F006，基线 0.11.0／`89aac7b018ac8a123aa40b98ecabc153eeee9d40`。本节为待确认增量，不表示已可用；确认后替代旧混合徽标口径，保留单模型验证／图片探测。没有新增后台批量任务服务或运行依赖。

##### 队列、进度和锁定

- 客户端独立调度模块以 Provider＋modelId 复合键去重冻结已加载真实目标，保留目录顺序。全局入口取当前筛选列表；平台入口从完整 snapshot.models 按 providerId 取整组，不能用名称筛选后的 group.models。逻辑别名和管理 Provider 不进入队列。
- 每模型 text → tools → nativeImage=yes 时的 image，两个 worker 调度模型，每 worker 内项目串行。预计请求数为 `2 × 模型数 + 支持图片模型数`，启动前随按钮数量展示；空目标禁用，不自动重试或换候选。
- 批量状态为 idle／running／stopping／completed／cancelled；项目状态为 pending／running／passed／unconfirmed／failed／timeout／cancelled／not-applicable，pending 中文“未执行”。进度按已执行终态项目／计划请求数显示，不计不适用项；停止后未开始项保留 pending。结果包含 ModelRef、项目、时间、Verification?、安全错误摘要，不包含密钥或完整配置。
- 停止同步阻止获取新项目并 abort 全部活动请求；pagehide／面板卸载同样取消。以本轮 token 隔离 worker 和刷新，旧任务不得写新一轮状态。完成／停止刷新 snapshot 只更新证据和目录，不覆盖草稿；刷新失败保留本轮结果并显示错误。不保存后台队列、不刷新续跑。
- 运行锁定当前模型管理页面全部配置写入、单模型测试／探测、其他批量入口和会发真实分析请求的操作，共同锁传递给子面板；停止、浏览、展开和筛选可用。已有草稿无需保存，测试不能使其落盘。

##### 接口、超时与签名

复用 `/api/model-manager/verify`，不新增批量路由。每 exact path 仅注册一次，保持 trusted caller、405／Allow、请求体限制和既有错误响应。

| Path | Method | 增量契约 |
| --- | --- | --- |
| `/api/model-manager/verify` | POST | 原 `{providerId,modelId,kind}` 增加可选 `timeoutSeconds:number`，有值须为 1–600 整数，非法值在模型调用前拒绝；批量固定传 60，省略保持原单模型无额外总时限行为。响应仍 `{verification:Verification}`。 |

- Verification 保持原 status 枚举，增加可选 `timedOut:boolean`；服务端截止时 status=cancelled、timedOut=true、detail 说明总时限。用户取消不带 true，旧记录缺字段按 false 处理；客户端用字段识别超时，不猜错误文案。
- 服务端计时包含模型解析、附件准备和全程 stream，输出不延长。截止与连接关闭共用取消信号，竞争不响应 AbortSignal 的解析／iterator.next，及时结束并保存一次结果；不等待不配合取消的 iterator.return，不允许迟到结果覆盖终态。结束及宿主 effect 卸载清理 timer／监听器／活动控制器。
- 客户端单项增加 65 秒传输兜底，优先显示服务端 60 秒超时证据；兜底触发显示本轮 timeout 并取消连接，不伪造已保存证据。用户取消显示 cancelled，连接／HTTP 错误显示 failed。
- 验证开始、任何 await 前捕获 `service.signature(ref,kind)`，证据使用该值；结束后仍用当前签名判断 stale。只调整采样时机，不缩减签名字段、不自动重写旧记录。

##### 判定、历史与存储

- 共用结果投影：timedOut=true → timeout；cancelled → cancelled；rejected／network-error → failed；accepted 且 behavior=observed → passed；其余 accepted → unconfirmed。文字 observed 要求非空白输出，工具要求调用事件，图片沿用颜色判定；reasoning 的 unknown 不算能力通过。
- 本轮表分文字／工具／图片展示，汇总按已执行项计通过／未确认／失败／超时／取消，只用本轮结果。配置已变化的本轮完成项额外标过期，不能宣称当前配置通过。
- 分组与模型卡片按项目展示最新未过期证据的通过／未确认／失败／超时／取消，未测显示尚无证据；stale 单列“历史证据过期”，不参与当前通过／失败计数。替代旧“已验证 N”“验证失败/过期 N”，批量与单模型共用判定及项目名。
- verification.json 仍按 modelKey＋kind 保留最近一条，写队列保证两个 worker 结果不互相覆盖；重测替换该项，未测项保留。新增可选字段兼容旧数组与 .bak 读取，不存批量任务／队列／筛选状态。

验收覆盖 SPEC F006，另覆盖不响应取消的流、资源清理、取消竞争、旧记录兼容与请求签名采样；实际构建客户端冒烟和 development 页面／真实调用分别记录，不以文档存在代替验证。

### Requirement: batch-verification-contract-C2 批量验证配置兼容

系统 SHALL 在实现本变更时遵守以下接口、状态和异常处理契约。

#### Scenario: batch-verification-contract-C2-S01 批量验证配置兼容

- **WHEN** 执行批量验证配置兼容相关操作
- **THEN** 满足以下全部规则，任何未实现部分保持待实现状态：

对应 SPEC F006 和架构同版契约，基线 0.11.0。本节尚待用户确认及实现，不是当前可用设置。

- 配置不因批量测试增量升级（原稿基线 v3，现行主规格 v4），不新增持久字段；并发两个模型、默认文字＋工具＋已声明图片、单项 60 秒均为本次固定行为，不新增只可文件编辑的配置。timeoutSeconds 是验证 HTTP 请求的临时参数，批量固定传 60，单模型省略保持原行为；不会写入模型、AUTO 或 Provider 配置。
- 队列、筛选、本轮汇总仅保存在当前页面；关闭取消、刷新不续跑。verification.json 仍按 Provider＋模型＋项目保存最近一条，新增可选 timedOut 字段，旧记录缺失即 false，无需批量迁移或清理。重测只替换同项目，未重测历史项保留。
- 批量不临时提权图片、不应用探测建议、不写模型能力；运行锁定当前页面配置写入，其他未保存草稿保留，刷新证据不能把有效默认配置写成用户覆盖。
- 本次无失效配置字段或引用删除；旧 v1／v2／v3、未知键、停用偏好和旧图片原始值按已有契约保留，不借批量测试清理。运行验证需比较原始持久设置前后内容、旧证据读取和新字段重启读取；过期仅展示，不自动更新历史签名。
