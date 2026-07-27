import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type {
  Capability,
  CredentialMode,
  MediaService,
  SqliteStateStore,
} from "@token-plan-media-hub/core";
import Fastify, { type FastifyInstance } from "fastify";

export interface ServerContext {
  repositoryRoot: string;
  service: MediaService;
  state: SqliteStateStore;
}

export async function buildServer(
  context: ServerContext,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 30 * 1024 * 1024,
  });

  await app.register(fastifyCors, {
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      if (
        origin === undefined ||
        origin === "tauri://localhost" ||
        origin === "http://tauri.localhost" ||
        origin === "https://tauri.localhost" ||
        origin === "http://127.0.0.1:4318"
      ) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed."), false);
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as {
      code?: string;
      message?: string;
      retryable?: boolean;
      requestId?: string;
      providerTaskId?: string;
    };
    reply.status(statusForError(candidate.code)).send({
      ok: false,
      error: {
        code: candidate.code ?? "INTERNAL_ERROR",
        message: candidate.message ?? "Unexpected server error",
        retryable: candidate.retryable ?? false,
        ...(candidate.requestId === undefined
          ? {}
          : { requestId: candidate.requestId }),
        ...(candidate.providerTaskId === undefined
          ? {}
          : { providerTaskId: candidate.providerTaskId }),
      },
    });
  });

  app.get("/api/health", async (request) => {
    const localPort = request.socket.localPort;
    return {
      ok: true,
      service: "token-plan-media-hub",
      mode: "real",
      checkedAt: new Date().toISOString(),
      gateway: {
        apiVersion: 1,
        transport: "loopback-http",
        ...(localPort === undefined
          ? {}
          : { origin: `http://127.0.0.1:${localPort}` }),
      },
    };
  });

  app.get("/api/runtime", async () => ({ mode: "real", configurable: false }));

  app.get("/api/models", async () => ({
    registry: context.service.getRegistry(),
    preferences: context.service.listPreferences(),
    probes: context.service.listProbes(),
  }));

  app.get("/api/credentials", async () => ({
    credentials: context.service.getCredentialStatuses(),
  }));
  app.put<{ Params: { kind: string }; Body: { value: string } }>(
    "/api/credentials/:kind",
    async (request) => {
      const kind = credentialKind(request.params.kind);
      return context.service.setCredential(kind, request.body.value);
    },
  );
  app.delete<{ Params: { kind: string } }>(
    "/api/credentials/:kind",
    async (request) => ({
      deleted: await context.service.deleteCredential(
        credentialKind(request.params.kind),
      ),
    }),
  );

  app.post<{
    Body: {
      capability: Capability;
      model: string;
      credentialMode: CredentialMode;
    };
  }>("/api/probes", async (request) =>
    context.service.probe({
      capability: request.body.capability,
      model: request.body.model,
      credentialMode: request.body.credentialMode,
    }),
  );

  app.put<{
    Body: {
      capability: Capability;
      modelId: string;
      credentialMode: CredentialMode;
    };
  }>("/api/preferences", async (request) =>
    context.service.savePreference(
      request.body.capability,
      request.body.modelId,
      request.body.credentialMode,
    ),
  );

  app.post<{
    Body: {
      capability: Capability;
      model: string;
      credentialMode: CredentialMode;
      parameters: Record<string, import("@token-plan-media-hub/core").JsonValue>;
      clientName?: string;
      clientKind?: "dashboard" | "cli" | "mcp";
    };
  }>("/api/jobs", async (request, reply) => {
    const job = await context.service.submit({
      capability: request.body.capability,
      model: request.body.model,
      credentialMode: request.body.credentialMode,
      parameters: request.body.parameters,
      client: {
        kind: request.body.clientKind ?? "dashboard",
        name: request.body.clientName ?? "local-dashboard",
      },
    });
    return reply.status(202).send(job);
  });

  app.get<{ Querystring: { limit?: string } }>(
    "/api/jobs",
    async (request) => ({
      jobs: context.state.listJobs(parseLimit(request.query.limit)),
    }),
  );
  app.get<{
    Params: { id: string };
    Querystring: { refresh?: string };
  }>("/api/jobs/:id", async (request, reply) => {
    let job = context.state.getJob(request.params.id);
    if (job === undefined) return reply.status(404).send({ ok: false });
    if (
      request.query.refresh === "1" &&
      job.provider === context.service.getProviderId()
    ) {
      job = await context.service.refreshJob(job.id);
    }
    return job;
  });

  app.get<{ Querystring: { limit?: string } }>(
    "/api/artifacts",
    async (request) => {
      const records = context.state.listArtifacts(
        parseLimit(request.query.limit),
      );
      const artifacts = await Promise.all(records.map(readArtifact));
      return { artifacts };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/artifacts/:id",
    async (request, reply) => {
      const record = context.state.getArtifact(request.params.id);
      if (record === undefined) return reply.status(404).send({ ok: false });
      return readArtifact(record);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/artifacts/:id/content",
    async (request, reply) => {
      const record = context.state.getArtifact(request.params.id);
      if (record === undefined) return reply.status(404).send({ ok: false });
      const manifest = await readManifest(record.manifestPath);
      reply.header("Content-Type", artifactContentType(manifest.mimeType));
      reply.header("Cache-Control", "private, max-age=3600");
      return reply.send(createReadStream(record.localPath));
    },
  );

  app.get("/api/voices", async () => ({
    voices: context.service.listVoices(),
  }));

  app.get("/api/agents", async () => {
    const repositoryMcpEntry = join(
      context.repositoryRoot,
      "packages",
      "mcp-server",
      "dist",
      "main.js",
    );
    const repositoryLauncherAvailable = await fileExists(repositoryMcpEntry);
    return {
      agents: [
      {
        id: "codex",
        name: "Codex",
        transport: "stdio MCP",
        status: repositoryLauncherAvailable ? "ready" : "build_required",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        transport: "stdio MCP",
        status: repositoryLauncherAvailable ? "ready" : "build_required",
      },
      {
        id: "kimi-code",
        name: "Kimi Code CLI",
        transport: "stdio MCP",
        status: repositoryLauncherAvailable ? "ready" : "build_required",
      },
      ],
      repositoryLauncher: {
        available: repositoryLauncherAvailable,
        command: "node",
        args: [repositoryMcpEntry],
        gatewayDiscovery: "automatic",
      },
    };
  });

  const dashboardRoot = join(
    context.repositoryRoot,
    "apps",
    "dashboard",
    "dist",
  );
  try {
    await readFile(join(dashboardRoot, "index.html"));
    await app.register(fastifyStatic, {
      root: dashboardRoot,
      wildcard: false,
    });
    app.get("/*", async (_request, reply) =>
      reply.sendFile("index.html"),
    );
  } catch {
    app.get("/", async (_request, reply) =>
      reply
        .type("text/plain; charset=utf-8")
        .send("Dashboard 尚未构建。请运行 pnpm build。"),
    );
  }

  return app;
}

function credentialKind(value: string): "token_plan" | "dashscope" {
  if (value === "token_plan" || value === "dashscope") return value;
  throw new Error("credential kind must be token_plan or dashscope");
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value ?? 100);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 500)
    : 100;
}

async function readArtifact(
  record: import("@token-plan-media-hub/core").ArtifactRecord,
) {
  const manifest = await readManifest(record.manifestPath);
  return {
    ...record,
    manifest,
    contentUrl: `/api/artifacts/${encodeURIComponent(record.artifactId)}/content`,
  };
}

async function readManifest(path: string) {
  return JSON.parse(
    await readFile(path, "utf8"),
  ) as import("@token-plan-media-hub/core").ArtifactManifest;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function artifactContentType(mimeType: string): string {
  if (
    mimeType.toLowerCase().startsWith("text/") &&
    !mimeType.toLowerCase().includes("charset=")
  ) {
    return `${mimeType}; charset=utf-8`;
  }
  return mimeType;
}

function statusForError(code: string | undefined): number {
  if (code === "AUTH_INVALID") return 401;
  if (
    code === "PARAMETER_INVALID" ||
    code === "CONSENT_REQUIRED" ||
    code === "MODEL_UNAVAILABLE"
  ) {
    return 400;
  }
  return 500;
}
