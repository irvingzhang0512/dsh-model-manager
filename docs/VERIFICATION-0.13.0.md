# 0.13.0 Desktop 验收记录

2026-10-15。用户确认 `model-manager-desktop-20261015-v1` 后实现，配置 v4；目标为安装包内 DSH Desktop 0.2.0-rc.2、Cordis 4.0.4、Schemastery 3.18.4，运行依赖 sharp 0.35.5。只记录实际执行范围，未验证整套其他插件组合。

## 本地检查

- `npm run typecheck`、`npm run build`、`npm test`；368 项测试，包含构建后的客户端加载／槽位冒烟。
- 原生配置桥覆盖实际 owner ID、实时表单、普通编辑、原始／继承层 CAS、未知键、非法路径及可信来源。来源覆盖 Key 独立保存、取消、导入不覆盖、最大输出默认不选、来源连接与模型事务恢复、并发改动拒绝及指定 Ark Profile。
- 别名覆盖五次临时重试、结构化限流／额度、持久读回、损坏恢复、过期租约、并发恢复、手动重置后迟到失败、配置失效和稳定跨重启签名。推理交集、原生 replay、完整上下文与视觉 token、评估硬超时／主动取消、规则和冷却可用性单独回归。
- v1–v4 幂等迁移，未知字段、旧主／视觉及逐候选档位保留；已退役字段继续独立清理／备份恢复，不在升级时删除。

## 实际 Desktop 宿主

使用安装包 Electron Node carrier、精确同版 peers、独立 DSH_HOME／DSH_DATA_DIR 和 Profile。`test/desktop-carrier.mjs` 注册模拟推理 Provider，并阻止所有外部模型调用；它验证真实宿主接口与工具循环，不代表供应商兼容通过。

已通过原生 Credentials 独立标记值的保存／解析／移除、AUTO 每轮一次评估、主候选限流后固定备用、用户和工具图片进入带实际来源的 notice、工具只执行一次、历史追问、冷却、手动恢复不探测、fork 使用父任务实际备用、原生 Subagent 隔离、原生视觉不增加辅助调用及停止丢弃半段输出。

宿主会额外发出标题等 purpose 请求，测试将它们与主轮次分开统计；不把标题调用误记为 AUTO 重复评估。开发中修正了将临时 nativeRevision 纳入持久冷却签名的问题，重启后的签名现已稳定。

## 原生页面

可见 Electron 原生窗口 1280×820，六个标签页均渲染并读到配置 v4／实际模型目录。通过实际键盘输入编辑冷却与独立来源高级草稿，目录刷新和跨页后保留；点击“保存设置”读回 90 秒，再恢复隔离原始配置。780 像素宽、暗色媒体条件下无横向溢出，Tab 能进入按钮。

原生初检发现直接对 streamBaseUrl 回环 HTTP fetch 会被浏览器阻拦；修正为 `dsh-app://app` 官方认证转发，普通请求与事件流共用正确传输。替换客户端文件后采用完整宿主重启重新检查，避免已注册资源元数据与文件不一致造成导入失败。来源与 AUTO 临时草稿保持独立，未写入任何真实 Key。

本机私有证据位于维护工作区 `.local/desktop-model-manager-013/reports/`，包含 carrier JSON、native-six-tabs-final.json、native-save-drafts-final.json 与 native-sources-final.png；测试配置、原始日志与截图不作为公共资料提交。

## 外部服务与交付边界

DeepSeek 官方、火山 Agent Plan 和 OpenCode Go 的真实推理／账户目录查询／官方授权本次未执行，避免把模拟结果或目录资料当作真实兼容。OpenCode Go 0.1.22 的实际日常配置读取与原生导航在日常交付时另记；隔离窗口未安装该插件，已验证缺失时给出原因且不阻止管理器。

本版不包含未确认的批量能力验证，也不修改旧 Web 固定组合，不自动推送或公开发布。固定 Git 安装、日常冷备份及重开检查将在完成后追加精确提交与结果；尚未完成前不登记已安装。

### 日常规模下的读取修正

日常原生详情实际读到 50 个来源模型。初版误用 SDK 标识 opencode-go，已按实际宿主 Provider dsh-opencode-go 修正目录和凭据代次判定，并加入真实标识回归。账号与用量仍由原插件维护。

日常多插件配置暴露重复配置重算的性能问题。独立同版宿主 CPU 采样定位到 DesktopSettings.row／descriptor 反复调用 ConfigEditor.configuration，进而重复 composeEntries／structuredClone。修正为一次同步读取共用同一配置层快照、微任务边界失效；目录一次捕获配置层，不按模型重复查询。写前强制重新读取，并继续在真实编辑锁内及原生表单 revision 检查并发。50 模型查询次数和同一时刻外部修改拒绝均有回归，未引入跨请求 TTL 缓存。
