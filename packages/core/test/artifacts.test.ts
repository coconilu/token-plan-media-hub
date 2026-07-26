import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactStore,
  type ArtifactRecord,
  type ArtifactRepository,
} from "../src/index.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("artifact store", () => {
  it("atomically writes output and a traceable manifest before DB commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "tp-media-artifacts-"));
    temporaryPaths.push(root);
    const committed: ArtifactRecord[] = [];
    const repository: ArtifactRepository = {
      commit: async (record) => {
        await stat(record.localPath);
        await stat(record.manifestPath);
        committed.push(record);
      },
    };
    const store = new ArtifactStore(root, repository);
    const output = Buffer.from("synthetic-media-output");

    const manifest = await store.save({
      artifactId: "artifact_fixture",
      jobId: "job_fixture",
      capability: "image.generate",
      provider: "aliyun-token-plan",
      model: "wan2.7-image",
      credentialMode: "token_plan",
      parameters: { size: "1024*1024" },
      promptOrText: "测试提示词",
      mimeType: "image/png",
      outputFilename: "output.png",
      output,
      providerResponseSummary: { requestId: "request_fixture" },
      createdAt: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(manifest.sha256).toBe(
      createHash("sha256").update(output).digest("hex"),
    );
    expect(manifest.outputFilename).toBe("output.png");
    expect(committed).toHaveLength(1);
    expect(await readFile(manifest.localPath, "utf8")).toBe(
      "synthetic-media-output",
    );
    const manifestText = await readFile(
      join(dirname(manifest.localPath), "manifest.json"),
      "utf8",
    );
    expect(manifestText).toContain('"credentialMode": "token_plan"');
    expect(manifestText).not.toMatch(/authorization|bearer|credentialReference/i);
  });

  it("removes the new artifact directory when repository commit fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "tp-media-artifacts-"));
    temporaryPaths.push(root);
    const store = new ArtifactStore(root, {
      commit: async () => {
        throw new Error("synthetic database failure");
      },
    });

    await expect(
      store.save({
        artifactId: "artifact_rollback",
        jobId: "job_rollback",
        capability: "speech.synthesize",
        provider: "aliyun-token-plan",
        model: "qwen3-tts-flash",
        credentialMode: "dashscope",
        parameters: { text: "test" },
        mimeType: "audio/mpeg",
        outputFilename: "output.mp3",
        output: Buffer.from("audio"),
        providerResponseSummary: {},
        createdAt: new Date("2026-07-25T12:00:00.000Z"),
      }),
    ).rejects.toThrow("synthetic database failure");

    await expect(
      stat(
        join(
          root,
          "2026",
          "07",
          "job_rollback",
          "artifact_rollback",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never removes an existing artifact directory on publish conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "tp-media-artifacts-"));
    temporaryPaths.push(root);
    const existingDirectory = join(
      root,
      "2026",
      "07",
      "job_existing",
      "artifact_existing",
    );
    await mkdir(existingDirectory, { recursive: true });
    const sentinelPath = join(existingDirectory, "sentinel.txt");
    await writeFile(sentinelPath, "must survive", "utf8");
    const store = new ArtifactStore(root, { commit: async () => {} });

    await expect(
      store.save({
        artifactId: "artifact_existing",
        jobId: "job_existing",
        capability: "image.generate",
        provider: "aliyun-token-plan",
        model: "wan2.7-image",
        credentialMode: "token_plan",
        parameters: { prompt: "fixture" },
        mimeType: "image/png",
        outputFilename: "output.png",
        output: Buffer.from("new-output"),
        providerResponseSummary: {},
        createdAt: new Date("2026-07-25T12:00:00.000Z"),
      }),
    ).rejects.toThrow();

    expect(await readFile(sentinelPath, "utf8")).toBe("must survive");
  });
});
