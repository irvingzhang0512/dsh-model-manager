# dsh-model-manager 需求规格说明

## 1. 项目名称

`dsh-model-manager`

## 2. 项目定位

`dsh-model-manager` 是一个 DeepSeek Harness（DSH）插件，用于统一管理 **模型能力、模型运行参数、模型路由策略、视觉能力、子 Agent 模型分发、Fallback 和配置验证**。

插件的重点不是“导入模型”，而是：

> **模型已经通过 DSH / Coding Plan / arkcli 等方式导入后，对这些模型进行能力补全、参数配置、验证、路由和运行时管理。**

插件应尽量与具体 Coding Plan 解耦，不绑定火山方舟、百炼、智谱等某一家平台。

---

# 3. 已确认的核心需求

## 3.1 必须通过 DSH「设置 / 配置」进行管理

插件需要在 DSH Web 的设置区域提供统一配置入口，例如：

```text
Settings
└── Model Manager
    ├── Models
    ├── Capabilities
    ├── Profiles
    ├── Routing
    ├── Vision
    ├── Fallback
    ├── Validation
    └── Logs
```

要求：

- 不依赖手工修改配置文件才能正常使用。
- 配置文件仍然作为底层持久化方式存在。
- UI 修改后应立即写入配置。
- 配置修改尽量运行时生效，不需要重启 `dsh web`。

---

## 3.2 与具体 Coding Plan 解耦

插件不应写死：

- 火山 Agent Plan
- 火山 Coding Plan
- 百炼 Coding Plan
- 智谱 Coding Plan
- 其他 OpenAI Compatible Provider

统一抽象为：

```text
Provider
  ↓
Model
  ↓
Capability
  ↓
Runtime Parameters
```

不同 Coding Plan 如果存在特殊参数，可以通过 Adapter / Provider Extension 适配。

例如：

```text
Provider Adapter
├── generic-openai-compatible
├── volcengine-ark
├── bailian
├── zhipu
└── custom
```

第一版不要求全部实现。

必须先有通用机制，并允许以后增加 Provider Adapter。

---

## 3.3 模型导入不是本插件的主要目标

模型可能通过以下方式进入 DSH：

- arkcli
- DSH 原生 Provider 配置
- Coding Plan 自带模型同步
- 用户手工添加模型
- 其他插件

`dsh-model-manager` 的职责从“模型已经存在”开始。

流程：

```text
外部工具 / DSH
      ↓
模型已经导入
      ↓
dsh-model-manager 发现模型
      ↓
配置 Capability
      ↓
配置 Thinking / Reasoning
      ↓
验证配置
      ↓
保存 Overlay / 配置
```

插件可以提供“刷新模型列表”或“重新扫描”功能，但不负责成为新的模型导入工具。

---

# 4. 模型能力配置

每个模型的能力应以：

```text
Provider + Model
```

作为唯一对象。

不能只按照模型名称判断能力。

例如：

```text
ark-coding-plan / model-a
ark-agent-plan  / model-a
```

应允许拥有不同能力配置。

---

## 4.1 基础 Capability

至少支持：

```text
Input
├── Text
├── Image
├── Audio（预留）
└── Video（预留）

Agent
├── Tool Calling
└── Structured Output

Reasoning
├── Thinking
└── Reasoning Effort

Limits
├── Context Window
└── Max Output Tokens
```

V1 重点实现：

- Text
- Image
- Tool Calling
- Thinking
- Reasoning Effort
- Context Window
- Max Output Tokens

---

## 4.2 图片能力

模型导入后，DSH 可能默认只配置：

```text
input = text
```

即使模型实际上支持图片。

插件必须允许在 Settings 中设置：

```text
Input:
[x] Text
[x] Image
```

保存后应修改对应的 DSH 模型能力配置或建立 Overlay，使下一次请求能够正确使用图片。

要求：

