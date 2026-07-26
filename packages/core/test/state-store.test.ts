import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactStore,
  FileCredentialVault,
  SqliteStateStore,
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
  async protect(plaintext: string): Promise<string> {
    return Buffer.from(`protected:${plaintext}`).toString("base64");
  }

  async unprotect(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext, "base64")
      .toString("utf8")
      .replace(/^protected:/, "");
  }
}

describe("SQLite state store", () => {
  it("persists only credential references and commits artifact records", async () => {
    const root = await mkdtemp(join(tmpdir(), "tp-media-state-"));
    temporaryPaths.push(root);
    const databasePath = join(root, "config.db");
    const vault = new FileCredentialVault(
      join(root, "private", "credentials.json"),
      new TestProtector(),
    );
    const state = new SqliteStateStore(databasePath);

    try {
      const reference = await vault.set(
        "token_plan",
        "synthetic-secret-never-in-sqlite",
      );
      state.saveCredentialReference({
        kind: "token_plan",
        reference,
        validationStatus: "verified",
        verifiedAt: "2026-07-25T00:00:00.000Z",
      });

      expect(state.getCredentialReference("token_plan")).toEqual({
        kind: "token_plan",
        reference,
        validationStatus: "verified",
        verifiedAt: "2026-07-25T00:00:00.000Z",
      });
      expect(await readFile(databasePath)).not.toContain(
        Buffer.from("synthetic-secret-never-in-sqlite"),
      );

      const artifacts = new ArtifactStore(join(root, "artifacts"), state);
      const manifest = await artifacts.save({
        artifactId: "artifact_sqlite_fixture",
        jobId: "job_sqlite_fixture",
        capability: "image.generate",
        provider: "aliyun-token-plan",
        model: "wan2.7-image",
        credentialMode: "token_plan",
        parameters: { prompt: "fixture" },
        mimeType: "image/png",
        outputFilename: "output.png",
        output: Buffer.from("synthetic-output"),
        providerResponseSummary: {},
        createdAt: new Date("2026-07-25T00:00:00.000Z"),
      });

      expect(state.getArtifact(manifest.artifactId)).toMatchObject({
        artifactId: "artifact_sqlite_fixture",
        jobId: "job_sqlite_fixture",
        sha256: manifest.sha256,
      });
    } finally {
      state.close();
    }
  });
});
