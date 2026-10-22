# dsh-model-manager OpenSpec 迁移索引

迁移日期：2026-10-22。范围是开发需求与规格的文档整理；不修改原始需求、旧 docs、项目内容、examples、运行 Skill、源码、测试、配置或版本。README 与 AGENTS 只更新路由。

## 唯一规格源与使用规则

- 当前行为以本库 openspec/specs 为唯一可编辑规格；旧 docs/SPEC.md 原位冻结，其中“可编辑”及旧开发入口描述不再作为维护入口。
- 未实现或待确认设计在 openspec/changes，批准、实施与验证分别登记；本轮整理授权不等于批准业务开发。
- 旧 SPEC、原始需求及既有历史证据冻结保留；ARCHITECTURE、CONFIG、tools、usage 等当前技术与使用文档仅本轮保持字节不变。后续功能的契约变化先写 change/design，与规格一起审阅；实现后可同步当前技术／使用说明，保持引用一致，不改写原始需求或既有历史证据。个人项目资料不因开发需求整理而修改。
- 新功能：proposal/specs/design/tasks → 具体版本确认 → 实现与验证 → 同步主规格并归档。预期不变的 Bug 按现行规格修复。
- 使用维护仓库固定 OpenSpec 1.14.3 CLI 校验本库，不安装第二套开发依赖、不新增运行 Skill。

## 原文档分类

