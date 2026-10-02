# dsh-model-manager 当前功能规格

基线日期：2026-10-03；包版本：0.3.0；核对的源码提交：`fc50b6e260cebb52542afde93a5d34f58073ba58`。此提交是首次整理前的实现基线，后续文档提交不提高包版本。

本规格可编辑，功能任务先改预期与验收再实现；Bug 按已有预期直接定位源码。流程见 [根文档驱动开发规范](../../docs/DOC-DRIVEN-DEVELOPMENT.md)。原始需求保持只读，技术文档保留现有名称。

依据与技术入口：[REQUIREMENTS.md](REQUIREMENTS.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[CONFIG.md](CONFIG.md)、[V1-COVERAGE.md](V1-COVERAGE.md)。

实现状态与验证状态分别记录。“已实现”表示有当前源码依据，不表示本次已通过运行测试。下面的测试链接是核对过的现有验证入口；2026-10-03 本次只静态核对源码、测试与文档，没有运行产品测试、构建、GUI 或外部服务验证。具体遗漏见条目与末尾待办。

## F001 模型目录与能力声明

- 实现状态：已实现。
- 场景与预期：按 Provider＋Model 识别模型，呈现宿主目录、能力声明、手动覆盖与验证证据；逻辑入口和具体实际模型可追溯。
- 边界与异常：能力声明与实测证据分开；网络错误不能自动否定／肯定能力；同名不同 Provider 不合并。
- 验收条件：复合标识唯一；覆盖不损坏原模型未知字段；声明和验证结果分别显示。
- 实现依据：[../src/domain.ts](../src/domain.ts)、[../src/service.ts](../src/service.ts)、[../src/provider-adapter.ts](../src/provider-adapter.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/domain.test.ts](../test/domain.test.ts)、[../test/service.test.ts](../test/service.test.ts)（覆盖范围以用例为准，本次未执行）。

## F002 别名候选与失败回退

- 实现状态：已实现。
- 场景与预期：受管理别名按候选顺序选择具体模型；候选保存实际 reasoningEffort，调用快照固定配置并限制重试／总尝试次数。
- 边界与异常：部分文本／工具输出后不重新执行整次请求；失败分类决定是否尝试下一候选，设置变化不改正在执行的快照。
- 验收条件：可回退错误进入下一候选；不可回退及部分输出停止重试；调用期间改设置不影响快照。
- 实现依据：[../src/adapter.ts](../src/adapter.ts)、[../src/provider-adapter.ts](../src/provider-adapter.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/adapter.test.ts](../test/adapter.test.ts)（覆盖范围以用例为准，本次未执行）。

## F003 AUTO 主模型评估

- 实现状态：已实现。
- 场景与预期：启用 AUTO 后对主任务按 simple／normal／complex 评估，结合上下文与能力选择模型档位；每轮复用评估结果。
- 边界与异常：评估输入受限且不带图片内容，超时／失败回退正常路径；内部评估与子任务不递归触发；未启用不增加评估调用。
- 验收条件：工具循环不重复评估；所需能力不匹配时升级候选或明确失败；评估异常不阻塞正常请求。
- 实现依据：[../src/auto-router.ts](../src/auto-router.ts)、[../src/index.ts](../src/index.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/auto-router.test.ts](../test/auto-router.test.ts)、[../test/host.test.ts](../test/host.test.ts)（覆盖范围以用例为准，本次未执行）。

## F004 视觉原生与 Sidecar

- 实现状态：已实现。
- 场景与预期：配置 NativeFirst／SidecarFirst 策略处理图片附件；model_manager_inspect_image 提供图像检查、裁剪等受控辅助。
- 边界与异常：保留附件引用，检查失败不作为成功缓存；视觉路径不等于原生 Subagent，也不添加旧固定角色委派工具。
- 验收条件：原生与 Sidecar 顺序符合策略；图像结果可关联来源；检查失败可重试且不返回旧成功。
- 实现依据：[../src/adapter.ts](../src/adapter.ts)、[../src/tools.ts](../src/tools.ts)、[../src/probe-image.ts](../src/probe-image.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/adapter.test.ts](../test/adapter.test.ts)、[../test/tools.test.ts](../test/tools.test.ts)（覆盖范围以用例为准，本次未执行）。

## F005 DSH 原生 Subagent 设置

- 实现状态：已实现。
- 场景与预期：页面读取／保存宿主 subagent-model-selection 模型范围；任务拆分、后台运行与回收由 DSH 原生服务负责。
- 边界与异常：subagent_fork 继承父模型；插件偏好不是保证强制分配；宿主设置变化对新会话生效；AUTO 是独立路径。
- 验收条件：宿主设置保存与插件草稿分别处理；新会话读到范围；不注册固定角色委派工具。
- 实现依据：[../src/index.ts](../src/index.ts)、[../src/client/index.tsx](../src/client/index.tsx)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/official-host.test.ts](../test/official-host.test.ts)、[../test/tools.test.ts](../test/tools.test.ts)（覆盖范围以用例为准，本次未执行）。

