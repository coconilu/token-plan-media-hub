# 官方来源与事实基线

核对日期：2026-07-27。

本文件只记录产品设计所需的最小事实。Dashboard 中的模型说明应保存简短转述、来源 URL 与 `verified_at`，不复制整段官方文档。

| 事实 | 当前基线 | 官方来源 |
|---|---|---|
| Token Plan | Credits 统一计量；支持多种编程/Agent 工具；目前限定华北2（北京） | https://help.aliyun.com/zh/model-studio/token-plan-overview |
| API Key 管理 | Token Plan 与按量付费凭据统一在千问AI平台 API Key 页面管理 | https://platform.qianwenai.com/home/api-keys |
| 用量查看 | Token Plan 个人版采用 5 小时、7 天双额度窗口；Token Plan 与按量付费使用各自的官方用量页面。公开的 Model Studio OpenAPI 目录未列出可由 `sk-sp-` Key 查询套餐实时用量的接口 | https://platform.qianwenai.com/home/billing/subscription/token-plan-individual；https://platform.qianwenai.com/home/billing/pay-as-you-go；https://api.aliyun.com/document/ModelStudio/2026-02-10 |
| Agent 多模态接入 | 图片/视频通过 Skill、Slash Command 或 Agent 扩展；官方给出 Claude Code 示例 | https://help.aliyun.com/zh/model-studio/token-plan-multimodal-gen |
| 图片模型示例 | qwen-image-2.0、qwen-image-2.0-pro、wan2.7-image、wan2.7-image-pro | https://help.aliyun.com/zh/model-studio/token-plan-multimodal-gen |
| 视频模型 | HappyHorse 1.1 支持 t2v/i2v/r2v；官方模型页给出分辨率、时长和音频能力 | https://help.aliyun.com/zh/model-studio/video-generate-edit-model |
| 系统音色 TTS | qwen3-tts-flash 为 HTTP 系统音色模型，不支持声音复刻；当前注册表收录官方非实时合成清单中的 48 个系统音色 | https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list |
| 声音复刻 | qwen3-tts-vc-2026-01-22 为 HTTP 声音复刻模型 | https://help.aliyun.com/zh/model-studio/tts-model |
| Kimi MCP | 支持 stdio、HTTP、SSE；项目配置可放在 `.kimi-code/mcp.json` | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html |
| Kimi Skills/Plugin | 支持 Agent Skills；Plugin 可声明 Skills 与 MCP | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html |
| Codex Skills/Plugin | Skill 遵循开放 Agent Skills 格式；分发时可用包含 Skills 与 MCP 的 Plugin | https://developers.openai.com/plugins/ |

## 必须保持为“待探测”的事实

- 某个具体 Token Plan SKU 是否开放某个语音或声音复刻模型。
- 用户当前套餐用量、并发、活动价格和折扣。
- 模型是否已下架或被新快照替换。
- 当前 Key 对某个模型的权限。

模型权限与可用性不能仅靠静态文档决定，必须通过当前 Key 运行安全、低成本的 capability probe。账户级套餐用量不属于 capability probe；在官方提供公开稳定查询 API 前，只能引导用户到千问AI平台对应的用量页面查看。

## 从现有 OpenClaw 实现发现的迁移风险

| 发现 | 新项目处理 |
|---|---|
| 图片默认模型硬编码为 `wan2.7-image`，官方示例默认值不同 | 默认值放入可更新注册表 |
| 视频脚本只允许 `happyhorse-1.1-t2v` | Provider contract 支持能力枚举 |
| 视频脚本把 duration 限制为 1–10，而官方页面列出 3–15 秒 | 参数来自注册表和 probe，不散落在脚本 |
| 语音会在 Token Plan 与普通百炼 Key 之间切换 | Credentials 页同时支持两个 Key；模型逐一选择 credential route，失败时不自动回退 |
| OpenClaw 状态写入私有目录 | 状态迁入独立数据库与 artifact store |
