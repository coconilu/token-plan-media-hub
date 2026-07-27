# Dashboard

React + Vite 本地控制台，production build 由 Fastify 同源托管：

```powershell
pnpm build
pnpm start
```

打开 <http://127.0.0.1:4317>。

已实现概览、模型、六类生成工作流、历史产物、Agent 接入说明与 DPAPI 凭据设置。历史产物与生成工作台统一按文本、图片、视频、语音、复刻和音色合成分类；声音复刻支持按页面文案直接录音并生成单声道 16-bit WAV，也保留 WAV、MP3 和 M4A 文件上传入口。浏览器不保存或回显完整 Key；所有操作通过本地 HTTP API 进入同一个 Media Core。
