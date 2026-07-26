# Media Core

Agent-neutral 核心，供 Dashboard、CLI、MCP 与 Provider 共用。

- provider contract 与标准错误
- Registry Schema、语义校验和参数默认值
- 显式 credential route 与 capability probe
- Windows DPAPI 凭据仓库
- SQLite 任务、偏好、探测、授权、音色别名和产物索引
- 同步/异步任务编排、重启恢复和临时媒体下载
- 原子 artifact、SHA-256 与 manifest
- 声音复刻授权前置、参考音频脱敏和音色 ID 加密引用

Agent 适配器不得复制这些逻辑。
