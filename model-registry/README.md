# Model Registry

模型注册表是能力、参数与官方来源的唯一事实入口。

每个条目必须包含：

- `id`
- `capabilities`
- `recommendedFor`
- `credentialModes`
- `execution`
- `parameters`
- `availability`
- `source.url`
- `source.verifiedAt`

`availability` 只允许：

- `documented`
- `probe_required`
- `verified`
- `unavailable`
- `stale`

用户级 `verified` 结果属于本地数据库，不提交到公共注册表。

`recommendedFor` 按 capability 标记推荐模型。每种 capability 必须且只能有
一个推荐模型，而且推荐项必须同时出现在该模型的 `capabilities` 中。推荐关系由
Registry 校验并由 Dashboard、CLI 与 MCP 共同读取，不在各适配器里重复硬编码。

`parameters` 按 capability 保存受限的 JSON Schema object，不是参数名数组。每个 `capabilities` 成员都必须有且只有一份对应 Schema；它至少描述字段类型、必填项和 `additionalProperties: false`。只有官方来源已确认的枚举或数值边界才能写入注册表。

本地校验：

```powershell
pnpm registry:validate
```

## 云端模型发现

OpenAI 兼容入口的 `GET /compatible-mode/v1/models` 可用于发现当前凭据可见的
候选模型，但它不是本仓库的能力事实入口，也不能替代 Registry：

| 数据 | 云端 `/models` | 本地 Registry |
|---|---:|---:|
| 当前账户可见的模型 ID | 候选发现 | 仅收录已核对模型 |
| 图片、视频、语音的专用接口与参数 | 不完整 | 必须记录 |
| capability、凭据路由、同步/异步 | 不保证 | 必须记录 |
| 官方来源与核对日期 | 不提供 | 必须记录 |
| 每种能力的推荐模型 | 不提供 | 必须且唯一 |

因此，云端返回的新 ID 需要先核对官方来源、接口与参数 Schema，再进入
`aliyun-token-plan.json`。不能把数百个 ID 未经验证地直接展示为“可用模型”。

## Credential mode 显示名与规则

| 注册表值 | Dashboard 显示名 | 路由规则 |
|---|---|---|
| `token_plan` | Token Plan Key | 只使用 Token Plan credential reference |
| `token_plan_probe` | Token Plan Key（需探测） | 先探测，失败后保持失败，不切换 Key |
| `dashscope` | Model Studio API Key（普通百炼 Key） | 只使用标准百炼 credential reference |

`credentialModes` 表示模型允许用户选择的路由集合，不是有序 fallback 列表。模型默认值必须与用户选择的 `credentialMode` 一起保存。
