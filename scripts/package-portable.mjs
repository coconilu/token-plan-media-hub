import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tauriConfig = JSON.parse(
  await readFile(
    join(
      repositoryRoot,
      "apps",
      "desktop",
      "src-tauri",
      "tauri.conf.json",
    ),
    "utf8",
  ),
);
const version = String(tauriConfig.version);
const releaseRoot = join(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
);
const portableRoot = join(releaseRoot, "bundle", "portable");
const packageName = `Token-Plan-Media-Hub_${version}_windows-x64-portable`;
const packageRoot = join(portableRoot, packageName);
const archivePath = join(portableRoot, `${packageName}.zip`);

assertGeneratedPath(packageRoot);
assertGeneratedPath(archivePath);
await rm(packageRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(packageRoot, { recursive: true });

await Promise.all([
  cp(
    join(releaseRoot, "token-plan-media-hub-desktop.exe"),
    join(packageRoot, "Token Plan Media Hub.exe"),
  ),
  cp(
    join(releaseRoot, "token-plan-media-server.exe"),
    join(packageRoot, "token-plan-media-server.exe"),
  ),
  cp(
    join(releaseRoot, "token-plan-media-mcp.exe"),
    join(packageRoot, "token-plan-media-mcp.exe"),
  ),
  cp(join(releaseRoot, "model-registry"), join(packageRoot, "model-registry"), {
    recursive: true,
  }),
  cp(join(releaseRoot, "providers"), join(packageRoot, "providers"), {
    recursive: true,
  }),
]);

await writeFile(
  join(packageRoot, "使用说明.txt"),
  `Token Plan Media Hub ${version} 免安装版

使用方法
1. 解压整个 ZIP，不要只单独复制主程序。
2. 双击“Token Plan Media Hub.exe”。
3. 首次录音时，请在 Windows 麦克风权限提示中点击“允许”。

数据与隐私
- 本程序无需安装，也不要求另行安装 Node.js。
- 密钥、任务历史、声音样本和生成产物不会写在本目录。
- 本机数据保存在当前 Windows 用户的本地应用数据目录，并使用 DPAPI 加密密钥。
- 删除本文件夹不会自动删除本机数据。

运行要求
- Windows 10 或 Windows 11 x64。
- Microsoft Edge WebView2 Runtime。多数受支持的 Windows 系统已预装。

文件说明
- Token Plan Media Hub.exe：桌面主程序
- token-plan-media-server.exe：本地回环 sidecar，请勿删除
- token-plan-media-mcp.exe：Agent 使用的 stdio MCP 启动器，请勿删除
- model-registry/、providers/：模型注册表和演示资源，请勿删除
`,
  "utf8",
);

const files = await collectFiles(packageRoot);
const manifest = {
  product: "Token Plan Media Hub",
  version,
  platform: "windows-x64",
  distribution: "portable",
  generatedAt: new Date().toISOString(),
  files: await Promise.all(
    files.map(async (path) => ({
      path: relative(packageRoot, path).replaceAll("\\", "/"),
      bytes: (await stat(path)).size,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  ),
};
await writeFile(
  join(packageRoot, "portable-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

execFileSync(
  process.platform === "win32" ? "tar.exe" : "tar",
  ["-a", "-c", "-f", archivePath, packageName],
  { cwd: portableRoot, stdio: "inherit" },
);

process.stdout.write(`Portable package ready: ${archivePath}\n`);

async function collectFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      result.push(path);
    }
  }
  return result.sort();
}

function assertGeneratedPath(path) {
  const expectedRoot = resolve(portableRoot);
  const candidate = resolve(path);
  if (
    candidate !== expectedRoot &&
    !candidate.startsWith(`${expectedRoot}\\`)
  ) {
    throw new Error(`Refusing to modify a path outside ${expectedRoot}`);
  }
}
