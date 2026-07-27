import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  ArtifactRecord,
  ArtifactRepository,
} from "./artifacts.js";
import type {
  CapabilityProbeResult,
  CredentialMode,
  MediaJob,
  ModelPreference,
  NormalizedProviderFailure,
} from "./contracts.js";
import type {
  CredentialKind,
  CredentialReference,
  VoiceReference,
} from "./credentials.js";

export type CredentialValidationStatus =
  | "unverified"
  | "verified"
  | "invalid";

export interface CredentialReferenceMetadata {
  kind: CredentialKind;
  reference: CredentialReference;
  validationStatus: CredentialValidationStatus;
  verifiedAt?: string;
}

export interface StoredProbe {
  provider: string;
  region: string;
  modelId: string;
  capability: string;
  credentialMode: string;
  result: CapabilityProbeResult;
}

export interface VoiceAliasRecord {
  alias: string;
  voiceReference: VoiceReference;
  targetModel: string;
  credentialMode?: CredentialMode;
  consentRecordId: string;
  createdAt: string;
}

export interface ConsentRecord {
  id: string;
  affirmedAt: string;
  scope: string;
  sourceFileHash: string;
  actor: string;
}

export class SqliteStateStore implements ArtifactRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  saveCredentialReference(metadata: CredentialReferenceMetadata): void {
    this.database
      .prepare(
        `
          INSERT INTO credential_refs (
            credential_kind,
            credential_reference,
            validation_status,
            verified_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(credential_kind) DO UPDATE SET
            credential_reference = excluded.credential_reference,
            validation_status = excluded.validation_status,
            verified_at = excluded.verified_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        metadata.kind,
        metadata.reference,
        metadata.validationStatus,
        metadata.verifiedAt ?? null,
        new Date().toISOString(),
      );
  }

  getCredentialReference(
    kind: CredentialKind,
  ): CredentialReferenceMetadata | undefined {
    const row = this.database
      .prepare(
        `
          SELECT credential_kind, credential_reference, validation_status,
                 verified_at
          FROM credential_refs
          WHERE credential_kind = ?
        `,
      )
      .get(kind) as
      | {
          credential_kind: CredentialKind;
          credential_reference: CredentialReference;
          validation_status: CredentialValidationStatus;
          verified_at: string | null;
        }
      | undefined;

    return row === undefined
      ? undefined
      : {
          kind: row.credential_kind,
          reference: row.credential_reference,
          validationStatus: row.validation_status,
          ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
        };
  }

  deleteCredentialReference(kind: CredentialKind): boolean {
    return (
      this.database
        .prepare("DELETE FROM credential_refs WHERE credential_kind = ?")
        .run(kind).changes === 1
    );
  }

  savePreference(preference: ModelPreference): void {
    this.database
      .prepare(
        `
          INSERT INTO model_preferences (
            capability, model_id, credential_mode, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(capability) DO UPDATE SET
            model_id = excluded.model_id,
            credential_mode = excluded.credential_mode,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        preference.capability,
        preference.modelId,
        preference.credentialMode,
        preference.updatedAt,
      );
  }

  listPreferences(): ModelPreference[] {
    return (
      this.database
        .prepare(
          `
            SELECT capability, model_id, credential_mode, updated_at
            FROM model_preferences ORDER BY capability
          `,
        )
        .all() as Array<{
        capability: ModelPreference["capability"];
        model_id: string;
        credential_mode: ModelPreference["credentialMode"];
        updated_at: string;
      }>
    ).map((row) => ({
      capability: row.capability,
      modelId: row.model_id,
      credentialMode: row.credential_mode,
      updatedAt: row.updated_at,
    }));
  }

  saveProbe(record: StoredProbe): void {
    const error =
      record.result.status === "verified" ? undefined : record.result.error;
    this.database
      .prepare(
        `
          INSERT INTO capability_probes (
            provider, region, model_id, capability, credential_mode, status,
            checked_at, error_code, error_json, request_id, provider_task_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (
            provider, region, model_id, capability, credential_mode
          ) DO UPDATE SET
            status = excluded.status,
            checked_at = excluded.checked_at,
            error_code = excluded.error_code,
            error_json = excluded.error_json,
            request_id = excluded.request_id,
            provider_task_id = excluded.provider_task_id
        `,
      )
      .run(
        record.provider,
        record.region,
        record.modelId,
        record.capability,
        record.credentialMode,
        record.result.status,
        record.result.checkedAt,
        error?.code ?? null,
        error === undefined ? null : JSON.stringify(error),
        "requestId" in record.result ? record.result.requestId ?? null : null,
        "providerTaskId" in record.result
          ? record.result.providerTaskId ?? null
          : null,
      );
  }

