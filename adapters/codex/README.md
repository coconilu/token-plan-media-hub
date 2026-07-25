# Codex Adapter

`token-plan-media-hub/` 是按 Codex Plugin 规范生成的设计期骨架，包含四个聚焦 Skill。

当前 `.mcp.json` 为空，因为 MCP Server 尚未实现。不要把该目录描述成可运行插件；后续里程碑需要：

1. 实现 `packages/mcp-server`；
2. 在 `.mcp.json` 注册本地 stdio 或回环 HTTP 服务；
3. 运行 Plugin 与四个 Skill 校验；
4. 在全新 Codex 会话执行真实生成 smoke test。

