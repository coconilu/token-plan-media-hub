import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ArtifactStore,
  FileCredentialVault,
  MediaService,
  SqliteStateStore,
  type ModelRegistry,
  type ProviderAdapter,
  type SecretProtector,
} from "@token-plan-media-hub/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/app.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

class TestProtector implements SecretProtector {
  async protect(value: string) {
    return Buffer.from(value).toString("base64");
  }
  async unprotect(value: string) {
    return Buffer.from(value, "base64").toString("utf8");
  }
}

const registry: ModelRegistry = {
  provider: "fixture",
  region: "local",
  verifiedAt: "2026-07-25",
  models: [
    {
      id: "fixture-image",
      capabilities: ["image.generate"],
      recommendedFor: ["image.generate"],
      credentialModes: ["token_plan"],
      availability: "documented",
      execution: "sync",
      parameters: {
        "image.generate": {
          type: "object",
          properties: { prompt: { type: "string", minLength: 1 } },
          required: ["prompt"],
          additionalProperties: false,
        },
      },
      source: { url: "https://example.test", verifiedAt: "2026-07-25" },
    },
  ],
};

const provider: ProviderAdapter = {
  id: "fixture-provider",
  async submit() {
    return {
      kind: "completed",
      outputs: [
        {
          kind: "media",
          mimeType: "image/png",
          filename: "fixture.png",
          data: Buffer.from("fixture-image"),
        },
      ],
    };
  },
  async getJob(_context, providerTaskId) {
    return { state: "running", providerTaskId };
  },
  async probe() {
    return { status: "verified", checkedAt: "2026-07-25T00:00:00.000Z" };
  },
};

