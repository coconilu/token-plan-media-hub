import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveMediaHubGateway } from "../packages/core/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpRequire = createRequire(
  join(repositoryRoot, "packages", "mcp-server", "package.json"),
);
const { Client } = await import(
  pathToFileURL(
    mcpRequire.resolve("@modelcontextprotocol/sdk/client/index.js"),
  ).href
);
const { StdioClientTransport } = await import(
  pathToFileURL(
    mcpRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js"),
  ).href
);
const mcpCommand = resolve(
  process.argv[2] ??
    join(
      repositoryRoot,
      "apps",
      "desktop",
      "src-tauri",
      "target",
      "release",
      process.platform === "win32"
        ? "token-plan-media-mcp.exe"
        : "token-plan-media-mcp",
    ),
);
await access(mcpCommand);

const gateway = await resolveMediaHubGateway();
const startedAt = performance.now();
const healthResponse = await fetch(`${gateway.origin}/api/health`, {
  signal: AbortSignal.timeout(5_000),
});
if (!healthResponse.ok) {
  throw new Error(`Agent Gateway health returned HTTP ${healthResponse.status}`);
}
const health = await healthResponse.json();
if (
  health?.service !== "token-plan-media-hub" ||
  health?.gateway?.transport !== "loopback-http"
) {
  throw new Error("Agent Gateway health identity does not match.");
}

const client = new Client({
  name: "token-plan-media-hub-smoke",
  version: "0.1.0",
});
const transport = new StdioClientTransport({
  command: mcpCommand,
  args: [],
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const models = await client.callTool({
    name: "list_models",
    arguments: {},
  });
  const modelPayload = models.content.find(
    (item) => item.type === "text",
  )?.text;
  if (
    tools.tools.length !== 10 ||
    modelPayload === undefined ||
    !modelPayload.includes('"provider"')
  ) {
    throw new Error("MCP tool list or list_models response is incomplete.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        gateway: {
          origin: gateway.origin,
          source: gateway.source,
          discoveryFile: gateway.discoveryFile,
          pid: gateway.manifest?.pid,
          latencyMs: Math.round(performance.now() - startedAt),
        },
        mcp: {
          command: mcpCommand,
          tools: tools.tools.length,
          listModels: "passed",
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close();
}