- 不应仅根据模型名称猜测是否支持图片。
- 用户可以手工修改。
- 可以提供自动验证。
- 验证结果应明确显示。

---

# 5. Thinking / Reasoning Effort

## 5.1 Thinking

统一抽象：

```text
Thinking
├── Auto
├── Off
└── On
```

实际 Provider 可能使用：

```text
thinking
enable_thinking
thinking_mode
thinking_budget
...
```

由 Adapter 做映射。

---

## 5.2 Reasoning Effort

统一抽象：

```text
Reasoning Effort
├── Auto
├── Fast
├── Balanced
├── Deep
└── Max
```

Provider 实际可能使用：

```text
none
minimal
low
medium
high
xhigh
max
```

插件负责映射。

例如：

```text
Fast      → low
Balanced  → medium
Deep      → high
Max       → max
```

具体映射需要根据模型 / Provider 能力确定。

---

## 5.3 模型支持哪些档位必须可见

导入模型之后，用户应能看到：

```text
Model: xxx

Thinking:
✓ Auto
✓ Off
✓ On

Reasoning Effort:
✓ Low
✓ Medium
✓ High
✗ Max
```

如果模型不支持某些参数：

- UI 不应允许选择；
- 或者置灰；
- 并显示原因。

---

# 6. 模型配置验证

这是插件的核心功能之一。

用户修改模型能力之后，应提供：

```text
[验证配置]
```

验证目标包括：

## 6.1 基础请求验证

```text
Text Request
```

检查：

- 模型是否可调用；
- Provider 是否可用；
- 基础 API 参数是否正确。

---

## 6.2 图片验证

如果用户声明：

```text
Image = true
```

插件应发送一个非常小的测试图片进行验证。

结果：

```text
Image Input
✓ Verified
```

或者：

```text
Image Input
✗ Provider rejected image input
```

---

## 6.3 Thinking 验证

分别验证模型是否接受：

```text
Thinking = Off
Thinking = On
Thinking = Auto
```

---

## 6.4 Reasoning Effort 验证

根据用户选择的能力进行测试：

```text
Low
Medium
High
Max
```

结果至少区分：

```text
Supported
Rejected
Unknown
```

注意：

验证只能证明：

> API / Provider 接受这个参数。

不能证明模型内部一定按照预期产生不同推理强度。

---

## 6.5 验证结果记录

每项 Capability 建议记录：

```text
Value
Source
Verification Status
Last Verified Time
```

例如：

```text
Image:
  value: true
  source: user
  verified: true

Reasoning High:
  value: true
  source: probe
  verified: true
```

---

# 7. 模型能力来源

每项能力应尽量记录来源。

支持：

```text
Provider Metadata
DSH Metadata
Plugin Built-in Metadata
Probe
User Override
Unknown
```

优先级建议：

```text
User Override
    >
Verified Provider Metadata
    >
Probe
    >
Built-in Metadata
    >
Unknown
```

不要在核心代码中大量写死：

```text
if modelName == xxx
```

---

# 8. 模型运行模式

插件至少支持两类核心模式：

```text
Manual
Auto
```

后续可以扩展更多模式，但这两种必须优先完成。

---

# 9. Manual 模式

Manual 模式用于用户完全手动控制模型。

界面：

```text
Mode:
Manual

Model:
[ Provider / Model ▼ ]

Thinking:
[ Auto / Off / On ▼ ]

Reasoning Effort:
[ Auto / Fast / Balanced / Deep / Max ▼ ]
```

UI 必须根据模型 Capability 自动调整可选项。

例如模型只支持：

```text
Low / Medium / High
```

则：

```text
Max
```

不能选择。

---

## 9.1 Manual 模式支持 Session Override

支持：

```text
Global Default
Session Override
Turn Override
```

优先级：

```text
Turn Override
>
Session Override
>
Global Default
```

例如：

```text
Model = Auto
Reasoning = Deep
```

表示：

> 模型由策略决定，但本轮强制 Deep。

---