  listProbes(): StoredProbe[] {
    return (
      this.database
        .prepare(
          `
            SELECT provider, region, model_id, capability, credential_mode,
                   status, checked_at, error_json, request_id, provider_task_id
            FROM capability_probes
            ORDER BY checked_at DESC
          `,
        )
        .all() as Array<Record<string, string | null>>
    ).map((row) => {
      const status = row.status as CapabilityProbeResult["status"];
      const error =
        row.error_json == null
          ? undefined
          : (JSON.parse(row.error_json) as NormalizedProviderFailure);
      const result: CapabilityProbeResult =
        status === "verified"
          ? {
              status,
              checkedAt: row.checked_at!,
              ...(row.request_id === null
                ? {}
                : { requestId: row.request_id! }),
            }
          : status === "unavailable"
            ? {
                status,
                checkedAt: row.checked_at!,
                error: error!,
              }
            : {
                status: "unknown",
                checkedAt: row.checked_at!,
                error: error!,
                ...(row.provider_task_id === null
                  ? {}
                  : { providerTaskId: row.provider_task_id! }),
              };
      return {
        provider: row.provider!,
        region: row.region!,
        modelId: row.model_id!,
        capability: row.capability!,
        credentialMode: row.credential_mode!,
        result,
      };
    });
  }

  createJob(job: MediaJob): void {
    this.database
      .prepare(
        `
          INSERT INTO jobs (
            job_id, capability, provider, model_id, credential_mode, status,
            provider_task_id, parameters_json, client_json, artifact_ids_json,
            error_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        job.id,
        job.capability,
        job.provider,
        job.model,
        job.credentialMode,
        job.status,
        job.providerTaskId ?? null,
        JSON.stringify(job.parameters),
        JSON.stringify(job.client),
        JSON.stringify(job.artifactIds),
        job.error === undefined ? null : JSON.stringify(job.error),
        job.createdAt,
        job.updatedAt,
      );
  }

  updateJob(job: MediaJob): void {
    const result = this.database
      .prepare(
        `
          UPDATE jobs SET
            status = ?,
            provider_task_id = ?,
            artifact_ids_json = ?,
            error_json = ?,
            updated_at = ?
          WHERE job_id = ?
        `,
      )
      .run(
        job.status,
        job.providerTaskId ?? null,
        JSON.stringify(job.artifactIds),
        job.error === undefined ? null : JSON.stringify(job.error),
        job.updatedAt,
        job.id,
      );
    if (result.changes !== 1) {
      throw new Error(`Job not found: ${job.id}`);
    }
  }

  getJob(jobId: string): MediaJob | undefined {
    const row = this.database
      .prepare("SELECT * FROM jobs WHERE job_id = ?")
      .get(jobId) as Record<string, string | null> | undefined;
    return row === undefined ? undefined : mapJob(row);
  }

  listJobs(limit = 100): MediaJob[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit) as Array<Record<string, string | null>>
    ).map(mapJob);
  }

  saveConsent(record: ConsentRecord): void {
    this.database
      .prepare(
        `
          INSERT INTO consent_records (
            consent_record_id, affirmed_at, scope, source_file_hash, actor
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.id,
        record.affirmedAt,
        record.scope,
        record.sourceFileHash,
        record.actor,
      );
  }

  saveVoiceAlias(record: VoiceAliasRecord): void {
    this.database
      .prepare(
        `
          INSERT INTO voice_aliases (
            alias, voice_reference, target_model, credential_mode,
            consent_record_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(alias) DO UPDATE SET
            voice_reference = excluded.voice_reference,
            target_model = excluded.target_model,
            credential_mode = excluded.credential_mode,
            consent_record_id = excluded.consent_record_id,
            created_at = excluded.created_at
        `,
      )
      .run(
        record.alias,
        record.voiceReference,
        record.targetModel,
        record.credentialMode ?? null,
        record.consentRecordId,
        record.createdAt,
      );
  }

  getVoiceAlias(alias: string): VoiceAliasRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM voice_aliases WHERE alias = ?")
      .get(alias) as
      | {
          alias: string;
          voice_reference: VoiceReference;
          target_model: string;
          credential_mode: CredentialMode | null;
          consent_record_id: string;
          created_at: string;
        }
      | undefined;
    return row === undefined
      ? undefined
      : {
          alias: row.alias,
          voiceReference: row.voice_reference,
          targetModel: row.target_model,
          ...(row.credential_mode === null
            ? {}
            : { credentialMode: row.credential_mode }),
          consentRecordId: row.consent_record_id,
          createdAt: row.created_at,
        };
  }

