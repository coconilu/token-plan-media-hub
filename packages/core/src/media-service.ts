import { createHash, randomUUID } from "node:crypto";

import { ArtifactStore } from "./artifacts.js";
import type {
  Capability,
  CapabilityProbeRequest,
  ClientIdentity,
  CredentialMode,
  JsonValue,
  MediaJob,
  ModelPreference,
  ModelRegistry,
  NormalizedProviderFailure,
  ProviderAdapter,
  ProviderContext,
  ProviderOutput,
} from "./contracts.js";
import {
  type CredentialKind,
  FileCredentialVault,
} from "./credentials.js";
import { MediaCoreError } from "./errors.js";
import { probeModelCapability } from "./probe.js";
import {
  assertCredentialRoute,
  validateModelParameters,
} from "./registry.js";
import {
  SqliteStateStore,
  type CredentialReferenceMetadata,
} from "./state-store.js";

export interface SubmitJobInput {
  capability: Capability;
  model: string;
  credentialMode: CredentialMode;
  parameters: Record<string, JsonValue>;
  client: ClientIdentity;
}

export interface CredentialStatus {
  kind: CredentialKind;
  configured: boolean;
  validationStatus: CredentialReferenceMetadata["validationStatus"] | "missing";
  verifiedAt?: string;
}

export interface MediaServiceOptions {
  registry: ModelRegistry;
  provider: ProviderAdapter;
  state: SqliteStateStore;
  vault: FileCredentialVault;
  artifacts: ArtifactStore;
  maxDownloadBytes?: number;
  fetch?: typeof globalThis.fetch;
}

