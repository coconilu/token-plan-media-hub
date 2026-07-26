# 实现状态与本地验证

更新日期：2026-07-25。

## 当前结论

本地端到端 MVP 已完成，可以在无 Key 的演示模式完整体验。真实阿里云请求链路已经实现，但当前仓库没有也不应包含用户 Key，因此“真实 Provider 已实现”不等于“你的 Key 已验证可用”。

| 层 | 状态 | 当前证据 |
|---|---|---|
| 模型事实入口 | 已实现 | Registry Schema、语义校验、参数默认值、官方来源与日期 |
| Media Core | 已实现 | 任务编排、重启恢复、显式路由、下载、SQLite、manifest |
| 凭据与声音安全 | 已实现 | Windows CurrentUser DPAPI、引用隔离、显式授权、样本与音色 ID 脱敏 |
| 阿里云 Provider | 已实现，待用户实测 | 图片、异步视频、TTS、声音复刻、错误归一化 |
| 本地 HTTP API | 已实现 | 回环监听、统一 jobs/artifacts/models/credentials/runtime API |
| Dashboard | 已实现 | 桌面/移动布局、演示/真实模式、生成预览、历史、产物、设置 |
| CLI | 已实现 | Registry、模型、运行模式、图片/视频/语音、任务与产物 |
| MCP | 已实现 | 官方 TypeScript SDK、stdio、9 个聚焦工具、真实握手 smoke test |
| Codex Adapter | 本地可接入 | Plugin manifest、4 个 Skills、bundled MCP 配置 |
| Claude/Kimi 包装 | 本地可接入 | 根 `.mcp.json` 与 `.kimi-code/mcp.json`；独立市场包不属于本地 MVP |

## 已通过的验收

| 验收项 | 结果 |
|---|---|
| `pnpm build` | TypeScript packages 与 Vite production build 通过 |
| `pnpm test` | 9 个测试文件、19 个测试；不访问外部模型 |
| Registry | 已提交模型目录通过 Schema 与语义校验 |
| API 演示链路 | 图片、异步视频、系统语音、声音复刻、复刻音色合成均成功 |
| MCP | 初始化成功，枚举 9 个工具，实际调用 `generate_image` 成功 |
| 浏览器 | 桌面与移动布局、图片生成、视频轮询、设置页、移动导航通过 |
| 浏览器日志 | 无 console error / warning |

测试覆盖 Provider contract、注册表默认值、能力探测、DPAPI、SQLite、任务服务、声音授权与脱敏、artifact 原子写入和 HTTP API。

## 仍需用户凭据才能验证

- Token Plan Key 对 `wan2.7-image` 与 `happyhorse-1.1-t2v` 的当前权限和额度。
- Token Plan SKU 是否开放所选 TTS / 声音复刻模型。
- 普通百炼 Key 对 `qwen3-tts-flash` 和 `qwen3-tts-vc-2026-01-22` 的权限。
- 云端实际延迟、并发、计费和临时下载 URL 有效期。

这些状态只能由当前 Key 做真实 probe 得出，不能靠文档或演示 Provider 推断。

## 验证命令

```powershell
pnpm install
pnpm check
pnpm start
```

打开 <http://127.0.0.1:4317>。`runtime/` 包含本机数据库、加密凭据和私人产物，已由 `.gitignore` 排除。
