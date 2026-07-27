# 产品规格：Token Plan Media Hub

## 1. 问题定义

用户已经能通过某个 Agent 的本地 Skill 调用 Token Plan，但这种实现存在四个结构性问题：

| 问题 | 后果 |
|---|---|
| 能力散落在 Agent 私有目录 | 更换 Agent 或 reset 后难以找回 |
| Skill 同时承担提示词、凭据和 API 实现 | 模型更新时容易漂移 |
| 图片、视频、语音各自保存状态 | 无统一作业历史和产物库 |
| “文档支持”与“当前 Key 可用”混为一谈 | 用户直到调用失败才知道权限边界 |

## 2. 产品判断

本项目不是另一个聊天客户端。它是一个本地媒体能力控制平面：

- Dashboard 面向人；
- MCP 面向 Agent 和其他工具；
- CLI 面向脚本、CI 和调试；
- Provider Adapter 面向阿里云接口；
- Artifact Store 面向跨会话的长期状态。

Skill 只负责能力发现、使用说明和安全提醒，不负责保存关键状态。

## 3. 目标用户

| 用户 | 核心任务 |
|---|---|
| 独立开发者 | 用已有 Token Plan 快速给多个编码 Agent 增加媒体能力 |
| 内容创作者 | 在一个地方测试模型、保存中间产物和复用克隆音色 |
| Agent 工具作者 | 通过 MCP/CLI 调用统一媒体能力，而非适配每个供应商接口 |
| 团队管理员（后续） | 分发一致的模型策略并审计用量与授权 |

## 4. UX 原则

1. **先探测，再承诺**：界面明确区分官方文档、注册表快照和当前 Key 实测结果。
2. **一次配置，多端使用**：Agent 适配器不再要求重复填写 Key。
3. **结果不依赖聊天**：作业、错误、产物和来源写入本地持久化存储。
4. **模型选择可解释**：每个模型显示用途、输入输出、参数边界、来源和验证日期。
5. **长任务可恢复**：视频等异步任务保存 task ID，可在重启后继续查询。
6. **私密默认**：回环监听、系统凭据库、声音授权、产物不进 Git。
7. **凭据路由显式**：两类 Key 分别配置；模型、测试和任务都显示实际使用的凭据类型，不自动回退。

## 5. MVP 功能

### 5.1 初始设置

- 提供两个并列但独立的凭据输入：
  - `Token Plan Key`：用于用户明确选择的 Token Plan 路由；
  - `Model Studio API Key（普通百炼 Key）`：可选，用于用户明确选择的标准百炼路由。
- 普通百炼 Key 输入始终可见，但首次设置不要求填写；仅配置并验证 Token Plan Key 即可继续。
- 当用户选择只能走普通百炼路由的模型时，提交前提示补充该 Key；不影响其他已配置能力，也不自动替用户切换路由。
- 每个输入框都有 info icon，说明用途、可能的计费范围、区域要求，以及“保存该 Key 不等于所有模型都可用”。
- 两个 Key 分别保存、遮罩、替换、删除和测试；已配置时主按钮显示“更新”，输入新的 Key 后才允许替换；连接状态不能互相代替。
- 已保存的 Key 默认不回显；桌面端在凭据操作区提供“复制”，位置紧邻“删除”左侧。复制请求必须通过每次启动生成的桌面会话令牌鉴权，由本地服务直接写入系统剪贴板，响应体、MCP 和 Agent 网关均不得返回明文 Key。
- 两类 Key 的输入区都链接到千问AI平台统一的 API Key 管理页面；Token Plan 与按量付费不再维护两套创建入口。
- 设置页分别提供 Token Plan 与按量付费用量入口；在官方没有公开稳定的套餐用量查询 API 前，实时 Credits、剩余额度和重置时间只跳转官方平台查看，不用本地任务数伪装账户总用量。
- 验证所选 Key 的格式、区域和基础连接，再逐能力运行低成本探测。
- 每个模型必须显示 credential route；没有用户选择或已保存的模型默认值时，不允许自动改用另一类 Key。

