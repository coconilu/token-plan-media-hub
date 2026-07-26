# Codex Adapter

`token-plan-media-hub/` 是可运行的本地 Codex Plugin：

- `.codex-plugin/plugin.json`
- `.mcp.json` bundled stdio MCP
- 图片、视频、语音和授权声音复刻四个 Skills

使用前在仓库根目录执行 `pnpm build` 与 `pnpm start`。本地 Plugin 的 MCP wrapper 会加载同仓库的 `packages/mcp-server/dist/main.js`；若要提交公共插件，应把 MCP 部署为稳定 HTTPS Streamable HTTP 服务并重新执行发布验收。
