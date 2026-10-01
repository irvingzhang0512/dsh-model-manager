# 验收清单

本文件保留原路径，跟踪当前 v3 改造的验收状态。`docs/REQUIREMENTS.md` 是原始需求，不随实现重写。

| 范围 | 自动验证 | 宿主／GUI 验收 |
| --- | --- | --- |
| v1/v2→v3 迁移、别名、逐模型档位 | `test/domain.test.ts`、`test/service.test.ts` | 旧配置实际升级待验收 |
| AUTO 评估、等级与候选约束 | `test/auto-router.test.ts`、`test/adapter.test.ts` | 专用会话每轮评估、工具循环、取消及并发待验收 |
| 原生 Subagent 范围与 fork 继承 | `test/host.test.ts`、`test/tools.test.ts` 检查接口边界 | 不同模型、后台任务与结果回收待验收 |
| DeepSeek 官方解析、字段预览与应用 | `test/official-sync.test.ts`、实时网页读取 | 预览、保存冲突与恢复待验收 |
| 视觉、验证、兜底与日志 | 现有 adapter、host、service 测试 | 页面布局、图片路由和日志待验收 |
| 客户端打包 | `npm run typecheck`、`npm run build`、`test/client-bundle.test.ts` | 浏览器冒烟待验收 |

只有完成对应插件验证后才能在根仓库清单填写 `verifiedWith`。web profile 安装快照必须由根仓库脚本更新，不能手工修改。

本轮本机 3080 端口仍由旧版 v2 宿主进程占用；尝试停止该进程时系统返回“Access is denied”，因此新版页面与专用会话尚未完成真实宿主验收。当前自动验证和官方网页实时读取已通过，`verifiedWith` 与安装快照暂不更新。
