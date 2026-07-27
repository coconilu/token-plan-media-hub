import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactStore,
  FileCredentialVault,
  MediaService,
  SqliteStateStore,
  type ModelRegistry,
  type ProviderAdapter,
  type SecretProtector,
} from "../src/index.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

class TestProtector implements SecretProtector {
  async protect(plaintext: string) {
    return Buffer.from(plaintext).toString("base64");
  }
  async unprotect(ciphertext: string) {
    return Buffer.from(ciphertext, "base64").toString("utf8");
  }
}

const provider: ProviderAdapter = {
  id: "test-provider",
  async submit(_context, request) {
    if (request.capability === "voice.clone") {
      return {
        kind: "completed",
        outputs: [
          {
            kind: "voice",
            providerVoiceId: "private-provider-voice-id",
            targetModel: request.model,
          },
        ],
      };
    }
    return {
      kind: "completed",
      outputs: [
        {
          kind: "media",
          mimeType: "image/png",
          filename: "result.png",
          data: Buffer.from("synthetic-image"),
        },
      ],
    };
  },
  async getJob(_context, providerTaskId) {
    return { state: "running", providerTaskId };
  },
  async probe() {
    return { status: "verified", checkedAt: new Date().toISOString() };
  },
};

const registry: ModelRegistry = {
  provider: "fixture",
  region: "local",
  verifiedAt: "2026-07-25",
  models: [
    {
      id: "image-fixture",
      capabilities: ["image.generate"],
      recommendedFor: ["image.generate"],
      credentialModes: ["token_plan"],
      availability: "documented",
      execution: "sync",
      parameters: {
        "image.generate": {
          type: "object",
          properties: {
            prompt: { type: "string", minLength: 1 },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      },
      source: { url: "https://example.test", verifiedAt: "2026-07-25" },
    },
    {
      id: "voice-fixture",
      capabilities: ["voice.clone", "speech.synthesize_with_clone"],
      recommendedFor: ["voice.clone", "speech.synthesize_with_clone"],
      credentialModes: ["dashscope"],
      availability: "probe_required",
      execution: "sync",
      parameters: {
        "voice.clone": {
          type: "object",
          properties: {
            reference_audio: { type: "string" },
            consent: { type: "boolean" },
            name: { type: "string" },
          },
          required: ["reference_audio", "consent", "name"],
          additionalProperties: false,
        },
        "speech.synthesize_with_clone": {
          type: "object",
          properties: {
            text: { type: "string" },
            voice_alias: { type: "string" },
            language: { type: "string" },
          },
          required: ["text", "voice_alias"],
          additionalProperties: false,
        },
      },
      source: { url: "https://example.test", verifiedAt: "2026-07-25" },
    },
  ],
};

describe("MediaService", () => {
  it("accepts legacy and workspace Model Studio keys without mixing Token Plan routes", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        fixture.service.setCredential(
          "dashscope",
          "  sk-ws-synthetic.payload_with-dots.signature  ",
        ),
      ).resolves.toMatchObject({
        kind: "dashscope",
        configured: true,
        validationStatus: "unverified",
      });
      const metadata = fixture.state.getCredentialReference("dashscope");
      expect(metadata).toBeDefined();
      expect(await fixture.vault.get(metadata!.reference)).toBe(
        "sk-ws-synthetic.payload_with-dots.signature",
      );

      await expect(
        fixture.service.setCredential("dashscope", "sk-legacy_synthetic"),
      ).resolves.toMatchObject({ kind: "dashscope", configured: true });
      await expect(
        fixture.service.setCredential("dashscope", "sk-sp-synthetic"),
      ).rejects.toMatchObject({ code: "AUTH_INVALID" });
      await expect(
        fixture.service.setCredential(
          "token_plan",
          "sk-ws-synthetic.payload.signature",
        ),
      ).rejects.toMatchObject({ code: "AUTH_INVALID" });
    } finally {
      fixture.state.close();
    }
  });

  it("persists a completed provider output and traceable manifest", async () => {
    const fixture = await createFixture();
    try {
      const job = await fixture.service.submit({
        capability: "image.generate",
        model: "image-fixture",
        credentialMode: "token_plan",
        parameters: { prompt: "test prompt" },
        client: { kind: "cli", name: "test" },
      });
      expect(job.status).toBe("succeeded");
      expect(job.artifactIds).toHaveLength(1);
      const record = fixture.state.getArtifact(job.artifactIds[0]!);
      expect(record).toBeDefined();
      expect(await readFile(record!.localPath, "utf8")).toBe(
        "synthetic-image",
      );
    } finally {
      fixture.state.close();
    }
  });

  it("rejects voice cloning without affirmative consent before provider use", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        fixture.service.submit({
          capability: "voice.clone",
          model: "voice-fixture",
          credentialMode: "dashscope",
          parameters: {
            reference_audio: "data:audio/wav;base64,UklGRg==",
            consent: false,
            name: "blocked",
          },
          client: { kind: "mcp", name: "test" },
        }),
      ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
      expect(fixture.state.listJobs()).toHaveLength(0);
    } finally {
      fixture.state.close();
    }
  });

  it("redacts reference audio and provider voice ID from SQLite and manifests", async () => {
    const fixture = await createFixture();
    try {
      const job = await fixture.service.submit({
        capability: "voice.clone",
        model: "voice-fixture",
        credentialMode: "dashscope",
        parameters: {
          reference_audio: "data:audio/wav;base64,UklGRg==",
          consent: true,
          name: "safe-alias",
        },
        client: { kind: "dashboard", name: "test" },
      });
      expect(job.status).toBe("succeeded");
      expect(JSON.stringify(job)).not.toContain("UklGRg==");
      expect(fixture.service.listVoices()).toEqual([
        expect.objectContaining({
          alias: "safe-alias",
          credentialMode: "dashscope",
        }),
      ]);
      await expect(
        fixture.service.submit({
          capability: "speech.synthesize_with_clone",
          model: "voice-fixture",
          credentialMode: "token_plan",
          parameters: {
            text: "route safety",
            voice_alias: "safe-alias",
          },
          client: { kind: "dashboard", name: "test" },
        }),
      ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
      const database = await readFile(fixture.databasePath);
      expect(database).not.toContain(Buffer.from("private-provider-voice-id"));
      expect(database).not.toContain(Buffer.from("UklGRg=="));
    } finally {
      fixture.state.close();
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "tp-media-service-"));
  temporaryPaths.push(root);
  const databasePath = join(root, "config.db");
  const state = new SqliteStateStore(databasePath);
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
  });
  await service.setCredential("token_plan", "sk-sp-synthetic");
  await service.setCredential("dashscope", "sk-ws-synthetic");
  return { root, databasePath, state, vault, service };
}
