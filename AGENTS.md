# dsh-model-manager 维护约定

> OpenSpec 文档入口：[迁移索引](openspec/MIGRATION.md)。后续开发与管理统一使用 `openspec/specs` 和 `openspec/changes`；旧 `docs/SPEC.md` 与原始需求冻结保留，个人项目资料本轮保持原样，旧文中的“可编辑规格”入口由此替代。新功能先审阅具体方案并确认，再实施与验证；历史资料不双写。

## 开发入口与文档分工

先返回根维护目录，读取 [根 AGENTS](../AGENTS.md)、[维护规范](../docs/MAINTENANCE.md) 和开发 Skill；本仓库的特殊约束仍适用。统一流程见 [文档驱动开发](../docs/DOC-DRIVEN-DEVELOPMENT.md)，当前可编辑规格与待确认方案见 [OpenSpec 迁移索引](openspec/MIGRATION.md)。

- 功能新增／修改：读取规格及其差异，先改预期和验收条件，涉及接口／配置／存储时先同步技术契约；用户确认该版文档后再改源码并验证。自然语言需求也先落入规格。
- Desktop 0.13.0 已确认实施版为 [model-manager-desktop-20261015-v1](docs/DESKTOP-0.13-20261015.md)，与 SPEC／架构／配置及升级接缝共同审阅；用户于 2026-10-15 在该版文档交付后回复“继续实现”，据此开发 0.13.0／v4；实际验收独立记录，同版不重复询问。
- 文档确认：将修改后的规格／相关技术契约的链接、功能编号、行为差异与验收条件交用户审阅，等待明确确认该版文档后才能改对应源码／测试实现或运行配置；确认前可读源码、查日志／已有测试、完善文档。用户已明确要求按同一版文档实现且含义未再改变时直接继续，不重复询问；仅提出需求、保存／提交文档或沉默不算确认。确认后新增语义差异先重新确认，记录确认范围与文档依据。
- Bug：按已有预期复现并直接查看源码、日志和测试，修复回归；预期未变无需改规格，遗漏／歧义补规格，产品规则变化部分按功能流程。不得改规格把 Bug 解释为正确行为。
- 原始需求保持只读历史来源；实现状态和验证结果分开记录，冲突保留证据并标待确认。README 是入口，架构／配置／接口文档维护技术契约。
- 纯文档任务检查编号、状态、链接与源码／测试引用，记录未执行的验证；无需运行下面的代码测试／构建或重装。代码改动仍遵循本仓库验证要求。
- 纯文档变更不提高包版本，独立中文 Angular docs 提交，保持当前实际分支；根仓库同步完整提交锁。安装快照由脚本检查，未变保留，不自动推送。


- 默认中文交流和维护文档。插件是独立 Git 仓库；修改前查看 `git status --short --branch`，保留已有改动。根仓库维护规范和 `.agents/skills/dsh-plugin-develop/SKILL.md` 仍适用。
- 入口：`src/index.ts` 装配宿主接口和 HTTP 路由；`src/domain.ts` 定义 v4 配置与迁移；`src/adapter.ts` 执行受管理调用；`src/auto-router.ts` 只评估主任务；`src/official-sync.ts` 解析官方网页；`src/catalog-state.ts`／`catalog-types.ts` 规划目录操作与引用选择；`src/official-host.ts` 共用官方与手动事务；`src/client/` 是 Desktop 原生插件配置页。
- DSH 原生 Subagent 决定任务拆分、模型选择、后台运行与结果回收。插件不注册固定角色委派工具；`subagent_fork` 继承父模型。模型范围统一在 DSH 官方设置配置，插件不注册 /subagents 路由或依赖 subagents 服务；目录事务仍检查并处理原生范围引用。旧 auto.preferences 只读停用，不生成或注入提示；clearLegacyPreferences 独立操作仅 unset 该字段，备份恢复保留原始值及存在状态，不删除 main／roles 或视觉兜底。
- 不恢复 `fast/balanced/deep` 新配置入口。用户新选择只写模型实际公开的 `reasoningEffort`；旧值仅用于迁移。v1/v2/v3 升 v4 必须保留模型、别名、视觉、手动覆盖、旧主模型及逐候选档位，并保持迁移幂等。新 AUTO 未启用时不能增加评估调用。
- 官方同步按已确认 F007／F009 契约：从可配置 HTTPS 入口读取，实际链接和重定向限制入口 hostname；独立 LLM 根据原文证据识别动态清单，最多六页三轮，网页指令只作资料。完整性不足或冲突不提供可应用预览。仅迁移官方 Provider 的完整引用与模型键；应用检查 revision 和未来覆盖，备份完整写集，安全回滚／恢复，保留凭据、输出上限和未知字段。第三方同名模型不迁移。
- 智能补全按已确认 F011／F012：model-parameters／parameter-analysis／parameter-catalog 独立搜索与字段校验，parameter-panel 提供选择，复用 catalog 事务；新增协议或字段前核对宿主公开契约。模型图片能力只用 nativeImage，旧 capability.image 只留原始层供独立清理／恢复，普通保存保留未知嵌套键。模型最大输出默认不选，建议与真实调用证据分开。
- 验证调用的证据与能力声明分开。网络错误或不确定结果不得自动写能力；图片临时提权必须恢复原声明。
- 别名恢复按已确认 alias-failover-20261010-v1／F002：alias-runtime 执行全部去重候选，临时故障每候选五次，其他错误立即切换；无 HTTP 状态的结构化 RATE_LIMIT／QUOTA 也必须切换。失败输出完整丢弃，成功终态后才提交，暂存上限 32 MiB；停止及时取消，不重跑历史已完成工具。直接别名、AUTO／覆盖／视觉别名同规则，具体模型旧策略保留。legacy-alias 只读取原始三键供 clearLegacyAliasReliability 独立目录事务清理／恢复，未知键保留，恢复不复活功能。
- 生命周期按 F010：API ID 与显示名称分离，手动目录只操作宿主公开可写 Provider。普通引用允许用户明确跨 Provider 替换，图片引用单独检查原生图片声明；官方自动目标仍限官方 Provider。图片辅助的存在不阻止删除无关模型，附属设置可明确清理。预览、冲突选择、应用与恢复共用完整写集及版本检查，不能清空无关插件草稿或把 effective 默认层写成用户层；跨重启 revision 不匹配时保守拒绝恢复。
- 代码修改后依次运行 `npm run typecheck`、`npm run build`、`npm test`，然后做客户端冒烟。当前目标使用实际 Desktop 的隔离 carrier／原生窗口验证 AUTO、视觉和原生子任务；完成必要检查与固定提交后按根运行维护 Skill 交付日常 Desktop。旧 Web 仅为历史组合，未经用户重新要求不得恢复；真实服务与合成验证分别记录，完成对应验收后才更新兼容性及实际快照。
- 别名删除按 F002／F004／F009：alias-removal 规划逻辑入口及其全部使用引用，接入相同 catalog 事务；不能把逻辑别名当真实目录模型删除。旧主模型仍有运行语义，清理须用户明确选择；旧视觉兜底不影响无关当前视觉模型，关闭后的目标与失效值在页面仍须可见。
- README、`docs/CONFIG.md`、`docs/ARCHITECTURE.md`、`docs/V1-COVERAGE.md` 和 `docs/CHANGELOG.md` 应与用户可见行为一致。`docs/REQUIREMENTS.md` 是原始需求，保持只读。
