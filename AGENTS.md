# dsh-model-manager 维护约定

- 默认中文交流和维护文档。插件是独立 Git 仓库；修改前查看 `git status --short --branch`，保留已有改动。根仓库维护规范和 `.agents/skills/dsh-plugin-develop/SKILL.md` 仍适用。
- 入口：`src/index.ts` 装配宿主接口和 HTTP 路由；`src/domain.ts` 定义 v3 配置与迁移；`src/adapter.ts` 执行受管理调用；`src/auto-router.ts` 只评估主任务；`src/official-sync.ts` 解析官方网页；`src/client/` 是 Web 设置页。
- DSH 原生 Subagent 决定任务拆分、模型选择、后台运行与结果回收。插件不注册固定角色委派工具；`subagent_fork` 继承父模型。页面通过 `subagent-model-selection` 宿主设置读写模型范围，变更对新会话生效。
- 不恢复 `fast/balanced/deep` 新配置入口。用户新选择只写模型实际公开的 `reasoningEffort`；旧值仅用于迁移。v1/v2 升 v3 必须保留模型、别名、视觉、手动覆盖、旧主模型及逐候选档位，并保持迁移幂等。新 AUTO 未启用时不能增加评估调用。
- 官方同步只信任 `api-docs.deepseek.com` 的页面和 `llm-deepseek` 官方 Provider。先抓取并核对模型表、思考模式和更新日志，再生成字段级预览；冲突或证据不足不写。应用时检查 revision，备份原设置，保留凭据、输出上限和无关字段，允许恢复。第三方同名模型不迁移。
- 验证调用的证据与能力声明分开。网络错误或不确定结果不得自动写能力；图片临时提权必须恢复原声明。
- 修改后依次运行 `npm run typecheck`、`npm run build`、`npm test`，然后做客户端冒烟。安装到 web profile 并重启 DSH 后使用专用会话检查 AUTO、视觉和原生 Subagent；完成验证后再更新兼容性记录与安装快照。
- README、`docs/CONFIG.md`、`docs/ARCHITECTURE.md`、`docs/V1-COVERAGE.md` 和 `docs/CHANGELOG.md` 应与用户可见行为一致。`docs/REQUIREMENTS.md` 是原始需求，保持只读。
