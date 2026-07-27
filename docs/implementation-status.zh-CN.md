# 实现状态与本地验证

更新日期：2026-07-26。

## 当前结论

本地端到端 MVP 已完成，应用只保留真实阿里云请求链路。当前仓库没有也不应包含用户 Key，因此“真实 Provider 已实现”不等于“你的 Key 已验证可用”；未配置对应凭据时，生成与探测会明确失败。

| 层 | 状态 | 当前证据 |
|---|---|---|
| 模型事实入口 | 已实现 | Registry Schema、语义校验、参数默认值、官方来源与日期 |
| Media Core | 已实现 | 任务编排、重启恢复、显式路由、下载、SQLite、manifest |
| 凭据与声音安全 | 已实现 | Windows CurrentUser DPAPI、引用隔离、显式授权、样本与音色 ID 脱敏 |
| 阿里云 Provider | 已实现，待用户实测 | 图片、异步视频、TTS、声音复刻、错误归一化 |
| 本地 HTTP API | 已实现 | 回环监听、统一 jobs/artifacts/models/credentials API；runtime 仅提供真实模式兼容读接口 |
| Tauri 桌面应用 | 已实现 | Windows 窗口、随机回环端口、用户级 Gateway 发现文件、HTTP/MCP sidecar、退出清理、WebView2 麦克风权限请求 |
| Dashboard UI | 已实现 | 桌面布局、真实生成、预览、历史、产物、设置、Agent 安装向导与 5 秒实时连接探测；不承诺 H5 兼容 |
| CLI | 已实现 | Registry、模型、图片/视频/语音、任务与产物；自动发现桌面端口 |
| MCP | 已实现 | 官方 TypeScript SDK、stdio、10 个聚焦工具、独立 EXE、自动发现桌面端口 |
| Codex Adapter | 本地可接入 | Plugin manifest、4 个 Skills、bundled MCP 配置 |
| Claude/Kimi 包装 | 本地可接入 | 根 `.mcp.json` 与 `.kimi-code/mcp.json`；独立市场包不属于本地 MVP |

## 已通过的验收

| 验收项 | 结果 |
|---|---|
| `pnpm build` | TypeScript packages 与 Vite production build 通过 |
| `pnpm test` | 10 个测试文件、26 个测试；不访问外部模型 |
| `pnpm check:desktop` | sidecar 自包含打包、Vite 构建、Tauri Windows 可执行文件通过 |
| `pnpm desktop:portable` | 生成包含主程序、sidecar、模型资源、哈希 manifest 和中文说明的免安装 ZIP |
| Registry | 已提交模型目录通过 Schema 与语义校验 |
| API 真实路由约束 | 无凭据失败、显式凭据路由、任务与产物链路由自动测试覆盖；未在仓库测试中调用外部模型 |
| MCP | 初始化与工具枚举链路已实现；真实生成仍需用当前用户凭据验收 |
| Tauri 实机 | 桌面窗口、动态 API 端点、历史数据、声音复刻页和麦克风权限请求通过 |
| sidecar | 自包含 EXE 的 `/api/health` 通过；主程序退出与异常退出均有清理路径 |

测试覆盖 Provider contract、注册表默认值、能力探测、DPAPI、SQLite、任务服务、声音授权与脱敏、artifact 原子写入和 HTTP API。

## 仍需用户凭据才能验证

- Token Plan Key 对 `wan2.7-image` 与 `happyhorse-1.1-t2v` 的当前权限和额度。
- Token Plan SKU 是否开放所选 TTS / 声音复刻模型。
- 普通百炼 Key 对 `qwen3-tts-flash` 和 `qwen3-tts-vc-2026-01-22` 的权限。
- 云端实际延迟、并发、计费和临时下载 URL 有效期。

这些状态只能由当前 Key 做真实 probe 得出，不能靠文档推断。

## 验证命令

```powershell
pnpm install
pnpm check
pnpm check:desktop
pnpm desktop:dev
```

开发态 `runtime/` 包含本机数据库、加密凭据和私人产物，已由 `.gitignore` 排除。安装版改用当前用户的 Tauri 应用数据目录。首次点击“开始录音”时，需要用户亲自允许 WebView2 麦克风权限。
