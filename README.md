# DSH 模型管理

在 DSH 中管理模型能力、别名、推理配置与使用记录。当前为预览实现，功能与验证状态见 [docs/V1-COVERAGE.md](docs/V1-COVERAGE.md)，配置字段见 [docs/CONFIG.md](docs/CONFIG.md)。

`npm install` 后依次运行 `npm run typecheck`、`npm run build` 和 `npm test`。安装到 web profile 前在根仓库运行 `node tools/install-web.mjs --plan`。首次加载插件需要重启 DSH；后续设置修改在下一次请求生效。