export class MediaService {
  private readonly registry: ModelRegistry;
  private readonly provider: ProviderAdapter;
  private readonly state: SqliteStateStore;
  private readonly vault: FileCredentialVault;
  private readonly artifacts: ArtifactStore;
  private readonly maxDownloadBytes: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: MediaServiceOptions) {
    this.registry = options.registry;
    this.provider = options.provider;
    this.state = options.state;
    this.vault = options.vault;
    this.artifacts = options.artifacts;
    this.maxDownloadBytes = options.maxDownloadBytes ?? 250 * 1024 * 1024;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  getRegistry(): ModelRegistry {
    return this.registry;
  }

  getProviderId(): string {
    return this.provider.id;
  }

  getCredentialStatuses(): CredentialStatus[] {
    return (["token_plan", "dashscope"] as const).map((kind) => {
      const metadata = this.state.getCredentialReference(kind);
      return metadata === undefined
        ? {
            kind,
            configured: false,
            validationStatus: "missing",
          }
        : {
            kind,
            configured: true,
            validationStatus: metadata.validationStatus,
            ...(metadata.verifiedAt === undefined
              ? {}
              : { verifiedAt: metadata.verifiedAt }),
          };
    });
  }

  async setCredential(
    kind: CredentialKind,
    value: string,
  ): Promise<CredentialStatus> {
    const normalizedValue = normalizeCredential(kind, value);
    const previous = this.state.getCredentialReference(kind);
    const reference = await this.vault.set(kind, normalizedValue);
    this.state.saveCredentialReference({
      kind,
      reference,
      validationStatus: "unverified",
    });
    if (previous !== undefined) {
      await this.vault.delete(previous.reference);
    }
    return {
      kind,
      configured: true,
      validationStatus: "unverified",
    };
  }

  async deleteCredential(kind: CredentialKind): Promise<boolean> {
    const previous = this.state.getCredentialReference(kind);
    if (previous === undefined) return false;
    this.state.deleteCredentialReference(kind);
    await this.vault.delete(previous.reference);
    return true;
  }

  listPreferences(): ModelPreference[] {
    return this.state.listPreferences();
  }

  savePreference(
    capability: Capability,
    modelId: string,
    credentialMode: CredentialMode,
  ): ModelPreference {
    const model = this.requireModel(modelId, capability);
    assertCredentialRoute(model, credentialMode);
    const preference: ModelPreference = {
      capability,
      modelId,
      credentialMode,
      updatedAt: new Date().toISOString(),
    };
    this.state.savePreference(preference);
    return preference;
  }

  listProbes() {
    return this.state.listProbes();
  }

  async probe(input: CapabilityProbeRequest) {
    const model = this.requireModel(input.model, input.capability);
    const context = await this.providerContext(input.credentialMode);
    const record = await probeModelCapability({
      provider: this.provider,
      context,
      region: this.registry.region,
      model,
      request: input,
    });
    this.state.saveProbe({
      provider: record.provider,
      region: record.region,
      modelId: record.model,
      capability: record.capability,
      credentialMode: record.credentialMode,
      result: record,
    });

    const kind = credentialKindForMode(input.credentialMode);
    const metadata = this.state.getCredentialReference(kind);
    if (metadata !== undefined) {
      this.state.saveCredentialReference({
        ...metadata,
        validationStatus:
          record.status === "verified"
            ? "verified"
            : record.status === "unavailable" &&
                record.error.code === "AUTH_INVALID"
              ? "invalid"
              : metadata.validationStatus,
        ...(record.status === "verified"
          ? { verifiedAt: record.checkedAt }
          : {}),
      });
    }
    return record;
  }

  async submit(input: SubmitJobInput): Promise<MediaJob> {
    const model = this.requireModel(input.model, input.capability);
    assertCredentialRoute(model, input.credentialMode);
    validateModelParameters(model, input.capability, input.parameters);
    assertSensitiveCapabilityPolicy(input.capability, input.parameters);

    const now = new Date().toISOString();
    const safeParameters = sanitizeParameters(
      input.capability,
      input.parameters,
    );
    const job: MediaJob = {
      id: `job_${randomUUID()}`,
      capability: input.capability,
      provider: this.provider.id,
      model: input.model,
      credentialMode: input.credentialMode,
      status: "running",
      parameters: safeParameters,
      client: input.client,
      artifactIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.state.createJob(job);

    try {
      const providerParameters = await this.prepareProviderParameters(
        input.capability,
        input.model,
        input.credentialMode,
        input.parameters,
      );
      const context = await this.providerContext(input.credentialMode);
      const submission = await this.provider.submit(context, {
        ...input,
        parameters: providerParameters,
      });
      if (submission.kind === "accepted") {
        const accepted: MediaJob = {
          ...job,
          status: "queued",
          providerTaskId: submission.providerTaskId,
          updatedAt: new Date().toISOString(),
        };
        this.state.updateJob(accepted);
        return accepted;
      }
      return this.completeJob(job, submission.outputs);
    } catch (error) {
      return this.failJob(job, error);
    }
  }

  async refreshJob(jobId: string): Promise<MediaJob> {
    const job = this.state.getJob(jobId);
    if (job === undefined) {
      throw new MediaCoreError({
        code: "MODEL_UNAVAILABLE",
        message: `作业不存在：${jobId}`,
        retryable: false,
      });
    }
    if (
      job.providerTaskId === undefined ||
      job.status === "succeeded" ||
      job.status === "failed"
    ) {
      return job;
    }

    try {
      const context = await this.providerContext(job.credentialMode);
      const update = await this.provider.getJob(
        context,
        job.providerTaskId,
      );
      if (update.state === "succeeded") {
        return this.completeJob(job, update.outputs ?? []);
      }
      if (update.state === "failed") {
        return this.failJob(
          job,
          update.error ?? {
            code: "PROVIDER_REJECTED",
            message: "Provider job failed.",
            retryable: false,
          },
        );
      }
      const refreshed: MediaJob = {
        ...job,
        status:
          update.state === "timeout_unknown"
            ? "timeout_unknown"
            : update.state,
        ...(update.error === undefined ? {} : { error: update.error }),
        updatedAt: new Date().toISOString(),
      };
      this.state.updateJob(refreshed);
      return refreshed;
    } catch (error) {
      return this.failJob(job, error);
    }
  }

  getJob(jobId: string): MediaJob | undefined {
    return this.state.getJob(jobId);
  }

  listJobs(limit?: number): MediaJob[] {
    return this.state.listJobs(limit);
  }

  listArtifacts(limit?: number) {
    return this.state.listArtifacts(limit);
  }

  getArtifact(artifactId: string) {
    return this.state.getArtifact(artifactId);
  }

  listVoices() {
    return this.state.listVoiceAliases().map((voice) => ({
      alias: voice.alias,
      targetModel: voice.targetModel,
      ...(voice.credentialMode === undefined
        ? {}
        : { credentialMode: voice.credentialMode }),
      createdAt: voice.createdAt,
    }));
  }

  async resumePendingJobs(): Promise<void> {
    const pending = this.state
      .listJobs(500)
      .filter(
        (job) =>
          job.status === "queued" ||
          job.status === "running" ||
          job.status === "timeout_unknown",
      );
    await Promise.allSettled(pending.map((job) => this.refreshJob(job.id)));
  }

  private requireModel(modelId: string, capability: Capability) {
    const model = this.registry.models.find((item) => item.id === modelId);
    if (model === undefined || !model.capabilities.includes(capability)) {
      throw new MediaCoreError({
        code: "MODEL_UNAVAILABLE",
        message: `模型 ${modelId} 不提供 ${capability}。`,
        retryable: false,
      });
    }
    return model;
  }

  private async providerContext(
    credentialMode: CredentialMode,
  ): Promise<ProviderContext> {
    const metadata = this.state.getCredentialReference(
      credentialKindForMode(credentialMode),
    );
    if (metadata === undefined) {
      throw new MediaCoreError({
        code: "AUTH_INVALID",
        message: `凭据路由 ${credentialMode} 尚未配置，不会自动回退。`,
        retryable: false,
      });
    }
    const credential = await this.vault.get(metadata.reference);
    if (credential === undefined) {
      throw new MediaCoreError({
        code: "AUTH_INVALID",
        message: "凭据引用存在，但系统凭据库中没有对应密钥。",
        retryable: false,
      });
    }
    return { credential, credentialMode };
  }

  private async prepareProviderParameters(
    capability: Capability,
    model: string,
    credentialMode: CredentialMode,
    parameters: Record<string, JsonValue>,
  ): Promise<Record<string, JsonValue>> {
    if (capability !== "speech.synthesize_with_clone") {
      return parameters;
    }
    const alias = String(parameters.voice_alias ?? "");
    const voice = this.state.getVoiceAlias(alias);
    if (voice === undefined) {
      throw new MediaCoreError({
        code: "PARAMETER_INVALID",
        message: `找不到本地音色别名：${alias}`,
        retryable: false,
      });
    }
    if (voice.targetModel !== model) {
      throw new MediaCoreError({
        code: "MODEL_UNAVAILABLE",
        message: `音色 ${alias} 绑定 ${voice.targetModel}，不能用于 ${model}。`,
        retryable: false,
      });
    }
    if (voice.credentialMode === undefined) {
      throw new MediaCoreError({
        code: "LOCAL_DEPENDENCY_MISSING",
        message: `音色 ${alias} 缺少凭据路由信息，请重新创建后再使用。`,
        retryable: false,
      });
    }
    if (voice.credentialMode !== credentialMode) {
      throw new MediaCoreError({
        code: "MODEL_UNAVAILABLE",
        message: `音色 ${alias} 绑定凭据路由 ${voice.credentialMode}，不能改用 ${credentialMode}。`,
        retryable: false,
      });
    }
    const providerVoiceId = await this.vault.get(voice.voiceReference);
    if (providerVoiceId === undefined) {
      throw new MediaCoreError({
        code: "LOCAL_DEPENDENCY_MISSING",
        message: `音色 ${alias} 的安全引用已丢失。`,
        retryable: false,
      });
    }
    return {
      ...parameters,
      voice: providerVoiceId,
    };
  }

  private async completeJob(
    job: MediaJob,
    outputs: ProviderOutput[],
  ): Promise<MediaJob> {
    const artifactIds: string[] = [];
    for (const output of outputs) {
      if (output.kind === "voice") {
        artifactIds.push(await this.saveVoiceOutput(job, output));
      } else {
        artifactIds.push(await this.saveMediaOutput(job, output));
      }
    }
    const completed: MediaJob = {
      ...job,
      status: "succeeded",
      artifactIds: [...job.artifactIds, ...artifactIds],
      updatedAt: new Date().toISOString(),
    };
    this.state.updateJob(completed);
    return completed;
  }

  private async saveMediaOutput(
    job: MediaJob,
    output: Extract<ProviderOutput, { kind: "media" }>,
  ): Promise<string> {
    let data = output.data;
    let mimeType = output.mimeType;
    if (data === undefined && output.temporaryUrl !== undefined) {
      const downloaded = await this.download(output.temporaryUrl);
      data = downloaded.data;
      mimeType = downloaded.mimeType || mimeType;
    }
    if (data === undefined) {
      throw new MediaCoreError({
        code: "DOWNLOAD_FAILED",
        message: "Provider 未返回可下载的媒体。",
        retryable: true,
      });
    }
    const promptOrText =
      typeof job.parameters.prompt === "string"
        ? job.parameters.prompt
        : typeof job.parameters.text === "string"
          ? job.parameters.text
          : undefined;
    const manifest = await this.artifacts.save({
      jobId: job.id,
      capability: job.capability,
      provider: job.provider,
      model: job.model,
      credentialMode: job.credentialMode,
      parameters: job.parameters,
      ...(promptOrText === undefined ? {} : { promptOrText }),
      mimeType,
      outputFilename: output.filename,
      output: data,
      providerResponseSummary: {
        providerTaskId: job.providerTaskId ?? null,
      },
      ...(job.providerTaskId === undefined
        ? {}
        : { sourceJobId: job.providerTaskId }),
    });
    return manifest.artifactId;
  }

  private async saveVoiceOutput(
    job: MediaJob,
    output: Extract<ProviderOutput, { kind: "voice" }>,
  ): Promise<string> {
    const alias = String(job.parameters.name ?? "");
    const consentRecordId = `consent_${randomUUID()}`;
    this.state.saveConsent({
      id: consentRecordId,
      affirmedAt: new Date().toISOString(),
      scope: "voice.clone",
      sourceFileHash: String(
        job.parameters.reference_audio_sha256 ?? "unknown",
      ),
      actor: job.client.name,
    });
    const voiceReference = await this.vault.setVoice(output.providerVoiceId);
    const previousVoice = this.state.getVoiceAlias(alias);
    this.state.saveVoiceAlias({
      alias,
      voiceReference,
      targetModel: output.targetModel,
      credentialMode: job.credentialMode,
      consentRecordId,
      createdAt: new Date().toISOString(),
    });
    if (previousVoice !== undefined) {
      await this.vault.delete(previousVoice.voiceReference);
    }
    const serialized = Buffer.from(
      `${JSON.stringify({ alias, targetModel: output.targetModel }, null, 2)}\n`,
      "utf8",
    );
    const manifest = await this.artifacts.save({
      jobId: job.id,
      capability: job.capability,
      provider: job.provider,
      model: job.model,
      credentialMode: job.credentialMode,
      parameters: job.parameters,
      mimeType: "application/vnd.token-plan-media-hub.voice+json",
      outputFilename: "voice-reference.json",
      output: serialized,
      providerResponseSummary: {},
      consentRecordId,
    });
    return manifest.artifactId;
  }

  private failJob(job: MediaJob, error: unknown): MediaJob {
    const failure = normalizeFailure(error);
    const failed: MediaJob = {
      ...job,
      status:
        failure.code === "JOB_TIMEOUT_UNKNOWN"
          ? "timeout_unknown"
          : "failed",
      error: failure,
      updatedAt: new Date().toISOString(),
    };
    this.state.updateJob(failed);
    return failed;
  }

  private async download(url: string): Promise<{
    data: Uint8Array;
    mimeType: string;
  }> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new MediaCoreError({
        code: "DOWNLOAD_FAILED",
        message: "Provider 返回了不受支持的下载协议。",
        retryable: false,
      });
    }
    const response = await this.fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new MediaCoreError({
        code: "DOWNLOAD_FAILED",
        message: `媒体下载失败：HTTP ${response.status}`,
        retryable: response.status >= 500,
      });
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.maxDownloadBytes
    ) {
      throw new MediaCoreError({
        code: "DOWNLOAD_FAILED",
        message: "媒体文件超过本地下载上限。",
        retryable: false,
      });
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > this.maxDownloadBytes) {
      throw new MediaCoreError({
        code: "DOWNLOAD_FAILED",
        message: "媒体文件超过本地下载上限。",
        retryable: false,
      });
    }
    return {
      data: buffer,
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream",
    };
  }
}