describe("local HTTP API", () => {
  it("serves health, submits through MediaService, and streams artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "tp-media-server-"));
    temporaryPaths.push(root);
    const state = new SqliteStateStore(join(root, "config.db"));
    const vault = new FileCredentialVault(
      join(root, "credentials.json"),
      new TestProtector(),
    );
    const artifacts = new ArtifactStore(join(root, "artifacts"), state);
    const service = new MediaService({
      registry,
      provider,
      state,
      vault,
      artifacts,
    });
    const copiedCredentials: string[] = [];
    const desktopCopyToken =
      "synthetic-desktop-copy-token-000000000000000000000000";
    await service.setCredential("token_plan", "sk-sp-synthetic");
    const app = await buildServer({
      repositoryRoot: root,
      service,
      state,
      desktopCredentialCopy: {
        token: desktopCopyToken,
        async writeText(value) {
          copiedCredentials.push(value);
        },
      },
    });

    try {
      expect((await app.inject({ url: "/api/health" })).json()).toMatchObject({
        ok: true,
        mode: "real",
        service: "token-plan-media-hub",
        gateway: {
          apiVersion: 1,
          transport: "loopback-http",
        },
      });
      expect((await app.inject({ url: "/api/agents" })).json()).toMatchObject({
        agents: [
          { id: "codex", transport: "stdio MCP" },
          { id: "claude-code", transport: "stdio MCP" },
          { id: "kimi-code", transport: "stdio MCP" },
        ],
        repositoryLauncher: {
          gatewayDiscovery: "automatic",
        },
      });
      expect((await app.inject({ url: "/api/runtime" })).json()).toEqual({
        mode: "real",
        configurable: false,
      });
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/runtime",
            payload: { mode: "real" },
          })
        ).statusCode,
      ).toBe(404);
      const tauriPreflight = await app.inject({
        method: "OPTIONS",
        url: "/api/credentials/token_plan",
        headers: {
          origin: "http://tauri.localhost",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
      });
      expect(tauriPreflight.statusCode).toBe(204);
      expect(tauriPreflight.headers["access-control-allow-origin"]).toBe(
        "http://tauri.localhost",
      );
      expect(tauriPreflight.headers["access-control-allow-methods"]).toContain(
        "PUT",
      );
      expect(tauriPreflight.headers["access-control-allow-methods"]).toContain(
        "DELETE",
      );
      expect(tauriPreflight.headers["access-control-allow-headers"]).toBe(
        "content-type",
      );
      const copyPreflight = await app.inject({
        method: "OPTIONS",
        url: "/api/credentials/token_plan/copy",
        headers: {
          origin: "http://tauri.localhost",
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-tp-media-desktop-token",
        },
      });
      expect(copyPreflight.statusCode).toBe(204);
      expect(copyPreflight.headers["access-control-allow-origin"]).toBe(
        "http://tauri.localhost",
      );
      expect(copyPreflight.headers["access-control-allow-headers"]).toBe(
        "x-tp-media-desktop-token",
      );
      const rejectedOrigin = await app.inject({
        method: "OPTIONS",
        url: "/api/credentials/token_plan",
        headers: {
          origin: "https://untrusted.example",
          "access-control-request-method": "PUT",
        },
      });
      expect(rejectedOrigin.headers["access-control-allow-origin"]).toBeUndefined();
      const savedTokenPlanCredential = await app.inject({
        method: "PUT",
        url: "/api/credentials/token_plan",
        headers: {
          origin: "http://tauri.localhost",
        },
        payload: {
          value: "  sk-sp-cors-regression  ",
        },
      });
      expect(savedTokenPlanCredential.statusCode).toBe(200);
      expect(
        savedTokenPlanCredential.headers["access-control-allow-origin"],
      ).toBe("http://tauri.localhost");
      const tokenPlanMetadata = state.getCredentialReference("token_plan");
      expect(tokenPlanMetadata).toBeDefined();
      expect(await vault.get(tokenPlanMetadata!.reference)).toBe(
        "sk-sp-cors-regression",
      );
      const credentialStatuses = await app.inject({
        url: "/api/credentials",
      });
      expect(credentialStatuses.statusCode).toBe(200);
      expect(credentialStatuses.payload).not.toContain(
        "sk-sp-cors-regression",
      );

      const unauthorizedCopy = await app.inject({
        method: "POST",
        url: "/api/credentials/token_plan/copy",
      });
      expect(unauthorizedCopy.statusCode).toBe(403);
      expect(copiedCredentials).toEqual([]);

      const wrongTokenCopy = await app.inject({
        method: "POST",
        url: "/api/credentials/token_plan/copy",
        headers: {
          "x-tp-media-desktop-token": "wrong-token",
        },
      });
      expect(wrongTokenCopy.statusCode).toBe(403);
      expect(copiedCredentials).toEqual([]);

      const authorizedCopy = await app.inject({
        method: "POST",
        url: "/api/credentials/token_plan/copy",
        headers: {
          origin: "http://tauri.localhost",
          "x-tp-media-desktop-token": desktopCopyToken,
        },
      });
      expect(authorizedCopy.statusCode).toBe(200);
      expect(authorizedCopy.json()).toEqual({ copied: true });
      expect(authorizedCopy.payload).not.toContain("sk-sp-cors-regression");
      expect(copiedCredentials).toEqual(["sk-sp-cors-regression"]);

      const savedCredential = await app.inject({
        method: "PUT",
        url: "/api/credentials/dashscope",
        headers: {
          origin: "http://tauri.localhost",
        },
        payload: {
          value: "  sk-ws-synthetic.payload_with-dots.signature  ",
        },
      });
      expect(savedCredential.statusCode).toBe(200);
      expect(savedCredential.headers["access-control-allow-origin"]).toBe(
        "http://tauri.localhost",
      );
      expect(savedCredential.json()).toMatchObject({
        kind: "dashscope",
        configured: true,
        validationStatus: "unverified",
      });
      const credentialMetadata = state.getCredentialReference("dashscope");
      expect(credentialMetadata).toBeDefined();
      expect(await vault.get(credentialMetadata!.reference)).toBe(
        "sk-ws-synthetic.payload_with-dots.signature",
      );

      const rejectedTokenPlanKey = await app.inject({
        method: "PUT",
        url: "/api/credentials/dashscope",
        payload: { value: "sk-sp-synthetic" },
      });
      expect(rejectedTokenPlanKey.statusCode).toBe(401);
      expect(rejectedTokenPlanKey.json()).toMatchObject({
        error: { code: "AUTH_INVALID" },
      });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/jobs",
        payload: {
          capability: "image.generate",
          model: "fixture-image",
          credentialMode: "token_plan",
          parameters: { prompt: "fixture" },
          clientName: "test-client",
          clientKind: "mcp",
        },
      });
      expect(submitted.statusCode).toBe(202);
      const job = submitted.json<{
        status: string;
        client: { kind: string };
        artifactIds: string[];
      }>();
      expect(job).toMatchObject({
        status: "succeeded",
        client: { kind: "mcp" },
      });

      const content = await app.inject({
        url: `/api/artifacts/${job.artifactIds[0]}/content`,
      });
      expect(content.statusCode).toBe(200);
      expect(content.headers["content-type"]).toContain("image/png");
      expect(content.rawPayload.toString()).toBe("fixture-image");

      const textArtifact = await artifacts.save({
        jobId: "job-text-charset",
        capability: "text.generate",
        provider: "fixture-provider",
        model: "fixture-text",
        credentialMode: "token_plan",
        parameters: { prompt: "中文测试" },
        promptOrText: "中文测试",
        mimeType: "text/markdown",
        outputFilename: "fixture.md",
        output: Buffer.from("# 演示文本\n\n中文内容正常显示。", "utf8"),
        providerResponseSummary: { kind: "completed" },
      });
      const textContent = await app.inject({
        url: `/api/artifacts/${textArtifact.artifactId}/content`,
      });
      expect(textContent.statusCode).toBe(200);
      expect(textContent.headers["content-type"]).toContain(
        "text/markdown; charset=utf-8",
      );
      expect(textContent.rawPayload.toString("utf8")).toContain(
        "中文内容正常显示",
      );
    } finally {
      await app.close();
      state.close();
    }
  });
});
