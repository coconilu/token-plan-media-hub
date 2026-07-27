import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
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

import {
  type CodexIntegrationAction,
  type CodexIntegrationManager,
} from "./codex-integration.js";

export interface ServerContext {
  repositoryRoot: string;
  service: MediaService;
  state: SqliteStateStore;
  agentIntegration: {
    manager: CodexIntegrationManager;
    mutationToken?: string;
  };
  desktopCredentialCopy?: {
    token: string;
    writeText: (value: string) => Promise<void>;
  };
}

const DESKTOP_COPY_TOKEN_HEADER = "x-tp-media-desktop-token";

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
  app.post<{ Params: { kind: string } }>(
    "/api/credentials/:kind/copy",
    async (request) => {
      const desktopCopy = context.desktopCredentialCopy;
      if (
        desktopCopy === undefined ||
        !matchesDesktopToken(
          request.headers[DESKTOP_COPY_TOKEN_HEADER],
          desktopCopy.token,
        )
      ) {
        throw desktopAuthorizationError();
      }
      await context.service.copyCredential(
        credentialKind(request.params.kind),
        desktopCopy.writeText,
      );
      return { copied: true };
    },
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

  app.get("/api/agents", async () => ({
    agents: [await context.agentIntegration.manager.snapshot()],
    task: context.agentIntegration.manager.task(),
  }));

  app.get<{ Params: { id: string } }>(
    "/api/agents/tasks/:id",
    async (request, reply) => {
      const task = context.agentIntegration.manager.task(request.params.id);
      return task === undefined
        ? reply.status(404).send({
            ok: false,
            error: {
              code: "AGENT_TASK_NOT_FOUND",
              message: "Codex 接入任务不存在或服务已经重启。",
              retryable: false,
            },
          })
        : task;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { action: CodexIntegrationAction };
  }>("/api/agents/:id/actions", async (request, reply) => {
    if (request.params.id !== "codex") {
      throw integrationRequestError(
        "AGENT_NOT_SUPPORTED",
        "当前版本仅支持真实 Codex 接入。",
      );
    }
    if (!isCodexIntegrationAction(request.body.action)) {
      throw integrationRequestError(
        "AGENT_ACTION_INVALID",
        "不支持的 Codex 接入操作。",
      );
    }
    const mutationToken = context.agentIntegration.mutationToken;
    if (
      mutationToken === undefined ||
      !matchesDesktopToken(
        request.headers[DESKTOP_COPY_TOKEN_HEADER],
        mutationToken,
      )
    ) {
      throw desktopAuthorizationError(
        "仅允许 Token Plan Media Hub 桌面应用修改 Codex 配置。",
      );
    }
    return reply
      .status(202)
      .send(context.agentIntegration.manager.start(request.body.action));
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

function matchesDesktopToken(
  supplied: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof supplied !== "string") return false;
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

function desktopAuthorizationError(
  message = "仅允许当前桌面应用复制已保存的 Key。",
): Error & { code: string } {
  return Object.assign(
    new Error(message),
    { code: "DESKTOP_AUTH_REQUIRED" },
  );
}

function isCodexIntegrationAction(
  value: unknown,
): value is CodexIntegrationAction {
  return (
    value === "install" ||
    value === "update" ||
    value === "repair" ||
    value === "uninstall" ||
    value === "rollback"
  );
}

function integrationRequestError(
  code: string,
  message: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
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
  if (code === "DESKTOP_AUTH_REQUIRED") return 403;
  if (code === "AUTH_INVALID") return 401;
  if (code === "AGENT_TASK_NOT_FOUND") return 404;
  if (
    code === "AGENT_TASK_RUNNING" ||
    code === "AGENT_CONFIG_CHANGED"
  ) {
    return 409;
  }
  if (
    code === "PARAMETER_INVALID" ||
    code === "CONSENT_REQUIRED" ||
    code === "MODEL_UNAVAILABLE" ||
    code === "AGENT_ACTION_INVALID" ||
    code === "AGENT_NOT_SUPPORTED" ||
    code === "AGENT_NOT_INSTALLED" ||
    code === "AGENT_BACKUP_UNAVAILABLE"
  ) {
    return 400;
  }
  return 500;
}
