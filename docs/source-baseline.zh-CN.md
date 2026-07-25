# 官方来源与事实基线

核对日期：2026-07-25。

本文件只记录产品设计所需的最小事实。Dashboard 中的模型说明应保存简短转述、来源 URL 与 `verified_at`，不复制整段官方文档。

| 事实 | 当前基线 | 官方来源 |
|---|---|---|
| Token Plan | Credits 统一计量；支持多种编程/Agent 工具；目前限定华北2（北京） | https://help.aliyun.com/zh/model-studio/token-plan-overview |
| Agent 多模态接入 | 图片/视频通过 Skill、Slash Command 或 Agent 扩展；官方给出 Claude Code 示例 | https://help.aliyun.com/zh/model-studio/token-plan-multimodal-gen |
| 图片模型示例 | qwen-image-2.0、qwen-image-2.0-pro、wan2.7-image、wan2.7-image-pro | https://help.aliyun.com/zh/model-studio/token-plan-multimodal-gen |
| 视频模型 | HappyHorse 1.1 支持 t2v/i2v/r2v；官方模型页给出分辨率、时长和音频能力 | https://help.aliyun.com/zh/model-studio/video-generate-edit-model |
| 系统音色 TTS | qwen3-tts-flash 为 HTTP 系统音色模型，不支持声音复刻 | https://help.aliyun.com/zh/model-studio/tts-model |
| 声音复刻 | qwen3-tts-vc-2026-01-22 为 HTTP 声音复刻模型 | https://help.aliyun.com/zh/model-studio/tts-model |
| Kimi MCP | 支持 stdio、HTTP、SSE；项目配置可放在 `.kimi-code/mcp.json` | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html |
| Kimi Skills/Plugin | 支持 Agent Skills；Plugin 可声明 Skills 与 MCP | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html |
| Codex Skills/Plugin | Skill 遵循开放 Agent Skills 格式；分发时可用包含 Skills 与 MCP 的 Plugin | https://developers.openai.com/plugins/ |

## 必须保持为“待探测”的事实

- 某个具体 Token Plan SKU 是否开放某个语音或声音复刻模型。
- 用户当前额度、并发、活动价格和折扣。
- 模型是否已下架或被新快照替换。
- 当前 Key 对某个模型的权限。

这些信息不能仅靠静态文档决定，必须通过当前 Key 运行安全、低成本的 capability probe。

## 从现有 OpenClaw 实现发现的迁移风险

| 发现 | 新项目处理 |
|---|---|
| 图片默认模型硬编码为 `wan2.7-image`，官方示例默认值不同 | 默认值放入可更新注册表 |
| 视频脚本只允许 `happyhorse-1.1-t2v` | Provider contract 支持能力枚举 |
| 视频脚本把 duration 限制为 1–10，而官方页面列出 3–15 秒 | 参数来自注册表和 probe，不散落在脚本 |
| 语音会在 Token Plan 与普通百炼 Key 之间切换 | UI 显示明确 credential route，不静默切换 |
| OpenClaw 状态写入私有目录 | 状态迁入独立数据库与 artifact store |

