# 安全与隐私边界

## 威胁重点

| 资产 | 主要风险 | 默认控制 |
|---|---|---|
| Token Plan / DashScope Key | Git 泄漏、日志泄漏、恶意页面读取 | OS Keyring、遮罩显示、日志脱敏 |
| 声音样本 | 未授权复刻、意外公开 | 显式 consent、本地私有目录、禁止进 Git |
| 克隆音色 ID | 被其他调用方滥用 | 作为 secret reference 保存 |
| 临时下载 URL | URL 泄漏或过期 | 立即下载，只记录脱敏摘要 |
| 生成媒体 | 私密内容进入公共仓库 | 独立 artifact 根目录并默认忽略 |
| MCP 工具 | Agent 误调用或越权 | 工具分级、审批、参数白名单 |

## 凭据

- Dashboard 只接受本地输入，网络请求由本地服务完成。
- Windows 首选 Credential Manager/DPAPI；macOS/Linux 后续使用系统 Keyring。
- SQLite 仅保存 `credential_id` 和元数据。
- 环境变量只用于开发和无 UI 环境。
- 永不把 Key 写入 Skill、MCP JSON、任务 manifest 或错误对象。

## 声音复刻

复刻前必须记录：

```text
consent_record_id
affirmed_at
scope
source_file_hash
actor
```

系统不能判断用户是否真正拥有某个声音，但必须阻止无确认的调用，并在 UI 中明确说明法律与伦理责任。

## MCP 权限

低风险：

- `list_models`
- `get_job`
- `list_artifacts`

有成本或外部影响：

- `generate_image`
- `generate_video`
- `synthesize_speech`

高敏感：

- `clone_voice`
- 删除产物
- 修改凭据

适配器不得建议全局放行所有 MCP 工具。声音复刻和删除操作始终保留显式确认。

## 网络

- Dashboard 和 HTTP API 默认监听 `127.0.0.1`。
- MVP 不提供公网部署。
- 若未来允许局域网访问，必须引入独立认证、CSRF 防护、TLS 和来源限制。
- Provider 响应在持久化前进行字段白名单和脱敏。

## 公开仓库发布检查

发布前至少运行：

```text
secret scan
private media path scan
voice ID pattern scan
temporary URL scan
registry source validation
```

