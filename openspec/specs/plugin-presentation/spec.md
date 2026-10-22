# F014 插件列表与详情的显示名称

## Purpose

为 dsh-model-manager 的插件列表与详情的显示名称维护唯一可编辑的行为与验收规格，保留原编号 F014，区分当前预期、尚未实现设计和历史验证；原始需求、项目资料及旧文档继续原位只读保留。

## Requirements

### Requirement: F014 插件列表与详情的显示名称

系统 SHALL 按下列完整场景落实插件列表与详情的显示名称的预期、边界与验收。本节迁入已有功能规则；本次仅迁移文档，没有重新执行产品验收。

#### Scenario: F014-S01 场景与预期

- **WHEN** 宿主显示插件列表、详情或成员行
- **THEN** 场景与预期：中文显示「Irving · 模型增强」，英文显示「Irving · Model Enhancement」；保留完整包名 dsh-model-manager 与全部运行标识。

#### Scenario: F014-S02 中文简介

- **WHEN** 宿主显示插件列表、详情或成员行
- **THEN** 中文简介：提供模型参数配置、别名与备用模型管理、自动选模和视觉辅助。

#### Scenario: F014-S03 英文简介

- **WHEN** 宿主显示插件列表、详情或成员行
- **THEN** 英文简介：Configure model parameters, manage aliases and fallback models, and support automatic model selection and visual assistance.

#### Scenario: F014-S04 技术契约

- **WHEN** 宿主显示插件列表、详情或成员行
- **THEN** 技术契约：导出 locale/en.json 与 locale/zh.json 的 meta.title／meta.description；exports["./locale/*.json"] 指向对应资源，files 分发 locale，package.description 使用中文简介兜底。客户端设置／详情标题同步；功能导航不强制改名。

#### Scenario: F014-S05 验收

- **WHEN** 宿主显示插件列表、详情或成员行
- **THEN** 验收：目标宿主从固定 tgz 解析两语言名称／简介，原生列表、详情、成员行一致；无新增布局溢出，原工具／配置／存储保持。新套件成员在隔离验证后交付日常。