建议的界面文案：

| 字段 | info icon 说明 |
|---|---|
| Token Plan Key | 用于 Token Plan 已支持并经当前 Key 探测可用的模型；消耗 Token Plan Credits。不会自动改用普通百炼 Key。 |
| Model Studio API Key（普通百炼 Key，可选） | 用于明确选择的标准百炼模型或能力，可能采用独立计费。不填写不影响 Token Plan 能力，也不会自动改用 Token Plan Key。 |

### 5.2 模型中心

- 四个一级分类：图片、视频、语音合成、声音复刻。
- 模型卡包含：
  - 模型 ID；
  - 能力标签；
  - 当前选择的 credential route；
  - 当前凭据可用性；
  - 官方说明的简短转述；
  - 官方来源 URL；
  - `verified_at`；
  - 可用参数 Schema；
  - 异步/同步模式；
  - 风险或限制。
- 用户可测试并设为默认模型。

### 5.3 生成工作台

- 根据模型 Schema 动态生成表单，不显示模型不支持的参数。
- 图片支持预览和下载。
- 视频显示提交、排队、生成、下载、失败状态。
- 语音支持文本试听。
- 声音复刻在上传前显示授权确认，成功后保存本地别名和远端 voice ID 的安全引用。

### 5.4 产物库

每个产物至少包含：

```text
artifact_id
job_id
capability
provider
model
parameters
prompt_or_text
created_at
local_path
mime_type
sha256
source_job_id
consent_record_id (voice clone only)
```

支持预览、下载、复制路径、重新生成、查看 manifest 和删除本地副本。

### 5.5 Agent 接入

首期暴露稳定 MCP 工具：

```text
media.list_models
media.probe_capabilities
media.generate_image
media.generate_video
media.get_job
media.synthesize_speech
media.clone_voice
media.list_artifacts
media.get_artifact
```

Dashboard 提供 Codex、Claude Code、Kimi Code CLI 三个安装向导，并显示连接状态。

## 6. 非目标

- 不代理或绕过 Token Plan 的订阅、额度、并发和地域限制。
- 不承诺所有 Token Plan SKU 都支持声音复刻；必须运行能力探测。
- MVP 不提供公网 SaaS、多租户或团队密钥共享。
- MVP 不提供完整视频剪辑器和时间线。
- 不复制 Agent 的聊天历史；只保存本项目自身的请求与结果。
- 不调用未公开的控制台内部接口，也不要求用户为查看套餐用量额外录入阿里云账号 AccessKey。

## 7. 成功标准

| 指标 | MVP 验收方式 |
|---|---|
| 配置可靠 | 重启 Dashboard 后无需重新输入 Key |
| 路由透明 | 任一测试或生成任务均可在提交前确认所用凭据类型；运行时不自动切换 |
| 跨 Agent | 三个目标 Agent 均能调用同一 MCP `list_models` 与一个测试生成工具 |
| 可恢复 | 异步视频任务在进程重启后能继续查询 |
| 可追溯 | 每个模型和每个产物均有来源/manifest |
| 安全 | Git 历史与日志扫描无真实 Key、声音样本和临时下载 URL |
| 可解释 | UI 不展示未经来源确认的价格、额度和参数 |

## 8. 阶段计划

| 阶段 | 范围 |
|---|---|
| P0：事实基线 | Provider contract、注册表 Schema、探测协议 |
| P1：本地核心 | Key Vault、SQLite、Artifact Store、CLI |
| P2：媒体 MVP | 图片、文生视频、系统音色 TTS、声音复刻 |
| P3：MCP | 稳定工具 Schema、权限与异步作业 |
| P4：Dashboard | 设置、模型中心、测试台、产物库、安装器 |
| P5：Agent 包装 | Codex、Claude Code、Kimi Code CLI |
| P6：扩展能力 | 图生视频、参考生视频、视频编辑、多角色语音 |
