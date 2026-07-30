# Token Plan Media Hub

面向 Codex、Claude Code、Kimi Code CLI 与其他 MCP 客户端的本地优先媒体生成控制台。

> 当前状态：Windows Tauri 桌面 MVP 已实现。所有生成与能力探测均调用真实阿里云 HTTP Provider，并要求本地配置对应凭据；具体 Key 与模型组合必须实际探测后才能标记为 `verified`。
>
> 本项目不是阿里云官方项目，也不绕过 Token Plan 的套餐、地域、额度或模型限制。

## 为什么不是“一批通用 Skill”

Skill 负责告诉 Agent **何时、为什么、怎样使用能力**，但不同 Agent 的 Skill 发现、安装和命令格式并不完全相同。真正可复用的生成能力必须放在一个与 Agent 无关的核心里：

```mermaid
flowchart LR
    D["Dashboard"]
    C["统一 CLI"]
    M["MCP Server"]
    A["Codex / Claude Code / Kimi Code"]
    Core["Media Core"]
    P["Alibaba Cloud Model Studio<br/>Token Plan / DashScope"]
    Store["本地作业与产物库"]

    D --> Core
    C --> Core
    A --> M --> Core
    Core --> P
    Core --> Store
```

各 Agent 只安装薄适配层；Dashboard、CLI 和 MCP 共用同一份模型注册表、密钥配置、任务状态和产物记录。即使 Agent 聊天记录被重置，项目状态仍保存在本地文件与数据库中。

## MVP

- 凭据中心：录入并测试 Token Plan Key；普通百炼 / Model Studio API Key 始终展示但保持可选。
- 显式路由：每个模型标注所用 Key，不在两类凭据之间自动回退或静默切换。
- 能力探测：区分“官方列出”“当前所选 Key 实测可用”“该路由不可用”。
- 模型中心：文本、图片、视频、语音合成、声音复刻分别维护唯一推荐模型。
- 声音复刻：提供示例朗读文案，可在页面直接录制、试听或上传参考音频。
- 官方说明：显示来源 URL、验证日期、支持参数和限制，不硬编码营销文案。
- 测试工作台：提交任务、查看异步状态、预览和下载结果。
- 产物库：保存图片、视频、音频、克隆音色引用及生成清单。
- Agent 接入：MCP 为共同工具层，Skill/Plugin 负责发现和使用指引。

## 设计文档

- [实现状态与本地验证](docs/implementation-status.zh-CN.md)
- [产品规格](docs/product-spec.zh-CN.md)
- [完整用户故事](docs/user-stories.zh-CN.md)
- [用户流程图](docs/user-flows.zh-CN.md)
- [系统架构](docs/architecture.zh-CN.md)
- [安全与隐私边界](docs/security-and-privacy.zh-CN.md)
- [Dashboard 草稿说明](docs/wireframes/dashboard-concept.zh-CN.md)
- [官方来源与事实基线](docs/source-baseline.zh-CN.md)

## 仓库结构

```text
apps/dashboard/                 React 桌面界面
apps/desktop/                   Tauri 桌面壳、权限与 sidecar 生命周期
packages/core/                  任务、模型、产物和策略核心
packages/cli/                   面向用户和脚本的稳定 CLI
packages/mcp-server/            Agent 可调用的 MCP 工具
providers/aliyun-token-plan/    Token Plan / DashScope 适配
adapters/codex/                 Codex Plugin + Skills
adapters/claude-code/           Claude Code Skill / Command / MCP 安装器
adapters/kimi-code/             Kimi Plugin / Skill / MCP 安装器
model-registry/                 有来源、可版本化的模型目录
docs/                           产品与架构文档
```

## 公开仓库安全规则

- 永不提交 API Key、鉴权头、克隆音色 ID、原始声音样本或私人生成产物。
- Key 默认保存到操作系统凭据库；开发环境才允许使用环境变量。
- 声音复刻必须记录授权确认，且默认不公开原始录音。
- 每个生成结果写入独立 manifest，包含模型、参数、来源、时间和文件哈希。

