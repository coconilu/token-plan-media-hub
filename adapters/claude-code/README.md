# Claude Code Adapter

仓库根目录的 `.mcp.json` 已注册 `token-plan-media-hub` stdio Server。先执行：

```powershell
pnpm install
pnpm build
pnpm start
```

再从仓库根目录启动 Claude Code。Claude 只看到 MCP 工具，不接触 Key；Key 由 Dashboard 的本地凭据中心管理。需要 Skill 时可复用 `adapters/codex/token-plan-media-hub/skills/` 中的开放 Agent Skills 文件，不复制业务逻辑。
