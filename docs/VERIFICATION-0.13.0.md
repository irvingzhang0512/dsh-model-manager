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

三家来源的真实推理、火山账户资源目录与 SSO 授权本次未执行。DeepSeek 官方真实 /models 预览通过，返回 2 个模型；随即取消，配置与 revision 未变。OpenCode Go 0.1.22 的实际目录与原生导航通过，保留账号／用量所有权。最初隔离窗口未安装 Go 时也验证了缺失提示；后续固定安装环境加入同版 Go，并只用合成凭据启用其目录，推理继续全部隔离模拟。

本版不包含未确认的批量能力验证，也不修改旧 Web 固定组合，不自动推送或公开发布。固定 Git 安装、日常冷备份及重开已完成，精确提交与范围见下节。

### 日常规模下的读取修正

日常原生详情实际读到 50 个来源模型。初版误用 SDK 标识 opencode-go，已按实际宿主 Provider dsh-opencode-go 修正目录和凭据代次判定，并加入真实标识回归。账号与用量仍由原插件维护。

日常多插件配置暴露重复配置重算的性能问题。独立同版宿主 CPU 采样定位到 DesktopSettings.row／descriptor 反复调用 ConfigEditor.configuration，进而重复 composeEntries／structuredClone。修正为一次同步读取共用同一配置层快照、微任务边界失效；目录一次捕获配置层，不按模型重复查询。写前强制重新读取，并继续在真实编辑锁内及原生表单 revision 检查并发。50 模型查询次数和同一时刻外部修改拒绝均有回归，未引入跨请求 TTL 缓存。

## 固定安装与日常交付

- 最终运行提交：`997553a1a5b3582fe590bf46e3e02447caa37fc1`，包 0.13.0。安装来源为本机 Git 完整 SHA；没有源码 junction、安装时构建或版本豁免。隔离及日常均逐项比较 58 个运行／类型／patch 文件与固定提交。后续纯验收文档提交不改变该运行产物。
- 独立固定环境实际加载同版宿主和 Go 0.1.22，以合成推理验证 11 项宿主检查；最终证据 carrier-1792070650390.json，来源读取 884 毫秒／Go 30 模型。较早一次 CLI 状态等待达 60 秒，已给被动状态读取加入三秒取消边界并回归：超时仍返回其他来源，不切默认 Profile。
- 日常安装前通过公开会话列表确认 197 条会话、零运行；Automation 零运行／排队，没有待发送草稿。通过身份核验后的应用正常退出及进程检查做冷备份；早期读取性能问题曾阻碍退出检查，已在修正后正常退出、备份、重装并核对全部进程结束。没有强制结束日常业务进程。
- 日常 Profile 为 desktop；最终固定提交已安装并重开。原用户 patch、工作区、根配置／凭据散列及 212 个原会话文件保持；其他八个依赖来源与全部旧 Bundle 保留，只新增管理器 Bundle。运行代码没有改变原默认模型、AUTO 或视觉开关。
- 可见原生插件详情显示 v0.13.0，六标签正常，无横向溢出或渲染错误；读取 50 模型：火山 16、DeepSeek API Key 2、DeepSeek 账号 2、Go 30。三预设来源已配置状态、只读 Go 目录与原生账号导航通过；页面最终留在管理器，草稿为空。串行读取本次实测配置 25／来源 992／健康 23 毫秒，不作为所有机器的性能保证。
- 本机 ArkCLI auth status 实际返回缺少有效 SSO 的准入错误。插件明确提示重新授权，选定 Profile 后认证及资源查询均带该 Profile；支持个人／团队 Agent Plan。没有调用 profile list/use，也没有代替用户完成登录、切默认 Profile、创建或轮换 Key。CLI 错误原文与秘密不下发页面。
- 本机私有交付证据：维护工作区 .local/reports/model-manager-desktop-install-20261015，含冷备份、安装日志、installed／preservation、delivery-native-manager／delivery-daily-reads／delivery-go-navigation、actual-deepseek-directory 和可见截图。日常没有新增合成会话、推理验证或配置应用。

完整插件组合、公网固定 GitHub 来源及三家真实模型推理仍未验证；没有公开推送、发布或恢复旧 Web。
