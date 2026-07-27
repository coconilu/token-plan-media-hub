import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { AliyunTokenPlanProvider } from "@token-plan-media-hub/aliyun-token-plan";
import {
  ArtifactStore,
  DpapiSecretProtector,
  FileCredentialVault,
  loadRegistry,
  MediaService,
  SqliteStateStore,
} from "@token-plan-media-hub/core";

import { buildServer } from "./app.js";

void main().catch((error: unknown) => {
  process.stderr.write(
    `Token Plan Media Hub failed to start: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const resourceRoot = resolve(
    options.resourceRoot ??
      process.env.TP_MEDIA_RESOURCE_ROOT ??
      process.cwd(),
  );
  const runtimeRoot = resolve(
    options.dataRoot ??
      process.env.TP_MEDIA_DATA_ROOT ??
      join(resourceRoot, "runtime"),
  );
  await mkdir(runtimeRoot, { recursive: true });

  const registry = await loadRegistry(
    join(resourceRoot, "model-registry", "aliyun-token-plan.json"),
    join(resourceRoot, "model-registry", "model-registry.schema.json"),
  );
  const state = new SqliteStateStore(join(runtimeRoot, "config.db"));
  const vault = new FileCredentialVault(
    join(runtimeRoot, "credentials.json"),
    new DpapiSecretProtector(),
  );
  const artifacts = new ArtifactStore(join(runtimeRoot, "artifacts"), state);
  const service = new MediaService({
    registry,
    provider: new AliyunTokenPlanProvider(),
    state,
    vault,
    artifacts,
  });

  const context = {
    repositoryRoot: resourceRoot,
    service,
    state,
  };

  const app = await buildServer(context);
  const port = parsePort(
    options.port ?? process.env.TP_MEDIA_PORT ?? "4317",
  );
  await app.listen({ host: "127.0.0.1", port });
  process.stdout.write(
    `Token Plan Media Hub running at http://127.0.0.1:${port}\n`,
  );

  const poller = setInterval(async () => {
    const pending = state
      .listJobs(200)
      .filter(
        (job) =>
          job.provider === service.getProviderId() &&
          (job.status === "queued" ||
            job.status === "running" ||
            job.status === "timeout_unknown"),
      );
    await Promise.allSettled(
      pending.map((job) => service.refreshJob(job.id)),
    );
  }, 2_000);
  poller.unref();

  let shuttingDown = false;
  const parentProcessId = options.parentPid;
  const parentPoller =
    parentProcessId === undefined
      ? undefined
      : setInterval(() => {
          if (!isProcessAlive(parentProcessId)) {
            void shutdown();
          }
        }, 750);
  parentPoller?.unref();

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(poller);
    if (parentPoller !== undefined) clearInterval(parentPoller);
    await app.close();
    state.close();
    process.exitCode = 0;
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void shutdown());
  }
}

interface ServerOptions {
  port?: string;
  resourceRoot?: string;
  dataRoot?: string;
  parentPid?: number;
}

function parseOptions(args: string[]): ServerOptions {
  const options: ServerOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (
      (name === "--port" ||
        name === "--resource-root" ||
        name === "--data-root" ||
        name === "--parent-pid") &&
      value === undefined
    ) {
      throw new Error(`${name} requires a value.`);
    }
    if (name === "--port" && value !== undefined) options.port = value;
    if (name === "--resource-root" && value !== undefined) {
      options.resourceRoot = value;
    }
    if (name === "--data-root" && value !== undefined) {
      options.dataRoot = value;
    }
    if (name === "--parent-pid" && value !== undefined) {
      options.parentPid = parseProcessId(value);
    }
    if (
      name === "--port" ||
      name === "--resource-root" ||
      name === "--data-root" ||
      name === "--parent-pid"
    ) {
      index += 1;
    }
  }
  return options;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid loopback port: ${value}`);
  }
  return parsed;
}

function parseProcessId(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid parent process id: ${value}`);
  }
  return parsed;
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
