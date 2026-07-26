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
  id: "demo",
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
    const service = new MediaService({
      registry,
      provider,
      state,
      vault,
      artifacts: new ArtifactStore(join(root, "artifacts"), state),
      credentialRequired: false,
    });
    let mode: "demo" | "real" = "demo";
    const app = await buildServer({
      repositoryRoot: root,
      demoService: service,
      realService: service,
      state,
      get mode() {
        return mode;
      },
      async setMode(next) {
        mode = next;
      },
    });

    try {
      expect((await app.inject({ url: "/api/health" })).json()).toMatchObject({
        ok: true,
        mode: "demo",
      });
      const savedCredential = await app.inject({
        method: "PUT",
        url: "/api/credentials/dashscope",
        payload: {
          value: "  sk-ws-synthetic.payload_with-dots.signature  ",
        },
      });
      expect(savedCredential.statusCode).toBe(200);
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
    } finally {
      await app.close();
      state.close();
    }
  });
});
