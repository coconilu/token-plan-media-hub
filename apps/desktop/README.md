# Tauri 桌面应用

`apps/desktop` 是 Token Plan Media Hub 的正式用户界面入口，面向 Windows 桌面，不承诺 H5 兼容。

## 运行

```powershell
pnpm desktop:dev
```

Tauri 启动时会：

1. 选择一个空闲的随机回环端口；
2. 启动自包含的 `token-plan-media-server` sidecar；
3. 将 Dashboard API 请求路由到该 sidecar；
4. 在主程序退出或异常终止后关闭 sidecar。

开发模式继续使用仓库根目录的 `runtime/`，方便复用本机测试数据。安装版使用 Tauri 的 `appLocalDataDir`，不会把数据库、加密凭据、声音样本或生成产物写入安装目录。

## 构建

```powershell
# 快速验证桌面可执行文件，不生成安装器
pnpm check:desktop

# 生成 Windows NSIS 安装包
pnpm desktop:build

# 生成免安装 ZIP（推荐试用与内测）
pnpm desktop:portable
```

sidecar 由 `scripts/build-sidecar.mjs` 使用 esbuild 与 `@yao-pkg/pkg` 构建，不要求最终用户安装 Node.js。

免安装版仍将密钥、数据库和私人媒体放在当前用户的 `appLocalDataDir`，而不是 EXE 旁边。这样解压目录可以安全删除或替换，同时凭据继续由 Windows CurrentUser DPAPI 保护。它是“免安装分发”，不是把敏感状态随 U 盘明文携带的完全便携模式。

## 麦克风

声音复刻页通过 Tauri 的 Windows WebView2 请求麦克风权限。首次录音时，用户必须亲自允许 `http://tauri.localhost` 使用麦克风；应用不会修改 Windows 隐私设置，也不会在未确认授权时提交复刻任务。
