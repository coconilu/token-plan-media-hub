# CLI

稳定 JSON 命令行入口。除 Registry 本地校验外，所有命令连接 `http://127.0.0.1:4317` 的统一服务。

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

用 `--api <url>` 或 `TP_MEDIA_URL` 覆盖地址。CLI 不接受 Key；凭据只能在本地 Dashboard 配置。
