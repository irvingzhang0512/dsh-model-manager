# 配置说明

设置命名空间为 `dsh-model-manager`，格式版本为 `version: 1`。模型统一使用 `{ providerId, modelId }`，两个 Provider 下同名模型互不共享配置。

| 字段 | 用途 |
|---|---|
| `aliases` | `@name` 到有序具体模型数组；别名不可嵌套 |
| `models` | 按模型键保存插件能力覆盖和 `fast/balanced/deep/max` 到宿主实际推理档位的映射 |
| `mode` | `manual` 或 `auto` |
| `manual`、`auto` | 主 Agent 的目标、思考设置、推理档位和本次请求输出上限 |
| `roles` | 子 Agent 角色的启用状态、目标、思考设置和推理档位 |
| `vision` | 启用状态、四种策略和视觉模型目标 |
| `reliability` | 最多三次尝试、临时失败重试、参数降级开关、上下文溢出专用候选 |

`target` 可为空、具体模型或 `@name`。推理档位 `auto` 使用模型默认；`inherit` 表示使用上层设置。思考 `off` 仅在模型公开实际 `off` 档位时可选，且不能与非关闭推理档位共存。宿主原生图片、上下文容量和模型最大输出通过 `llm-pi-ai` 设置桥接保存，和插件能力覆盖分开。证据、覆盖和日志保存在当前 DSH profile 的 `data/dsh-model-manager` 目录。

视觉工具的 `region` 参数使用归一化矩形 `x,y,width,height`，四个数均以原图宽高的 0–1 范围表示，例如 `0.25,0.25,0.5,0.5`。插件通过本地 `sharp` 裁剪并保存临时附件，原图仍保留在会话记录中。

当前宿主公开请求接口只提供 `reasoningEffort`，没有独立的 Thinking 开关。这里的“关闭思考”映射为宿主公开的实际 `off` 档位；插件不把 `auto` 解释成关闭，也不声称控制独立的思考参数。
