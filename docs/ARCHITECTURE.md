# 架构契约（v2）

本插件只注册 `dsh-model-manager` 模型路由，真实请求交给原 Provider。设置命名空间同名，`version: 2`（读取到 v1 配置时经 `migrateConfig` 自动迁移：别名数组包成 `AliasConfig`、长上下文候选转成内置别名 `@long-context`、丢弃 `mode`/`manual` 行）。模型标识始终用 `{providerId, modelId}`；别名 = 有序具体模型候选 + 可选别名级兜底覆盖，不嵌套。请求在准备时拷贝配置快照，保存变更只影响下一次请求。网络错误不能更改能力声明。

## 配置语义（v2）

- **没有 Manual/Auto 模式开关**：非 AUTO 的选择（具体模型或 @别名）就是固定模型，无需配置；只有选择器里的 AUTO 条目走托管——主对话按 `auto.main` 执行，任务按 `auto.roles` 委派给子 Agent。
- **别名即兜底**：`aliases[name] = { candidates, reliability? }`；候选按序尝试，`reliability` 可覆盖全局默认兜底策略的个别字段。`@long-context` 为内置保留别名，只在请求报「上下文溢出」时启用，等价于旧 `reliability.longContextCandidates`。
- **档位自动推断**：`models[key].tiers` 的每档取值为该模型支持的实际档位 id，缺省或 `auto` 表示按模型公开档位自动推断（fast→最弱、balanced→中间、deep→次强、max→最强，`inferTierMapping`）。

## 模块接口

- `src/domain.ts`：`ModelRef`、`ManagerConfig`（v2）、`AliasConfig`、`ModelRecord`、`Verification`、`LONG_CONTEXT_ALIAS`；`resolveSelection(config, selection)` 返回候选数组；`mapEffort(model, tier)` 显式映射优先、缺省自动推断；`migrateConfig(input)` 把 v1 配置迁移成 v2；`validateConfig` 校验 v2。
- `src/service.ts`：`HostModelBridge.catalog()` 返回模型记录数组；`ModelManagerService.snapshot()` 返回配置深拷贝（init/`onSettingsChanged` 均先迁移再校验）；`update(next, revision)` 做版本检查；`saveVerification(result)` 保存验证证据；`log(event)` 追加脱敏事件。写 `llm-pi-ai` 的统一入口是私有 `mutate(build, revision)`：首次按调用方 revision 做 CAS，只因冲突（`isSettingsConflict`：`code === 'SETTINGS_CONFLICT'`／`name === 'SettingsConflictError'`／消息含 `changed since it was read`）才改用最新 revision 重试（最多 3 次），其他错误立即上抛；每次尝试重新执行 `build()` 重读分节重建 ops，因此显式模型清单的整表替换不会用旧快照覆盖并发写入。判定按错误形状而非 `instanceof`：插件解析到的是自己那份 `@deepseek-ai/dsh-settings` 拷贝，与宿主抛出实例不同源。
- `src/provider-adapter.ts`：`ModelProviderAdapter` 描述实际可用控制项，将经理档位映射为宿主公开的 `reasoningEffort`；`GenericModelProviderAdapter` 不猜测未声明档位。
- `src/adapter.ts`：`ManagedAdapter` 的 `listModels`、`resolveModel`、`stream` 委托 DSH LLM；AUTO 条目按 `auto.main` 解析主模型（未配置回退宿主默认模型），别名条目不带全局参数基线；兜底策略按「全局默认 + 别名覆盖」解析；只在请求流开始前决定候选和视觉策略。
- `src/index.ts`：注册设置、受管理模型路由、工具、HTTP 与事件监听；`recommendAssignment` 用主模型（回退宿主默认模型）读模型目录产出 AUTO 分工草案。所有注册由 `ctx.effect` 清理。

## HTTP（按 path 唯一注册）