# 10. Auto 模式

这里的 Auto 模式重点参考 Codex / Claude Code 的 Agent 工作方式：

> **主 Agent 使用稳定、能力较强的模型；主 Agent 根据任务需要，将不同子任务分发给不同类型模型。**

不是简单的：

```text
每一轮请求
→ Judge
→ 换一个主模型
```

Auto 的核心是：

```text
Main Agent
   ↓
理解任务 / 规划 / 调度
   ↓
根据任务需要创建子 Agent
   ↓
不同类型子 Agent 使用不同模型
```

---

# 11. Auto 模式总体结构

```text
                     User
                      ↓
                 Main Agent
                      ↓
           是否需要拆分 / 分发任务
                      ↓
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
      Search        Coding        Review
        ↓             ↓             ↓
      @fast        @coding        @strong
```

主 Agent 可自行完成简单工作。

并不是所有请求都必须拆成子 Agent。

---

# 12. Main Agent

Auto 模式必须允许配置主 Agent。

支持两种方式：

```text
Main Agent:
○ Follow Current DSH Model
○ Use Model Manager Model / Alias
```

例如：

```text
Main Agent
→ @strong
→ Balanced
```

Main Agent 主要负责：

- 理解用户需求；
- 规划；
- 判断是否拆任务；
- 判断子任务类型；
- 创建 / 调用子 Agent；
- 检查结果；
- 汇总最终结果。

---

# 13. Agent Role

至少支持以下角色：

```text
Main
Search / Explore
Coding
Review
Strong / Expert
Vision
```

用户可以配置：

```text
Main
→ @strong
→ Balanced

Search
→ @fast
→ Fast

Coding
→ @coding
→ Balanced

Review
→ @strong
→ Deep

Vision
→ @vision
→ Balanced
```

---

# 14. Auto 模式的模型分发

插件应尽量复用 DSH 原生：

- Agent
- Subagent
- Delegated Task
- Tool
- Agent Lifecycle

不要重新实现完整 Agent Runtime。

核心目标：

> 当主 Agent 创建子 Agent / Delegated Task 时，根据任务角色自动设置目标模型。

例如：

```text
探索代码
→ Search Agent
→ @fast

实现功能
→ Coding Agent
→ @coding

复杂调试
→ Strong Agent
→ @strong

代码审查
→ Review Agent
→ @strong + Deep
```

---

# 15. Auto 模式的 Reasoning

Auto 模式中，每个 Agent Role 应拥有自己的默认 Inference Profile。

例如：

```text
Main
→ Balanced

Search
→ Fast

Coding
→ Balanced

Review
→ Deep

Strong
→ Deep
```

用户可以修改。

---

# 16. 动态升级

Auto 模式应支持运行时升级。

例如：

```text
Coding Agent
@coding + Balanced
        ↓
失败
        ↓
@coding + Deep
        ↓
再次失败
        ↓
@strong + Deep
```

升级分两条轴：

```text
Model Tier
@fast → @coding → @strong
```

以及：

```text
Reasoning
Fast → Balanced → Deep → Max
```

两者可以独立升级。

---

# 17. Model Alias

为了避免策略直接绑定具体模型，提供 Alias：

```text
@fast
@coding
@strong
@vision
@long-context
```

例如：

```text
@fast
→ Provider A / Model A

@coding
→ Provider B / Model B

@strong
→ Provider A / Model C

@vision
→ Provider A / Model D
```

---

## 17.1 Alias Fallback

每个 Alias 可以配置多个候选：

```text
@strong

Primary
→ Model A

Fallback 1
→ Model B

Fallback 2
→ Model C
```

---

# 18. Vision

支持两种模式。

## 18.1 Native Vision

当前 Agent 使用的模型本身支持图片：

```text
Image
 ↓
Current Model
```

---

## 18.2 Vision Sidecar

当前 Coding 模型不支持图片：