function credentialKindForMode(mode: CredentialMode): CredentialKind {
  return mode === "dashscope" ? "dashscope" : "token_plan";
}

function normalizeCredential(kind: CredentialKind, value: string): string {
  const normalized = value.trim();
  const hasWhitespace = /\s/.test(normalized);
  const valid =
    kind === "token_plan"
      ? normalized.startsWith("sk-sp-") &&
        normalized.length > "sk-sp-".length &&
        !hasWhitespace
      : normalized.startsWith("sk-") &&
        normalized.length > "sk-".length &&
        !normalized.startsWith("sk-sp-") &&
        !hasWhitespace;
  if (!valid) {
    throw new MediaCoreError({
      code: "AUTH_INVALID",
      message:
        kind === "token_plan"
          ? "Token Plan Key 应以 sk-sp- 开头，且不能包含空白字符。"
          : "普通百炼 Key 应使用 sk-ws-（新版）或 sk-（旧版）格式，且不能是 sk-sp- Key。",
      retryable: false,
    });
  }
  return normalized;
}

function sanitizeParameters(
  capability: Capability,
  parameters: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (capability !== "voice.clone") return parameters;
  const audio = String(parameters.reference_audio ?? "");
  const hash = createHash("sha256").update(audio).digest("hex");
  return {
    ...parameters,
    reference_audio: "[redacted]",
    reference_audio_sha256: hash,
  };
}

function assertSensitiveCapabilityPolicy(
  capability: Capability,
  parameters: Record<string, JsonValue>,
): void {
  if (capability !== "voice.clone") return;
  if (parameters.consent !== true) {
    throw new MediaCoreError({
      code: "CONSENT_REQUIRED",
      message: "声音复刻需要确认拥有该声音或已获得明确授权。",
      retryable: false,
    });
  }
  const referenceAudio = String(parameters.reference_audio ?? "");
  if (!/^data:audio\/[a-z0-9.+-]+;base64,/i.test(referenceAudio)) {
    throw new MediaCoreError({
      code: "PARAMETER_INVALID",
      message: "参考音频必须作为 base64 data:audio URL 提交。",
      retryable: false,
    });
  }
}

function normalizeFailure(error: unknown): NormalizedProviderFailure {
  if (error instanceof MediaCoreError) return error.toJSON();
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "retryable" in error
  ) {
    return error as NormalizedProviderFailure;
  }
  return {
    code: "PROVIDER_REJECTED",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
