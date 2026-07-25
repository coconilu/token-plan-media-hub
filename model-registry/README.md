# Model Registry

模型注册表是能力、参数与官方来源的唯一事实入口。

每个条目必须包含：

- `id`
- `capabilities`
- `credentialModes`
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

## Credential mode 显示名与规则

| 注册表值 | Dashboard 显示名 | 路由规则 |
|---|---|---|
| `token_plan` | Token Plan Key | 只使用 Token Plan credential reference |
| `token_plan_probe` | Token Plan Key（需探测） | 先探测，失败后保持失败，不切换 Key |
| `dashscope` | Model Studio API Key（普通百炼 Key） | 只使用标准百炼 credential reference |

`credentialModes` 表示模型允许用户选择的路由集合，不是有序 fallback 列表。模型默认值必须与用户选择的 `credentialMode` 一起保存。
