# dsh-model-manager 维护约定

## 开发入口与文档分工

先返回根维护目录，读取 [根 AGENTS](../AGENTS.md)、[维护规范](../docs/MAINTENANCE.md) 和开发 Skill；本仓库的特殊约束仍适用。统一流程见 [文档驱动开发](../docs/DOC-DRIVEN-DEVELOPMENT.md)，当前可编辑规格见 [docs/SPEC.md](docs/SPEC.md)。

- 功能新增／修改：读取规格及其差异，先改预期和验收条件，涉及接口／配置／存储时先同步技术契约；用户确认该版文档后再改源码并验证。自然语言需求也先落入规格。
- 文档确认：将修改后的规格／相关技术契约的链接、功能编号、行为差异与验收条件交用户审阅，等待明确确认该版文档后才能改对应源码／测试实现或运行配置；确认前可读源码、查日志／已有测试、完善文档。用户已明确要求按同一版文档实现且含义未再改变时直接继续，不重复询问；仅提出需求、保存／提交文档或沉默不算确认。确认后新增语义差异先重新确认，记录确认范围与文档依据。
- Bug：按已有预期复现并直接查看源码、日志和测试，修复回归；预期未变无需改规格，遗漏／歧义补规格，产品规则变化部分按功能流程。不得改规格把 Bug 解释为正确行为。
- 原始需求保持只读历史来源；实现状态和验证结果分开记录，冲突保留证据并标待确认。README 是入口，架构／配置／接口文档维护技术契约。
- 纯文档任务检查编号、状态、链接与源码／测试引用，记录未执行的验证；无需运行下面的代码测试／构建或重装。代码改动仍遵循本仓库验证要求。
- 纯文档变更不提高包版本，独立中文 Angular docs 提交，保持当前实际分支；根仓库同步完整提交锁。安装快照由脚本检查，未变保留，不自动推送。


- 默认中文交流和维护文档。插件是独立 Git 仓库；修改前查看 `git status --short --branch`，保留已有改动。根仓库维护规范和 `.agents/skills/dsh-plugin-develop/SKILL.md` 仍适用。
- 入口：`src/index.ts` 装配宿主接口和 HTTP 路由；`src/domain.ts` 定义 v3 配置与迁移；`src/adapter.ts` 执行受管理调用；`src/auto-router.ts` 只评估主任务；`src/official-sync.ts` 解析官方网页；`src/client/` 是 Web 设置页。
- DSH 原生 Subagent 决定任务拆分、模型选择、后台运行与结果回收。插件不注册固定角色委派工具；`subagent_fork` 继承父模型。页面通过 `subagent-model-selection` 宿主设置读写模型范围，变更对新会话生效。
- 不恢复 `fast/balanced/deep` 新配置入口。用户新选择只写模型实际公开的 `reasoningEffort`；旧值仅用于迁移。v1/v2 升 v3 必须保留模型、别名、视觉、手动覆盖、旧主模型及逐候选档位，并保持迁移幂等。新 AUTO 未启用时不能增加评估调用。
- 官方同步只信任 `api-docs.deepseek.com` 的页面和 `llm-deepseek` 官方 Provider。先抓取并核对模型表、思考模式和更新日志，再生成字段级预览；冲突或证据不足不写。应用时检查 revision，备份原设置，保留凭据、输出上限和无关字段，允许恢复。第三方同名模型不迁移。
- 验证调用的证据与能力声明分开。网络错误或不确定结果不得自动写能力；图片临时提权必须恢复原声明。
- 代码修改后依次运行 `npm run typecheck`、`npm run build`、`npm test`，然后做客户端冒烟。安装到 web profile 并重启 DSH 后使用专用会话检查 AUTO、视觉和原生 Subagent；完成验证后再更新兼容性记录与安装快照。
- README、`docs/CONFIG.md`、`docs/ARCHITECTURE.md`、`docs/V1-COVERAGE.md` 和 `docs/CHANGELOG.md` 应与用户可见行为一致。`docs/REQUIREMENTS.md` 是原始需求，保持只读。
