# MCP Server

基于官方 `@modelcontextprotocol/sdk` 的本地 stdio Server。它是薄工具层，通过回环 HTTP 服务进入同一个 Media Core。

```powershell
pnpm build
pnpm start
node packages/mcp-server/dist/main.js
```

工具：`list_models`、`probe_capability`、`generate_text`、`generate_image`、`generate_video`、`synthesize_speech`、`clone_voice`、`synthesize_with_cloned_voice`、`get_job`、`list_artifacts`。

Key 由本地 credential broker 解析，绝不放入 MCP 配置、参数或返回值。`probe_capability` 与生成工具可能调用外部模型并产生用量；声音复刻的 Schema 强制 `consent=true`。