| 原文件 | 分类与处理 |
|---|---|
| [AGENTS.md](../AGENTS.md) | 开发／阅读入口；仅追加 OpenSpec 路由 |
| [README.md](../README.md) | 开发／阅读入口；仅追加 OpenSpec 路由 |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/CHANGELOG.md](../docs/CHANGELOG.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/CONFIG.md](../docs/CONFIG.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/DESKTOP-0.13-20261015.md](../docs/DESKTOP-0.13-20261015.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/DSH-UPGRADE-20261011.md](../docs/DSH-UPGRADE-20261011.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/DSH-UPGRADE-20261017.md](../docs/DSH-UPGRADE-20261017.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/REQUIREMENTS.md](../docs/REQUIREMENTS.md) | 原始需求，只读历史 |
| [docs/SPEC.md](../docs/SPEC.md) | 旧规格；原文冻结，编号已迁入下表 |
| [docs/V1-COVERAGE.md](../docs/V1-COVERAGE.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/VERIFICATION-0.13.0.md](../docs/VERIFICATION-0.13.0.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |
| [docs/VERIFICATION-OFFICE-20261018.md](../docs/VERIFICATION-OFFICE-20261018.md) | 本轮原位保留；当前技术／使用说明后续可随已确认实现同步，历史证据保持原记录 |

## 稳定编号、Requirement 与场景映射

每条 F 编号对应同名 Requirement；场景编号为 Fxxx-S01 起顺序，完整保留原行为、边界和验收段落。模型 Desktop 补充以 Fxxx-Desktop / Fxxx-Desktop-S01 承接完整最新契约；迁移不把旧测试结果改记为本轮运行通过。

| 编号 | 唯一编辑位置 | 场景与状态 |
|---|---|
| F001 模型目录与能力声明 | [规格](specs/model-catalog/spec.md) | F001-S01–S10；既有行为；验证按历史证据分层 |
| F002 别名候选与失败回退 | [规格](specs/alias-failover/spec.md) | F002-S01–S15；既有行为；验证按历史证据分层 |
| F003 AUTO 主模型评估 | [规格](specs/auto-routing/spec.md) | F003-S01–S07；既有行为；验证按历史证据分层 |
| F004 视觉原生与 Sidecar | [规格](specs/vision-assistance/spec.md) | F004-S01–S11；既有行为；验证按历史证据分层 |
| F005 DSH 原生 Subagent 设置 | [规格](specs/native-subagent-boundary/spec.md) | F005-S01–S06；既有行为；验证按历史证据分层 |
| F006 验证、探测与推荐草稿 | [待实现增量](changes/batch-model-verification/specs/batch-model-verification/spec.md)；[已有单模型行为](specs/model-verification/spec.md) | F006-S01–S06；待确认／未实现 |
| F007 官方同步预览与恢复 | [规格](specs/official-catalog-sync/spec.md) | F007-S01–S20；既有行为；验证按历史证据分层 |
| F008 配置迁移、覆盖与日志 | [规格](specs/manager-configuration/spec.md) | F008-S01–S08；既有行为；验证按历史证据分层 |
| F009 设置页面与 HTTP 接口 | [规格](specs/desktop-settings-transport/spec.md) | F009-S01–S19；既有行为；验证按历史证据分层 |
| F010 模型生命周期管理 | [规格](specs/model-lifecycle/spec.md) | F010-S01–S08；既有行为；验证按历史证据分层 |
| F011 用 LLM 补全与校正已有模型参数 | [规格](specs/model-parameter-analysis/spec.md) | F011-S01–S10；既有行为；验证按历史证据分层 |
| F012 移除插件图片声明，统一宿主原生图片能力 | [规格](specs/native-image-declaration/spec.md) | F012-S01–S05；既有行为；验证按历史证据分层 |
| F013 三来源接入与模型导入 | [规格](specs/model-source-import/spec.md) | F013-S01–S04；既有行为；验证按历史证据分层 |
| F014 插件列表与详情的显示名称 | [规格](specs/plugin-presentation/spec.md) | F014-S01–S05；既有行为；验证按历史证据分层 |
| F015 统一版本与固定交付 | [规格](specs/fixed-delivery/spec.md) | F015-S01–S05；既有行为；验证按历史证据分层 |

## 原始需求章节去向

原始需求中的样例、个人项目正文、图示与建议接口原位保留；下表逐组区分已承接、被替代、明确边界和历史候选，不宣称原需求全数实现。

| 原章节 | 内容 | 去向 | 状态与差异 |
|---|---|---|---|
| 1–3 | 项目定位、设置入口、解耦及导入边界 | F001/F009/F013 | 当前管理目标保留；3.3 不负责导入已被已确认 F013 三来源接入扩大，其他供应商适配未承诺全实现。 |
| 4、7 | 能力、能力来源与图片声明 | F001/F011/F012 | 复合主键与来源保留；旧插件 Image Overlay 被退役，统一原生图片声明；audio/video 仍为预留。 |
| 5 | Thinking 与推理档位 | F001/F008 与 F001-Desktop | Fast/Balanced/Deep 仅历史迁移；新选择用实际 reasoning.efforts，不恢复统一档位或推测强度。 |
| 6.1–6.5 | 验证类型与证据记录 | F006；batch-model-verification | 当前显式单模型验证与证据独立；未将全部 thinking/effort 组合的矩阵验证登记为已完成，须按实际 probe 契约审阅。批量文字/工具/声明图片仍待确认。 |
| 8–9 | Manual、会话与本轮覆盖 | F001/F008 | 保留直接具体模型与覆盖优先级；实际公开档位替代旧抽象输入。 |
| 10–16 | 角色分发、主模型、动态升级 | F003/F005 | 原五类固定角色设计已由 v3 与原生 Subagent 替代；AUTO 独立选主模型，不恢复插件角色委派或偏好提示。 |
| 17 | Alias 及候选 | F002 | 候选顺序、全部候选恢复、五次临时重试和冷却已由新契约具体化。 |
| 18–19 | 原生视觉、Sidecar、四策略 | F004/F012 | 保留并扩展自动摘要；能力声明和组合能力分开。 |
| 20–21 | 可靠性与上下文 | F002/F003/F004 | 旧认证跳平台、自动追加长上下文及静默参数降级不作为当前别名规则；原候选继续尝试且不越出用户池。 |
| 22–23 | 热更新与运行注册表 | F001/F008/F009 | 保留请求快照与下一请求采用新值；不将独立目录事务或普通宿主字段都说成即时生效。 |
| 24 | 界面分区与日志 | F009/F008；batch-model-verification | 当前六标签取代历史页面树；24.6 验证所有模型需求留在批量 change，其点击提示规则待该版确认。 |
| 25–26 | 配置文件与 Provider Adapter | F008/F001-Desktop | 保存实际所有者配置、版本迁移和健康文件；原建议六份文件与接口名称不是实现必须逐字一致的存储承诺。 |
| 27 | 不负责范围 | F005/F013 | 仍不替代 Provider/LLM/Agent/ArkCLI，不做下载、复杂 Benchmark 或自动训练 Router；凭据改由宿主独立保存，插件不保管 Key。 |
| 28 P0/P1 | 阶段优先级 | F001–F013 | 映射当前行为；固定角色与统一推理档位被替代，不能按阶段标题推断全部完成。 |
| 28 P2 | 未来统计、Benchmark、Hybrid Router | F002/F003/F006/F008 | 健康/冷却与 AUTO 已有；Token 日志不等于计费统计。成本统计、Benchmark、Hybrid Router 无现行验收定义，仅保留历史候选，未承诺实施。 |
| 29 Case1–6 | 核心验收案例 | F001/F002/F003/F005/F008/F012 | 刷新、原生图片、真实档位、手动覆盖和快照保留；Case5 的固定角色分发由原生路径替代，不重复实现。 |
| 30–31 | 架构对象与最终目标 | F001–F013 | 概念目标映射当前模型/别名/证据/原生子任务分工；保留原文，不将示例对象名当作新增接口。 |

## 历史验证与状态差异

- [原 SPEC](../docs/SPEC.md) 保留逐项实现依据、测试文件、历史批准与未验证项；[2026-10-17兼容记录](../docs/DSH-UPGRADE-20261017.md) 与 [2026-10-18交付验证](../docs/VERIFICATION-OFFICE-20261018.md) 分别记录实际通过范围。
- 本次只做文档结构、来源覆盖、链接、差异与保护散列检查，没有执行产品测试、真实模型调用、GUI、数据迁移、安装或重启；没有提高版本、提交或推送。
- F013 尾段保留“待实现”，与 SPEC 顶部及较新 [0.13.0验收](../docs/VERIFICATION-0.13.0.md) 的来源实现证据冲突；迁移采用已确认且有源码/验收记录的当前实现，保留原文不倒改历史。批量 F006 仍未实现，与单模型能力分开。
- 旧 F005 五页/插件子任务范围编辑、F009 Web页面、v3迁移目标及旧别名总次数限制由较新 Desktop 六页、原生子任务所有权、v4和逐候选恢复契约替代；F002 停用 preferences 不参与引用。
- 官方分析真实成功与应用恢复、三来源真实推理/SSO、参数补全外部服务等只按各日期证据判断；本次不扩充兼容结论。

### 未定事项入口

- 原 SPEC 的“差异与验证待办”原样留存；其中历史状态必须结合上面的较新证据，不重复建立已完成任务。
- 原 SPEC 的“规格变更记录”原样留存；其中历史状态必须结合上面的较新证据，不重复建立已完成任务。
- 未定义完整验收的历史候选不默认批准；实施时先补齐可审核场景，确认后再动代码。

## 本轮文档验证

- 使用固定 OpenSpec 1.14.3 执行 validate --all --strict --no-interactive：16 项通过、零失败；git diff --check 通过。
- 与本轮开始前逐文件 SHA-256 比较：144 个原文件字节不变；只修改 AGENTS/README 路由文件并新增 openspec 文档。已有未提交文档差异保持。
- 新 OpenSpec Markdown 本地链接及锚点检查通过；未完成业务任务全部未勾选，没有产品测试、安装、迁移、提交或推送。