## 许可证

MIT。第三方模型、服务和生成内容仍受各自条款约束。

## 本地验证

开发需要 Node.js 22.13、pnpm 11.7、Rust 1.84 或更高版本：

```powershell
pnpm install
pnpm desktop:dev
```

正式用户入口是 Tauri 桌面窗口。应用为 sidecar 自动选择空闲回环端口，并把当前 Origin 发布到用户级 `agent-gateway.json`；CLI 与 MCP 会自动发现该文件，不再要求用户手动管理固定的 `4317` 服务。`4317` 只保留为无发现文件时的开发回退。

| 入口 | 命令 / 地址 | 说明 |
|---|---|---|
| 桌面应用 | `pnpm desktop:dev` | Tauri + React，包含麦克风录音与 sidecar 生命周期 |
| 免安装版（推荐试用） | `pnpm desktop:portable` | 生成包含 HTTP 与 MCP sidecar 的 Windows x64 ZIP |
| Windows 安装包 | `pnpm desktop:build` | 生成 NSIS 安装器，最终用户无需 Node.js |
| 浏览器调试 | `pnpm dev` | 仅供开发，不属于 H5 兼容承诺 |
| CLI | `node packages/cli/dist/main.js text generate --prompt "写一段简介"` | 连接同一本地服务 |
| MCP | 桌面包内 `token-plan-media-mcp.exe` | stdio，共 10 个工具；自动发现当前桌面端口 |
| 全量校验 | `pnpm check` | 构建、注册表校验、测试 |
| 桌面校验 | `pnpm check:desktop` | sidecar、Dashboard 与 Tauri 可执行文件 |

## GitHub Actions

仓库使用两条职责分离的自动化流水线，均明确运行在 Node.js 24 与 pnpm 11.7.0 环境：

| Workflow | 触发方式 | 内容 |
|---|---|---|
| `CI` | Pull Request、推送到 `main` | 在 Linux 执行 `pnpm check`，并在 Windows 执行 `pnpm check:desktop` |
| `Build Windows artifacts` | Pull Request | 构建 Windows x64 NSIS 安装包、免安装 ZIP 与 `SHA256SUMS.txt`，仅上传临时 Actions Artifact |
| `Build Windows artifacts` | 从 `main` 手动触发并输入稳定版本号 | 完整构建并校验后，自动创建版本 Tag 和正式 GitHub Release，上传三个可下载资产 |

Pull Request 构建产物位于对应 GitHub Actions 运行页的 **Artifacts** 区域，名称包含应用版本与 commit 短哈希，保留 14 天。它们只用于验证，不会创建 Tag 或 Release。

正式发布时，在 GitHub Actions 中选择 `Build Windows artifacts`，从 `main` 运行 `workflow_dispatch`，并输入 `0.2.5` 这类不带 `v` 的稳定版本号。当前发布流程不提供预发布选项，也不接受 `0.2.5-beta.1` 之类的预发布后缀。本次运行会在临时检出中把输入版本写入 Tauri 配置，使安装包、免安装 ZIP、Actions Artifact、`v<version>` Tag 和正式 GitHub Release 使用同一版本；它不会自动提交版本变更。Pull Request 构建仍使用仓库中 `apps/desktop/src-tauri/tauri.conf.json` 的版本。同一版本不能重复发布。

GitHub Release 固定包含一个 NSIS `.exe`、一个免安装 `.zip` 和一个覆盖两者的 `SHA256SUMS.txt`。当前安装包尚未进行代码签名，Release 也不表示安装、自动更新或卸载流程已经完成真实环境验收。

本地复现命令如下：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm check:desktop
pnpm desktop:build
pnpm desktop:package-portable
```

系统不会自动在 Token Plan Key 与普通百炼 Key 之间回退。请在 Dashboard 的“设置”页录入 Key，并主动运行能力探测；探测和生成都会产生真实用量。