| path | methods | 请求 | 响应 |
|---|---|---|---|
| `/api/model-manager` | GET、PUT | PUT: `{revision, config}`（v2） | `{revision, config, models, verifications}`；冲突 409，非法配置 400 |
| `/api/model-manager/verify` | POST | `{providerId, modelId, kind}` | `{verification}`；无效模型 400 |
| `/api/model-manager/probe` | POST | `{providerId, modelId}` | `{verifications, suggestions, cancelled, elevated, restoreFailed, notes, nativeRevision}`；固定发一次真实图片探测；声明为「不支持」的模型先临时提权宿主 input 声明实测、测完恢复原值，提权失败跳过探测；建议只依据行为证据，网络错误与取消不产生建议；`nativeRevision` 是探测结束时的最新 `llm-pi-ai` revision，调用方必须用它发起后续宿主声明写入 |
| `/api/model-manager/refresh` | POST | 无 | 最新宿主已加载模型目录与配置快照 |
| `/api/model-manager/native` | POST | `{providerId, modelId, image?, contextWindow?, maxTokens?, revision}` | `{revision}`；冲突 409（按宿主 `SETTINGS_CONFLICT` 判定，并在桥接内先按最新 revision 自动重试） |
| `/api/model-manager/logs` | GET | 无 | `{events}` |
| `/api/model-manager/recommend` | POST | 无 | `{main?, roles?, notes}`：AI 推荐的 AUTO 分工草案（目标限定当前目录，目录外模型剔除并写入 notes）；未配置主模型且无宿主默认模型时 400 |
| `/api/model-manager/overrides` | GET、PUT | GET: `?sessionId=…`；PUT: `{sessionId, scope, selection?}` | `{session, nextTurn}` |

写操作只接受本机同源请求，拒绝 `Sec-Fetch-Site: cross-site`。不返回凭据。浏览器 bundle loader id 为 `dsh-model-manager`，只注册 `settings.section`「模型管理」；对话输入区不再挂控件。模型选择的唯一入口是宿主原生选择器：受管理 Provider 只列 `AUTO`（托管入口，按 `auto.main` 解析主模型）与 `@别名`，不重复列出原生模型——选择具体模型或 @别名就是固定模型，不经过本插件配置。界面状态 `loading | ready | saving | error`。配置从 HTTP 读取并以 revision 提交；宿主对话仍经原 Session 输入通路。

## 设置页结构（客户端）

五个页签：**模型**（按 Provider 分组、默认折叠、异常证据组自动展开，卡片内含验证/探测/原生编辑/插件声明，图片验证通过直接弹出声明写入建议）、**别名与兜底**（别名卡：候选顺序 + 别名级兜底覆盖 + 仅候选模型的档位映射；全局默认兜底策略卡）、**AUTO 分工**（主 Agent + 五个子 Agent 角色卡 + AI 推荐分工弹窗）、**视觉**、**日志**。旧「Manual/Auto」「可靠性」「验证」页签已并入上述结构。

## 配置字段（v2）

`version`、`aliases`（`Record<string, { candidates: ModelRef[]; reliability?: { maxAttempts?, retryTransient?, parameterDowngrade? } }>`）、`models`、`auto`（`{ main: Selection; roles: Record<Role, RoleSettings> }`，`Role = search|coding|review|strong|vision`）、`vision`、`reliability`（全局默认：`maxAttempts` 1–3、`retryTransient`、`parameterDowngrade`）。角色目标在使用时校验（未绑定的别名按「角色不可用」处理，不阻塞配置保存）。`models` 中的能力覆盖只更改插件声明；原生能力修正另由宿主 `llm-pi-ai` 设置桥接精确保存。验证证据与日志独立于设置，存于 profile 隔离的数据目录。

## 验收边界

宿主能力以本机 DSH 0.1.5-rc.2 已公开的 `llm`、`settings`、`attachments`、`subagents` 服务为基准。未提供公开支持的 Provider 字段只读。任何尚未接入的功能必须在覆盖清单中明确写出，不能把架构规划视作已实现。