  listVoiceAliases(): VoiceAliasRecord[] {
    return (
      this.database
        .prepare("SELECT * FROM voice_aliases ORDER BY created_at DESC")
        .all() as Array<{
        alias: string;
        voice_reference: VoiceReference;
        target_model: string;
        credential_mode: CredentialMode | null;
        consent_record_id: string;
        created_at: string;
      }>
    ).map((row) => ({
      alias: row.alias,
      voiceReference: row.voice_reference,
      targetModel: row.target_model,
      ...(row.credential_mode === null
        ? {}
        : { credentialMode: row.credential_mode }),
      consentRecordId: row.consent_record_id,
      createdAt: row.created_at,
    }));
  }

  async commit(record: ArtifactRecord): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO artifacts (
            artifact_id, job_id, manifest_path, local_path, sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.artifactId,
        record.jobId,
        record.manifestPath,
        record.localPath,
        record.sha256,
        record.createdAt,
      );
  }

  getArtifact(artifactId: string): ArtifactRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM artifacts WHERE artifact_id = ?")
      .get(artifactId) as ArtifactRow | undefined;
    return row === undefined ? undefined : mapArtifact(row);
  }

  listArtifacts(limit = 100): ArtifactRecord[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit) as ArtifactRow[]
    ).map(mapArtifact);
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS credential_refs (
        credential_kind TEXT PRIMARY KEY
          CHECK (credential_kind IN ('token_plan', 'dashscope')),
        credential_reference TEXT NOT NULL UNIQUE,
        validation_status TEXT NOT NULL
          CHECK (validation_status IN ('unverified', 'verified', 'invalid')),
        verified_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS model_preferences (
        capability TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        credential_mode TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS capability_probes (
        provider TEXT NOT NULL,
        region TEXT NOT NULL,
        model_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        credential_mode TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('verified', 'unavailable', 'unknown')),
        checked_at TEXT NOT NULL,
        error_code TEXT,
        error_json TEXT,
        request_id TEXT,
        provider_task_id TEXT,
        PRIMARY KEY (
          provider, region, model_id, capability, credential_mode
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        credential_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_task_id TEXT,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        client_json TEXT NOT NULL DEFAULT '{"kind":"cli","name":"unknown"}',
        artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS consent_records (
        consent_record_id TEXT PRIMARY KEY,
        affirmed_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        source_file_hash TEXT NOT NULL,
        actor TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS voice_aliases (
        alias TEXT PRIMARY KEY,
        voice_reference TEXT NOT NULL UNIQUE,
        target_model TEXT NOT NULL,
        credential_mode TEXT,
        consent_record_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        manifest_path TEXT NOT NULL,
        local_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);

    this.ensureColumn("capability_probes", "error_json", "TEXT");
    this.ensureColumn(
      "jobs",
      "parameters_json",
      "TEXT NOT NULL DEFAULT '{}'",
    );
    this.ensureColumn(
      "jobs",
      "client_json",
      `TEXT NOT NULL DEFAULT '{"kind":"cli","name":"unknown"}'`,
    );
    this.ensureColumn(
      "jobs",
      "artifact_ids_json",
      "TEXT NOT NULL DEFAULT '[]'",
    );
    this.ensureColumn("jobs", "error_json", "TEXT");
    this.ensureColumn("voice_aliases", "credential_mode", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.database.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
    }
  }
}

type ArtifactRow = {
  artifact_id: string;
  job_id: string;
  manifest_path: string;
  local_path: string;
  sha256: string;
  created_at: string;
};

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    artifactId: row.artifact_id,
    jobId: row.job_id,
    manifestPath: row.manifest_path,
    localPath: row.local_path,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function mapJob(row: Record<string, string | null>): MediaJob {
  return {
    id: row.job_id!,
    capability: row.capability as MediaJob["capability"],
    provider: row.provider!,
    model: row.model_id!,
    credentialMode: row.credential_mode as MediaJob["credentialMode"],
    status: row.status as MediaJob["status"],
    parameters: JSON.parse(row.parameters_json ?? "{}") as MediaJob["parameters"],
    client: JSON.parse(row.client_json ?? "{}") as MediaJob["client"],
    artifactIds: JSON.parse(
      row.artifact_ids_json ?? "[]",
    ) as MediaJob["artifactIds"],
    ...(row.provider_task_id === null
      ? {}
      : { providerTaskId: row.provider_task_id! }),
    ...(row.error_json === null
      ? {}
      : {
          error: JSON.parse(
            row.error_json!,
          ) as NormalizedProviderFailure,
        }),
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  };
}
