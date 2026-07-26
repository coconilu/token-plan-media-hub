# Alibaba Cloud Model Studio Provider

包含两个薄 Provider：

| Provider | 用途 |
|---|---|
| `AliyunTokenPlanProvider` | Token Plan / DashScope 文本、图片、异步视频、TTS 与声音复刻 HTTP 调用 |
| `DemoMediaProvider` | 无 Key 的本地端到端体验，生成可预览文本、图片、视频和 WAV |

端点映射、鉴权头、异步 task 轮询和阿里云错误归一化位于本包；模型能力、参数、来源和可用状态只来自 `model-registry/`。Provider 不记录 Key 或 Authorization Header。
