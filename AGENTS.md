# AGENTS.md

## 项目原则

- 默认使用中文维护用户可见文档；公共接口、Schema 和代码标识使用英文。
- `model-registry/` 是模型能力与官方来源的唯一事实入口，Skill 不重复硬编码模型参数。
- Agent 适配器必须保持薄：不得各自实现一套图片、视频或语音调用逻辑。
- MCP、CLI 和 Dashboard 必须调用同一个 `packages/core`。
- 所有外部模型能力先区分 `documented`、`probe_required`、`verified`、`unavailable`。
- 禁止把聊天记录当作任务或产物的唯一存储。

## 公共仓库安全

- 禁止提交真实 Key、Authorization Header、声音样本、克隆音色 ID、临时下载 URL和私人生成媒体。
- 示例只能使用占位符，例如 `sk-sp-***`。
- 声音复刻流程必须要求显式授权。
- 默认服务只监听回环地址；改变监听范围必须单独评审。

## 交付边界

- 当前阶段是产品定义和可验证架构，不把文档草案描述成已实现功能。
- 实现阶段必须为 provider contract、模型注册表校验、密钥存储和产物 manifest 添加测试。

