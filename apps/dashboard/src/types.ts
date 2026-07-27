export type Capability =
  | "text.generate"
  | "image.generate"
  | "video.text_to_video"
  | "speech.synthesize"
  | "voice.clone"
  | "speech.synthesize_with_clone";

export type CredentialMode =
  | "token_plan"
  | "token_plan_probe"
  | "dashscope";

export interface ModelDefinition {
  id: string;
  capabilities: Capability[];
  recommendedFor: Capability[];
  credentialModes: CredentialMode[];
  availability: string;
  execution: "sync" | "async";
  parameters: Partial<
    Record<
      Capability,
      {
        properties: Record<
          string,
          {
            type?: string;
            title?: string;
            default?: string | number | boolean;
            enum?: string[];
            minimum?: number;
            maximum?: number;
          }
        >;
        required?: string[];
      }
    >
  >;
  source: { url: string; verifiedAt: string };
}

export interface ModelsResponse {
  registry: {
    provider: string;
    region: string;
    verifiedAt: string;
    models: ModelDefinition[];
  };
  preferences: Array<{
    capability: Capability;
    modelId: string;
    credentialMode: CredentialMode;
  }>;
  probes: Array<{
    modelId: string;
    capability: Capability;
    result: { status: string; checkedAt: string };
  }>;
}

export interface MediaJob {
  id: string;
  capability: Capability;
  provider: string;
  model: string;
  credentialMode: CredentialMode;
  status: "queued" | "running" | "succeeded" | "failed" | "timeout_unknown";
  parameters: Record<string, unknown>;
  artifactIds: string[];
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  artifactId: string;
  jobId: string;
  localPath: string;
  createdAt: string;
  contentUrl: string;
  manifest: {
    capability: Capability;
    mimeType: string;
    model: string;
    parameters: Record<string, unknown>;
    promptOrText?: string;
    outputFilename?: string;
  };
}

export interface VoiceAlias {
  alias: string;
  targetModel: string;
  credentialMode?: CredentialMode;
  createdAt: string;
}

export interface GatewayHealth {
  ok: true;
  service: "token-plan-media-hub";
  mode: "real";
  checkedAt: string;
  gateway: {
    apiVersion: 1;
    transport: "loopback-http";
    origin?: string;
  };
}

export interface AgentAccessResponse {
  agents: Array<{
    id: "codex" | "claude-code" | "kimi-code";
    name: string;
    transport: "stdio MCP";
    status: "ready" | "build_required";
  }>;
  repositoryLauncher: {
    available: boolean;
    command: string;
    args: string[];
    gatewayDiscovery: "automatic";
  };
}
