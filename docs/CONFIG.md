# 配置说明

设置命名空间为 `dsh-model-manager`，格式版本为 `version: 2`。读取到 v1 配置时自动迁移（别名数组包成候选对象、长上下文候选转成内置别名 `@long-context`、丢弃 `mode`/`manual`）。模型统一使用 `{ providerId, modelId }`，两个 Provider 下同名模型互不共享配置。

| 字段 | 用途 |
|---|---|
| `aliases` | `@name` → `{ candidates: 有序具体模型数组; reliability?: 别名级兜底覆盖 }`；别名不可嵌套；候选顺序即兜底顺序 |
| `models` | 按模型键保存插件能力覆盖和 `fast/balanced/deep/max` 档位映射；映射值缺省或为 `auto` 时按模型公开档位自动推断（fast→最弱、balanced→中间、deep→次强、max→最强） |
| `auto` | 托管（AUTO）配置：`main` 为主 Agent 的目标、思考设置、推理档位和输出上限；`roles` 为 search/coding/review/strong/vision 五个角色的绑定 |
| `vision` | 启用状态、四种策略（`native-first` 原生优先 / `sidecar-first` 看图工具优先 / `native-only` 仅原生直读 / `sidecar-only` 仅看图工具）和视觉模型目标 |
| `reliability` | 全局默认兜底策略：最多三次尝试、临时失败重试、参数降级开关；别名可用 `reliability` 覆盖个别字段 |

v2 不再有 `mode`/`manual`：选择具体模型或 @别名就是固定模型，无需配置；只有选择器里的 AUTO 条目走托管（`auto.main` + `auto.roles`）。`@long-context` 是内置保留别名，只在请求报「上下文溢出」时启用。

`target` 可为空、具体模型或 `@name`（AUTO 主模型留空 = 回退宿主默认模型）。推理档位 `auto` 使用模型默认；`inherit` 表示使用上层设置。思考 `off` 仅在模型公开实际 `off` 档位时可选，且不能与非关闭推理档位共存。宿主原生图片、上下文容量和模型最大输出通过 `llm-pi-ai` 设置桥接保存，和插件能力覆盖分开。证据、覆盖和日志保存在当前 DSH profile 的 `data/dsh-model-manager` 目录。

视觉工具的 `region` 参数使用归一化矩形 `x,y,width,height`，四个数均以原图宽高的 0–1 范围表示，例如 `0.25,0.25,0.5,0.5`。插件通过本地 `sharp` 裁剪并保存临时附件，原图仍保留在会话记录中。

当前宿主公开请求接口只提供 `reasoningEffort`，没有独立的 Thinking 开关。这里的“关闭思考”映射为宿主公开的实际 `off` 档位；插件不把 `auto` 解释成关闭，也不声称控制独立的思考参数。

`POST /api/model-manager/recommend` 用 AUTO 主模型（未配置时回退宿主默认模型）读当前模型目录，返回 AUTO 分工草案 `{ main?, roles?, notes }`；草案只引用目录内模型（目录外的剔除并写入 `notes`），前端在弹窗中确认后才写入表单，仍需「保存设置」落盘。