```text
Image
 ↓
@vision
 ↓
Vision Model
 ↓
图片理解结果
 ↓
Main / Coding Agent
```

这样可以继续使用强 Coding 模型，不必为了图片切换整个 Agent。

---

# 19. Vision Strategy

配置：

```text
Vision Strategy

○ Native First
○ Sidecar First
○ Native Only
○ Sidecar Only
```

默认建议：

```text
Native First
```

即：

```text
当前模型支持 Image
→ Native

否则
→ Sidecar
```

---

# 20. Fallback / Reliability

模型调用失败时支持：

```text
Retry
Fallback
Cooldown
Escalation
```

错误需要分类。

建议：

```text
Timeout / Network / 5xx
→ Retry
→ Fallback

429
→ Cooldown
→ Fallback

Unsupported Parameter
→ 参数降级
→ Capability 标记异常

Image Unsupported
→ Vision Sidecar

Context Overflow
→ Long Context Model

Authentication Error
→ 不盲目切同 Provider 模型
```

---

# 21. Context Window

模型 Capability 应记录：

```text
Context Window
Max Output Tokens
```

Router / Agent Dispatch 应能够避免：

```text
当前上下文已经超过目标模型最大窗口
```

必要时自动使用：

```text
@long-context
```

或更强模型。

---

# 22. 模型热更新

必须尽量实现：

```text
模型新增
模型删除
Capability 修改
Thinking 配置修改
Reasoning 配置修改
Alias 修改
Routing 修改
Fallback 修改
```

无需重启：

```text
dsh web
```

运行中的请求：

```text
继续使用请求开始时的模型 Snapshot
```

下一次请求读取最新配置。

---

# 23. Runtime Registry

插件建议长期维护：

```text
ModelManagerService

├── ModelRegistry
├── CapabilityRegistry
├── AliasRegistry
├── AgentPolicyRegistry
├── HealthRegistry
└── ValidationRegistry
```

配置变更后：

```text
reload registry
```

而不是重启整个 DSH。

---

# 24. Settings UI

建议在：

```text
Settings
→ Model Manager
```

提供以下页面。

---

## 24.1 Models

显示：

```text
Provider
Model
Text
Image
Tool
Thinking
Reasoning
Context
Status
```

---

## 24.2 Model Detail

点击模型进入：

```text
Basic
Capabilities
Thinking
Reasoning Effort
Limits
Validation
```

---

## 24.3 Aliases

配置：

```text
@fast
@coding
@strong
@vision
@long-context
```

---

## 24.4 Auto

配置：

```text
Main Agent
Search Agent
Coding Agent
Review Agent
Strong Agent
Vision Agent
```

每个角色配置：

```text
Model / Alias
Inference Profile
Fallback
```

---

## 24.5 Vision

配置 Native / Sidecar。

---

## 24.6 Validation

显示模型能力验证结果。

支持：

```text
[验证当前模型]
[验证所有模型]
```

“验证所有模型”必须有确认提示，避免产生大量请求。

---

## 24.7 Logs

记录：

```text
Time
Session
Agent Role
Selected Alias
Provider
Model
Thinking
Reasoning Effort
Why Selected
Fallback
Latency
Tokens
Error
```

核心目标：

> 用户必须能够知道每一次实际调用最终使用了什么模型。

---

# 25. 配置文件

插件自身配置使用本地文件持久化。

优先：

```text
YAML / JSON
```

不引入数据库。

目录遵循 DSH Plugin 数据目录规范。

逻辑上建议：

```text
dsh-model-manager/
├── capabilities.yml
├── aliases.yml
├── profiles.yml
├── routing.yml
├── validation.yml
└── runtime/
```

配置文件必须有版本：

```yaml
version: 1
```

支持未来迁移。

---

# 26. Provider Adapter

插件必须提供统一 Adapter 接口。

例如：

```ts
interface ModelProviderAdapter {
  readCapabilities(...)
  mapThinking(...)
  mapReasoningEffort(...)
  validateCapability(...)
  sanitizeRequest(...)
}
```

