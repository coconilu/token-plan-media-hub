export const CAPABILITIES = [
  "text.generate",
  "image.generate",
  "video.text_to_video",
  "speech.synthesize",
  "voice.clone",
  "speech.synthesize_with_clone",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CREDENTIAL_MODES = [
  "token_plan",
  "dashscope",
] as const;

export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export const AVAILABILITY_STATES = [
  "documented",
  "probe_required",
  "verified",
  "unavailable",
  "stale",
] as const;

export type Availability = (typeof AVAILABILITY_STATES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ModelSource {
  url: string;
  verifiedAt: string;
}

export interface ModelDefinition {
  id: string;
  capabilities: Capability[];
  recommendedFor: Capability[];
  credentialModes: CredentialMode[];
  availability: Availability;
  execution: "sync" | "async";
  parameters: Partial<Record<Capability, ParameterSchema>>;
  source: ModelSource;
}

export interface ParameterSchema {
  type: "object";
  properties: Record<string, JsonValue>;
  required?: string[];
  additionalProperties: false;
}

export interface ModelRegistry {
  provider: string;
  region: string;
  verifiedAt: string;
  models: ModelDefinition[];
}

export interface ClientIdentity {
  kind: "dashboard" | "cli" | "mcp";
  name: string;
}

export interface ProviderRequest {
  capability: Capability;
  model: string;
  credentialMode: CredentialMode;
  parameters: Record<string, JsonValue>;
  client: ClientIdentity;
}

export type ProviderSubmission =
  | {
      kind: "completed";
      requestId?: string;
      outputs: ProviderOutput[];
    }
  | {
      kind: "accepted";
      requestId?: string;
      providerTaskId: string;
    };

export type ProviderOutput =
  | {
      kind: "media";
      mimeType: string;
      filename: string;
      data?: Uint8Array;
      temporaryUrl?: string;
    }
  | {
      kind: "voice";
      providerVoiceId: string;
      targetModel: string;
    };

export type ProviderJobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout_unknown";

export interface ProviderJobUpdate {
  state: ProviderJobState;
  providerTaskId: string;
  requestId?: string;
  outputs?: ProviderOutput[];
  error?: NormalizedProviderFailure;
}

export interface CapabilityProbeRequest {
  capability: Capability;
  model: string;
  credentialMode: CredentialMode;
}

export type CapabilityProbeResult =
  | {
      status: "verified";
      checkedAt: string;
      requestId?: string;
    }
  | {
      status: "unavailable";
      checkedAt: string;
      error: NormalizedProviderFailure;
    }
  | {
      status: "unknown";
      checkedAt: string;
      error: NormalizedProviderFailure;
      providerTaskId?: string;
    };

export interface NormalizedProviderFailure {
  code: ErrorCode;
  message: string;
  requestId?: string;
  providerTaskId?: string;
  retryable: boolean;
}

export interface ProviderContext {
  credential: string;
  credentialMode: CredentialMode;
  signal?: AbortSignal;
}

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timeout_unknown",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface MediaJob {
  id: string;
  capability: Capability;
  provider: string;
  model: string;
  credentialMode: CredentialMode;
  status: JobStatus;
  parameters: Record<string, JsonValue>;
  client: ClientIdentity;
  providerTaskId?: string;
  artifactIds: string[];
  error?: NormalizedProviderFailure;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPreference {
  capability: Capability;
  modelId: string;
  credentialMode: CredentialMode;
  updatedAt: string;
}

export interface ProviderAdapter {
  readonly id: string;
  submit(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission>;
  getJob(
    context: ProviderContext,
    providerTaskId: string,
  ): Promise<ProviderJobUpdate>;
  probe(
    context: ProviderContext,
    request: CapabilityProbeRequest,
  ): Promise<CapabilityProbeResult>;
}

export const ERROR_CODES = [
  "AUTH_INVALID",
  "REGION_UNAVAILABLE",
  "PLAN_UNSUPPORTED",
  "MODEL_UNAVAILABLE",
  "PARAMETER_INVALID",
  "CONSENT_REQUIRED",
  "PROVIDER_REJECTED",
  "JOB_TIMEOUT_UNKNOWN",
  "DOWNLOAD_FAILED",
  "LOCAL_DEPENDENCY_MISSING",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
