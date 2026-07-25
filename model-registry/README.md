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

