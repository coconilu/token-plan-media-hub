import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AliyunTokenPlanProvider,
  DemoMediaProvider,
} from "@token-plan-media-hub/aliyun-token-plan";
import {
  ArtifactStore,
  DpapiSecretProtector,
  FileCredentialVault,
  loadRegistry,
  MediaService,
  SqliteStateStore,
} from "@token-plan-media-hub/core";

import { buildServer, type RuntimeMode } from "./app.js";

const repositoryRoot = resolve(process.cwd());
const runtimeRoot = join(repositoryRoot, "runtime");
await mkdir(runtimeRoot, { recursive: true });

const registry = await loadRegistry(
  join(repositoryRoot, "model-registry", "aliyun-token-plan.json"),
  join(repositoryRoot, "model-registry", "model-registry.schema.json"),
);
const state = new SqliteStateStore(join(runtimeRoot, "config.db"));
const vault = new FileCredentialVault(
  join(runtimeRoot, "credentials.json"),
  new DpapiSecretProtector(),
);
const artifacts = new ArtifactStore(join(runtimeRoot, "artifacts"), state);
const demoService = new MediaService({
  registry,
  provider: new DemoMediaProvider({
    assetDirectory: join(
      repositoryRoot,
      "providers",
      "aliyun-token-plan",
      "assets",
    ),
  }),
  state,
  vault,
  artifacts,
  credentialRequired: false,
});
const realService = new MediaService({
  registry,
  provider: new AliyunTokenPlanProvider(),
  state,
  vault,
  artifacts,
});

const settingsPath = join(runtimeRoot, "settings.json");
let mode = await loadMode(settingsPath);
const context = {
  repositoryRoot,
  demoService,
  realService,
  state,
  get mode() {
    return mode;
  },
  async setMode(next: RuntimeMode) {
    mode = next;
    await writeFile(
      settingsPath,
      `${JSON.stringify({ mode }, null, 2)}\n`,
      "utf8",
    );
  },
};

const app = await buildServer(context);
const port = Number(process.env.TP_MEDIA_PORT ?? 4317);
await app.listen({ host: "127.0.0.1", port });
process.stdout.write(
  `Token Plan Media Hub running at http://127.0.0.1:${port} (${mode})\n`,
);

const poller = setInterval(async () => {
  const pending = state
    .listJobs(200)
    .filter(
      (job) =>
        job.status === "queued" ||
        job.status === "running" ||
        job.status === "timeout_unknown",
    );
  await Promise.allSettled(
    pending.map((job) =>
      (job.provider === "demo" ? demoService : realService).refreshJob(job.id),
    ),
  );
}, 2_000);
poller.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    clearInterval(poller);
    await app.close();
    state.close();
    process.exitCode = 0;
  });
}

async function loadMode(path: string): Promise<RuntimeMode> {
  if (process.env.TP_MEDIA_MODE === "real") return "real";
  if (process.env.TP_MEDIA_MODE === "demo") return "demo";
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      mode?: RuntimeMode;
    };
    return parsed.mode === "real" ? "real" : "demo";
  } catch {
    return "demo";
  }
}