V1 至少实现：

```text
Generic / OpenAI-Compatible Adapter
```

对于特殊 Coding Plan，可以以后增加：

```text
Volcengine Adapter
Bailian Adapter
Zhipu Adapter
...
```

---

# 27. 插件不负责什么

V1 不负责：

```text
成为新的 Coding Plan
管理 API Key
替代 DSH Provider
重新实现 LLM Client
重新实现 Agent Runtime
重新实现 arkcli
负责模型下载
复杂 Benchmark
自动训练 Router
```

---

# 28. V1 优先级

## P0

第一版必须：

1. Settings / Model Manager UI
2. 读取 DSH 已有 Provider / Model
3. Capability Overlay
4. Image Capability 配置
5. Thinking Capability 配置
6. Reasoning Effort Capability 配置
7. Context Window 配置
8. Manual Mode
9. Alias
10. Capability Validation
11. 配置热更新
12. 调用日志

---

## P1

第二阶段：

1. Auto Mode
2. Main Agent 配置
3. Subagent / Delegated Task 模型分发
4. Agent Role
5. Inference Profile
6. Vision Sidecar
7. Fallback
8. Dynamic Escalation

---

## P2

后续：

1. 自动 Capability Probe
2. Provider 专用 Adapter
3. Context 自动路由
4. Health / Cooldown
5. Token / Cost 统计
6. Benchmark
7. Auto Turn / Judge Router
8. Hybrid Router

---

# 29. 核心验收场景

## Case 1：arkcli 更新模型

arkcli 新增模型后：

```text
无需重启 dsh web
```

插件刷新后可以看到新模型。

---

## Case 2：补全图片能力

模型默认：

```text
Text Only
```

用户配置：

```text
Image = true
```

点击：

```text
验证
```

测试成功后：

```text
Image = Verified
```

下一次请求可以直接使用图片。

---

## Case 3：Reasoning 配置

模型声明：

```text
Low
Medium
High
```

UI 只能选择：

```text
Low
Medium
High
```

不能选择 Max。

---

## Case 4：Manual

用户：

```text
Model = Model A
Thinking = On
Reasoning = Deep
```

实际请求使用对应 Provider 参数。

---

## Case 5：Auto

配置：

```text
Main
→ @strong

Search
→ @fast

Coding
→ @coding

Review
→ @strong + Deep
```

主 Agent 执行复杂 Coding 任务时：

```text
搜索任务
→ @fast

Coding
→ @coding

Review
→ @strong
```

日志中可以看到每个 Agent 实际使用的模型。

---

## Case 6：模型运行时修改

修改：

```text
@coding
Model A → Model B
```

不重启 `dsh web`。

下一次 Coding Agent 请求使用 Model B。

---

# 30. 核心架构对象

插件围绕以下对象实现。

## Model

```text
DSH 已经存在的具体 Provider + Model
```

## Capability

```text
这个 Provider 下这个模型能做什么
```

## Alias

```text
这个模型承担什么逻辑角色
```

## Inference Profile

```text
这次调用让模型以什么推理强度运行
```

## Agent Policy

```text
Main / Search / Coding / Review 等 Agent 应使用哪个 Alias
```

## Validation

```text
当前 Capability 配置是否经过实际 API 验证
```

---

# 31. 最终目标

最终用户在 DSH 中只需要面对：

```text
Manual

或

Auto
```

Manual：

```text
模型
Thinking
Reasoning Effort
```

Auto：

```text
Main Agent
Search Agent
Coding Agent
Review Agent
Vision Agent
```

具体的：

```text
Provider
模型 ID
Thinking 参数名
Reasoning 参数名
图片输入格式
Fallback
```

由 `dsh-model-manager` 统一处理。

最终目标：

> **让 DSH 中的模型能力、模型配置、模型验证和 Coding Agent 模型分工都可以在一个地方管理。**
