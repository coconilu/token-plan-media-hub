# CLI

稳定 JSON 命令行入口。除 Registry 本地校验外，所有命令优先读取桌面端发布的用户级 `agent-gateway.json`，连接当前随机回环端口。

```powershell
node packages/cli/dist/main.js runtime get
node packages/cli/dist/main.js models list --capability image.generate
node packages/cli/dist/main.js image generate --prompt "山间湖泊"
node packages/cli/dist/main.js text generate --prompt "写一段项目简介"
node packages/cli/dist/main.js video generate --prompt "镜头缓慢推进"
node packages/cli/dist/main.js speech synthesize --text "你好"
node packages/cli/dist/main.js jobs list
node packages/cli/dist/main.js artifacts list
```

解析顺序为 `--api` → `TP_MEDIA_URL` → `TP_MEDIA_GATEWAY_FILE` / 默认发现文件 → 开发回退 `http://127.0.0.1:4317`。所有地址都必须是带端口的 `http://127.0.0.1` Origin。CLI 不接受 Key；凭据只能在本地 Dashboard 配置。
