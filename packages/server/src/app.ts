import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import type {
  Capability,
  CredentialMode,
  MediaService,
  SqliteStateStore,
} from "@token-plan-media-hub/core";
import Fastify, { type FastifyInstance } from "fastify";

export type RuntimeMode = "demo" | "real";

export interface ServerContext {
  repositoryRoot: string;
  demoService: MediaService;
  realService: MediaService;
  state: SqliteStateStore;
  mode: RuntimeMode;
  setMode(mode: RuntimeMode): Promise<void>;
}

export async function buildServer(
  context: ServerContext,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 30 * 1024 * 1024,
  });

  const active = () =>
    context.mode === "demo" ? context.demoService : context.realService;

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

  app.get("/api/health", async () => ({
    ok: true,
    service: "token-plan-media-hub",
    mode: context.mode,
  }));

  app.get("/api/runtime", async () => ({ mode: context.mode }));
  app.put<{ Body: { mode: RuntimeMode } }>(
    "/api/runtime",
    async (request) => {
      if (request.body.mode !== "demo" && request.body.mode !== "real") {
        throw new Error("mode must be demo or real");
      }
      await context.setMode(request.body.mode);
      return { mode: context.mode };
    },
  );

  app.get("/api/models", async () => ({
    registry: active().getRegistry(),
    preferences: active().listPreferences(),
    probes: active().listProbes(),
  }));

  app.get("/api/credentials", async () => ({
    credentials: context.realService.getCredentialStatuses(),
  }));
  app.put<{ Params: { kind: string }; Body: { value: string } }>(
    "/api/credentials/:kind",
    async (request) => {
      const kind = credentialKind(request.params.kind);
      return context.realService.setCredential(kind, request.body.value);
    },
  );
  app.delete<{ Params: { kind: string } }>(
    "/api/credentials/:kind",
    async (request) => ({
      deleted: await context.realService.deleteCredential(
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
    active().probe({
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
    active().savePreference(
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
    const job = await active().submit({
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
    if (request.query.refresh === "1") {
      const service =
        job.provider === "demo"
          ? context.demoService
          : context.realService;
      job = await service.refreshJob(job.id);
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
      reply.header("Content-Type", manifest.mimeType);
      reply.header("Cache-Control", "private, max-age=3600");
      return reply.send(createReadStream(record.localPath));
    },
  );

  app.get("/api/voices", async () => ({
    voices: context.realService.listVoices(),
  }));

  app.get("/api/agents", async () => ({
    agents: [
      {
        id: "codex",
        name: "Codex",
        transport: "stdio MCP",
        status: "available",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        transport: "stdio MCP",
        status: "available",
      },
      {
        id: "kimi-code",
        name: "Kimi Code CLI",
        transport: "stdio / HTTP MCP",
        status: "available",
      },
    ],
  }));

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
