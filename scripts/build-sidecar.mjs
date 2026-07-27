import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exec as packageExecutable } from "@yao-pkg/pkg";
import { build } from "esbuild";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8",
}).trim();
const extension = process.platform === "win32" ? ".exe" : "";
const target = pkgTarget();
const outputDirectory = join(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "binaries",
);
await mkdir(outputDirectory, { recursive: true });
await buildSidecar({
  name: "token-plan-media-server",
  entryPoint: join(
    repositoryRoot,
    "packages",
    "server",
    "src",
    "main.ts",
  ),
  external: ["node:sqlite"],
});
await buildSidecar({
  name: "token-plan-media-mcp",
  entryPoint: join(
    repositoryRoot,
    "packages",
    "mcp-server",
    "src",
    "main.ts",
  ),
  external: [],
});

async function buildSidecar({ name, entryPoint, external }) {
  const bundlePath = join(outputDirectory, `${name}.cjs`);
  const executablePath = join(
    outputDirectory,
    `${name}-${targetTriple}${extension}`,
  );
  await build({
    entryPoints: [entryPoint],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    sourcemap: false,
    minify: false,
    packages: "bundle",
    external,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
  await packageExecutable([
    bundlePath,
    "--targets",
    target,
    "--output",
    executablePath,
    "--compress",
    "GZip",
  ]);
  process.stdout.write(`Desktop sidecar ready: ${executablePath}\n`);
}

function pkgTarget() {
  const architecture =
    process.arch === "x64"
      ? "x64"
      : process.arch === "arm64"
        ? "arm64"
        : undefined;
  const platform =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "macos"
        : process.platform === "linux"
          ? "linux"
          : undefined;
  if (architecture === undefined || platform === undefined) {
    throw new Error(
      `Unsupported desktop sidecar target: ${process.platform}/${process.arch}`,
    );
  }
  return `node22-${platform}-${architecture}`;
}
