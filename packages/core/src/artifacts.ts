import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type {
  Capability,
  CredentialMode,
  JsonValue,
} from "./contracts.js";

export interface ArtifactManifest {
  schemaVersion: 1;
  artifactId: string;
  jobId: string;
  capability: Capability;
  provider: string;
  model: string;
  credentialMode: CredentialMode;
  parameters: Record<string, JsonValue>;
  promptOrText?: string;
  createdAt: string;
  localPath: string;
  mimeType: string;
  outputFilename: string;
  sha256: string;
  sourceJobId?: string;
  consentRecordId?: string;
}

export interface ArtifactRecord {
  artifactId: string;
  jobId: string;
  manifestPath: string;
  localPath: string;
  sha256: string;
  createdAt: string;
}

export interface ArtifactRepository {
  commit(record: ArtifactRecord): Promise<void>;
}

export interface SaveArtifactInput {
  artifactId?: string;
  jobId: string;
  capability: Capability;
  provider: string;
  model: string;
  credentialMode: CredentialMode;
  parameters: Record<string, JsonValue>;
  promptOrText?: string;
  mimeType: string;
  outputFilename: string;
  output: Uint8Array;
  providerResponseSummary: Record<string, JsonValue>;
  sourceJobId?: string;
  consentRecordId?: string;
  createdAt?: Date;
}

export class ArtifactStore {
  constructor(
    private readonly rootPath: string,
    private readonly repository: ArtifactRepository,
  ) {}

  async save(input: SaveArtifactInput): Promise<ArtifactManifest> {
    const createdAt = input.createdAt ?? new Date();
    const artifactId = input.artifactId ?? `artifact_${randomUUID()}`;
    const safeOutputName = assertSafeFilename(input.outputFilename);
    const relativeDirectory = join(
      String(createdAt.getUTCFullYear()),
      String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
      input.jobId,
      artifactId,
    );
    const finalDirectory = join(this.rootPath, relativeDirectory);
    const stagingDirectory = `${finalDirectory}.${randomUUID()}.tmp`;
    const outputPath = join(finalDirectory, safeOutputName);
    const manifestPath = join(finalDirectory, "manifest.json");
    const sha256 = createHash("sha256").update(input.output).digest("hex");

    const manifest: ArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      jobId: input.jobId,
      capability: input.capability,
      provider: input.provider,
      model: input.model,
      credentialMode: input.credentialMode,
      parameters: input.parameters,
      createdAt: createdAt.toISOString(),
      localPath: outputPath,
      mimeType: input.mimeType,
      outputFilename: safeOutputName,
      sha256,
      ...(input.promptOrText === undefined
        ? {}
        : { promptOrText: input.promptOrText }),
      ...(input.sourceJobId === undefined
        ? {}
        : { sourceJobId: input.sourceJobId }),
      ...(input.consentRecordId === undefined
        ? {}
        : { consentRecordId: input.consentRecordId }),
    };

    await mkdir(dirname(finalDirectory), { recursive: true });
    await mkdir(stagingDirectory);
    let published = false;

    try {
      await Promise.all([
        writeJson(
          join(stagingDirectory, "request.json"),
          sanitizedRequest(input),
        ),
        writeJson(
          join(stagingDirectory, "response-summary.json"),
          input.providerResponseSummary,
        ),
        writeJson(join(stagingDirectory, "manifest.json"), manifest),
        writeFile(join(stagingDirectory, safeOutputName), input.output),
      ]);
      await rename(stagingDirectory, finalDirectory);
      published = true;
      await this.repository.commit({
        artifactId,
        jobId: input.jobId,
        manifestPath,
        localPath: outputPath,
        sha256,
        createdAt: manifest.createdAt,
      });
      return manifest;
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (published) {
        await rm(finalDirectory, { recursive: true, force: true });
      }
      throw error;
    }
  }
}

function assertSafeFilename(filename: string): string {
  if (
    filename.length === 0 ||
    basename(filename) !== filename ||
    filename === "." ||
    filename === ".."
  ) {
    throw new Error("outputFilename must be a plain filename.");
  }
  return filename;
}

function sanitizedRequest(
  input: SaveArtifactInput,
): Record<string, JsonValue> {
  return {
    capability: input.capability,
    provider: input.provider,
    model: input.model,
    credentialMode: input.credentialMode,
    parameters: input.parameters,
    ...(input.promptOrText === undefined
      ? {}
      : { promptOrText: input.promptOrText }),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
