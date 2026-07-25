# 系统架构

## 核心结论

跨 Agent 的共同协议选 MCP，Skill 只是上层说明。Codex、Claude Code 与 Kimi Code CLI 都可以连接 MCP；Kimi 还支持把 Skill 与 MCP 声明打包为 Plugin。

```mermaid
flowchart TB
    subgraph Clients["使用入口"]
        Dashboard["Local Dashboard"]
        CLI["tp-media CLI"]
        Codex["Codex Plugin / Skill"]
        Claude["Claude Code Skill / Command"]
        Kimi["Kimi Plugin / Skill"]
        Other["Other MCP Client"]
    end

    subgraph Interface["稳定接口层"]
        MCP["MCP Server"]
        LocalAPI["Loopback HTTP API"]
    end

    subgraph Core["Agent-neutral Media Core"]
        Registry["Model Registry"]
        Policy["Capability & Consent Policy"]
        Jobs["Job Orchestrator"]
        Credentials["Credential Broker"]
        Artifacts["Artifact Service"]
    end

    subgraph Storage["本地持久化"]
        Keyring["OS Keyring / DPAPI"]
        SQLite["SQLite"]
        Files["Artifact Files + Manifests"]
    end

    subgraph Providers["供应商适配"]
        TokenPlan["Alibaba Token Plan Adapter"]
        DashScope["DashScope Speech Adapter"]
    end

    Codex --> MCP
    Claude --> MCP
    Kimi --> MCP
    Other --> MCP
    Dashboard --> LocalAPI
    CLI --> Core
    MCP --> Core
    LocalAPI --> Core
    Core --> TokenPlan
    Core --> DashScope
    Credentials --> Keyring
    Jobs --> SQLite
    Artifacts --> SQLite
    Artifacts --> Files
```

## 分层职责

| 模块 | 负责 | 不负责 |
|---|---|---|
| Agent Skill | 触发语义、使用指导、安全提醒 | API 请求、Key、任务状态 |
| MCP Server | 稳定工具 Schema、权限边界、结构化错误 | 供应商特有字段散落 |
| Media Core | 校验、路由、任务、产物、审计 | Agent 私有配置格式 |
| Model Registry | 模型、能力、参数、来源、验证状态 | 保存用户 Key |
| Provider Adapter | 官方端点、请求/响应转换、轮询 | UI 和 Agent 逻辑 |
| Dashboard | 配置、选择、测试、预览、安装向导 | 成为第二套媒体实现 |

## Provider-neutral contracts

### Job

```json
{
  "id": "job_...",
  "capability": "image.generate",
  "model": "wan2.7-image",
  "status": "queued",
  "client": {
    "kind": "mcp",
    "name": "codex"
  },
  "providerTaskId": null,
  "artifactIds": [],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### 错误分类

```text
AUTH_INVALID
REGION_UNAVAILABLE
PLAN_UNSUPPORTED
MODEL_UNAVAILABLE
PARAMETER_INVALID
CONSENT_REQUIRED
PROVIDER_REJECTED
JOB_TIMEOUT_UNKNOWN
DOWNLOAD_FAILED
LOCAL_DEPENDENCY_MISSING
```

超时必须使用 `JOB_TIMEOUT_UNKNOWN`，不能当作失败或成功；如果有 provider task ID，用户可以继续查询。

## Agent 包装策略

| Agent | 主要工具层 | 包装层 |
|---|---|---|
| Codex | MCP | Plugin 中的 Skills + MCP 声明 |
| Claude Code | MCP | Skill/Slash Command + 安装器 |
| Kimi Code CLI | MCP（stdio/HTTP） | Plugin 或 Agent Skill；项目级 `.kimi-code/mcp.json` |
| 未知 Agent | CLI/HTTP/MCP | 可选的薄说明文件 |

## 本地状态

```text
config.db
  credential_refs
  model_preferences
  capability_probes
  jobs
  artifacts
  consent_records

artifacts/
  <yyyy>/<mm>/<job-id>/
    request.json
    response-summary.json
    manifest.json
    output.<ext>
```

数据库与文件系统使用写临时文件、校验、原子改名、最后提交数据库的顺序，避免出现数据库记录成功但文件缺失。