## F006 验证、探测与推荐草稿

- 实现状态：已实现。
- 场景与预期：用户显式触发模型验证／图片能力探测，并保存结果证据；推荐功能调用独立模型生成可编辑的三档草稿。
- 边界与异常：真实调用会用外部服务，本次不运行；图片临时声明应恢复；不确定失败不改能力；推荐不自动保存设置。
- 验收条件：中止／失败能恢复临时状态；探测证据与声明分开；推荐草稿需用户保存才写入。
- 实现依据：[../src/probe-image.ts](../src/probe-image.ts)、[../src/recommend-auto.ts](../src/recommend-auto.ts)、[../src/index.ts](../src/index.ts)、[../src/client/auto-tabs.tsx](../src/client/auto-tabs.tsx)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/host.test.ts](../test/host.test.ts)、[../test/client-bundle.test.ts](../test/client-bundle.test.ts)（覆盖范围以用例为准，本次未执行）。

## F007 官方同步预览与恢复

- 实现状态：已实现。
- 场景与预期：仅对可信 DeepSeek 官方页面和 llm-deepseek Provider生成字段预览，按 revision 应用并备份，允许恢复原设置。
- 边界与异常：不迁移第三方同名模型；冲突／证据不足不写；保留凭据、输出上限与无关字段。
- 验收条件：不可信 URL 拒绝；旧 revision 报冲突；应用只变预览字段；备份可恢复。
- 实现依据：[../src/official-sync.ts](../src/official-sync.ts)、[../src/index.ts](../src/index.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/official-sync.test.ts](../test/official-sync.test.ts)、[../test/official-host.test.ts](../test/official-host.test.ts)（覆盖范围以用例为准，本次未执行）。

## F008 配置迁移、覆盖与日志

- 实现状态：已实现。
- 场景与预期：v1/v2 迁移至 v3 保留模型、别名、视觉、旧主模型、候选档位与手动覆盖；记录实际选择和调用日志。
- 边界与异常：迁移幂等；fast／balanced／deep 仅为旧值迁移，不恢复为新配置入口；reasoningEffort 必须是模型公开值。
- 验收条件：重复迁移不丢配置；旧档位映射后具体候选保留；新 AUTO 默认不带来额外评估。
- 实现依据：[../src/domain.ts](../src/domain.ts)、[../src/service.ts](../src/service.ts)、[../src/index.ts](../src/index.ts)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/domain.test.ts](../test/domain.test.ts)、[../test/service.test.ts](../test/service.test.ts)（覆盖范围以用例为准，本次未执行）。

## F009 设置页面与 HTTP 接口

- 实现状态：已实现。
- 场景与预期：Web 设置页以六个标签管理模型与策略；HTTP 接口提供配置、刷新、探测、推荐、官方同步及日志等操作。
- 边界与异常：同 path 只注册一次；插件草稿与宿主字段保存隔离；revision 冲突返回 409；高成本操作须显式发起。
- 验收条件：页面保存后获得完整状态；宿主设置刷新不丢插件草稿；路由唯一；冲突不覆盖新设置。
- 实现依据：[../src/index.ts](../src/index.ts)、[../src/client/index.tsx](../src/client/index.tsx)、[../src/client/auto-tabs.tsx](../src/client/auto-tabs.tsx)。
- 验证记录：2026-10-03 静态核对；已有测试入口：[../test/host.test.ts](../test/host.test.ts)、[../test/client-bundle.test.ts](../test/client-bundle.test.ts)（覆盖范围以用例为准，本次未执行）。

## 差异与验证待办

- 原始需求的五种固定角色设计已被 v3 架构与现行 AGENTS 明确替代，不将其登记为当前待补能力，也不改历史 REQUIREMENTS。
- V1-COVERAGE 中旧端口／旧组合的验证记录是历史证据；本次未发真实模型、探测或官方网络请求，未验证实际 AUTO／视觉／Subagent 兼容。

## 规格变更记录

- 2026-10-03：首次从现行文档、实现和现有测试建立功能基线；仅修改维护文档，未变更 API、存储或运行逻辑。
