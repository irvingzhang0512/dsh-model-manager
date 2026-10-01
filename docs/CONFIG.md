# 配置说明（v3）

`dsh-model-manager` 设置保存在 DSH 的同名设置分节。模型键由 Provider ID 和模型 ID 组成，避免不同 Provider 的同名模型冲突。

| 字段 | 用途 |
| --- | --- |
| `aliases` | 有序候选和别名级兜底策略；`efforts` 按候选模型键保存实际推理档位 |
| `models` | 用户能力覆盖和旧配置迁移映射；新选择用实际 `reasoningEffort` |
| `auto` | `enabled`、`evaluator`、`simple`、`normal`、`complex` 及可选的 `preferences` |
| `vision` | 是否启用、原生／辅助优先策略和辅助模型 |
| `reliability` | 请求重试、参数降级和最大尝试次数 |
| `official` | 最近一次官方资料抓取时间与来源链接 |

执行档 `Selection` 可用 `target` 指向具体 `{providerId, modelId}` 或 `@别名`，并可配置 `reasoningEffort`、`maxOutputTokens`。推理档位留空即模型默认；关闭思考只在模型声明 `off` 时可选。`simple/normal/complex` 是任务分类，和模型档位无映射关系。评估器独立配置，不能引用 AUTO。

旧 v1/v2 读取时迁移到 v3。旧别名数组转为候选对象，长上下文候选转为 `@long-context`；旧 `auto.main` 保留为固定入口，并初始化常规／复杂执行档；旧角色模型转成可选分工偏好。旧 `fast/balanced/deep` 按每个模型的原值保存在 `legacyTiers`，避免不同旧档位折叠后丢失。新 AUTO 默认关闭，启用前不会增加评估调用。迁移可重复执行。

原生子 Agent 模型范围不在此分节，页面读写 DSH 的 `subagent-model-selection`。其修改对新会话生效。

DeepSeek 官方同步的预览和应用分别使用 `/api/model-manager/official-preview` 与 `/official-apply`，恢复使用 `/official-restore`。仅抓取官方文档域名并修改 `llm-deepseek` 的显式模型清单；第三方 Provider 不参与。应用前检查宿主 revision 并备份模型清单和插件配置。
