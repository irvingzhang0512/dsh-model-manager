# 架构契约（v1）

本插件只注册 `dsh-model-manager` 模型路由，真实请求交给原 Provider。设置命名空间同名，`version: 1`。模型标识始终用 `{providerId, modelId}`；别名是有序具体模型数组，不嵌套。请求在准备时拷贝配置快照，保存变更只影响下一次请求。网络错误不能更改能力声明。

## 模块接口

- `src/domain.ts`：`ModelRef`、`ManagerConfig`、`ModelRecord`、`Verification`、`RequestSelection`；`resolveSelection(config, selection)` 返回候选数组，`mapEffort(model, tier)` 返回实际档位或抛错。
- `src/service.ts`：`HostModelBridge.catalog()` 返回模型记录数组；`ModelManagerService.snapshot()` 返回配置深拷贝；`update(next, revision)` 做版本检查；`saveVerification(result)` 保存验证证据；`log(event)` 追加脱敏事件。
- `src/provider-adapter.ts`：`ModelProviderAdapter` 描述实际可用控制项，将经理档位映射为宿主公开的 `reasoningEffort`；首版 `GenericModelProviderAdapter` 不猜测未声明档位。
- `src/adapter.ts`：`ManagedAdapter` 的 `listModels`、`resolveModel`、`stream` 委托 DSH LLM；只在请求流开始前决定候选和视觉策略。
- `src/index.ts`：注册设置、受管理模型路由、工具、HTTP 与事件监听。所有注册由 `ctx.effect` 清理。

## HTTP（按 path 唯一注册）

| path | methods | 请求 | 响应 |
|---|---|---|---|
| `/api/model-manager` | GET、PUT | PUT: `{revision, config}` | `{revision, config, models}`；冲突 409，非法配置 400 |
| `/api/model-manager/verify` | POST | `{providerId, modelId, kind}` | `{verification}`；无效模型 400 |
| `/api/model-manager/refresh` | POST | 无 | 最新宿主已加载模型目录与配置快照 |
| `/api/model-manager/native` | POST | `{providerId, modelId, image?, contextWindow?, maxTokens?, revision}` | `{revision}`；冲突 409 |
| `/api/model-manager/logs` | GET | 无 | `{events}` |
| `/api/model-manager/overrides` | GET、PUT | GET: `?sessionId=…`；PUT: `{sessionId, scope, selection?}` | `{session, nextTurn}` |

写操作只接受本机同源请求，拒绝 `Sec-Fetch-Site: cross-site`。不返回凭据。浏览器 bundle loader id 为 `dsh-model-manager`，在 `settings.section` 注册「模型管理」，在 `conversation.input.left` 显示管理入口状态。界面状态 `loading | ready | saving | error`。配置从 HTTP 读取并以 revision 提交；宿主对话仍经原 Session 输入通路。

## 配置字段

`version`、`aliases`、`models`、`mode`、`manual`、`auto`、`roles`、`vision`、`reliability`。`models` 中的能力覆盖只更改插件声明；原生能力修正另由宿主 `llm-pi-ai` 设置桥接精确保存。验证证据与日志独立于设置，存于 profile 隔离的数据目录。

## 验收边界

宿主能力以本机 DSH 0.1.5-rc.2 已公开的 `llm`、`settings`、`attachments`、`subagents` 服务为基准。未提供公开支持的 Provider 字段只读。任何尚未接入的功能必须在覆盖清单中明确写出，不能把架构规划视作已实现。
