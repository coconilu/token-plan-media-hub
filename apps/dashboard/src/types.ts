export type Capability =
  | "text.generate"
  | "image.generate"
  | "video.text_to_video"
  | "speech.synthesize"
  | "voice.clone"
  | "speech.synthesize_with_clone";

export type CredentialMode =
  | "token_plan"
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
            description?: string;
            default?: string | number | boolean;
            enum?: string[];
            enumLabels?: Record<string, string>;
            minLength?: number;
            maxLength?: number;
            pattern?: string;
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
    credentialMode: CredentialMode;
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
    id: "codex";
    name: "Codex";
    transport: "stdio MCP";
    detected: boolean;
    configPath: string;
    configExists: boolean;
    launcher: {
      command: string;
      args: string[];
      ready: boolean;
    };
    integration: {
      id: "token-plan-media-hub";
      status: "not_installed" | "installed" | "needs_update";
      version?: string;
      configuredCommand?: string;
      configuredArgs?: string[];
      verified: boolean;
      verifiedAt?: string;
      toolCount?: number;
    };
    backup: {
      available: boolean;
      canRollback: boolean;
      createdAt?: string;
      action?: AgentIntegrationAction;
    };
  }>;
  task?: AgentIntegrationTask;
}

export type AgentIntegrationAction =
  | "install"
  | "update"
  | "repair"
  | "uninstall"
  | "rollback";

export interface AgentIntegrationTask {
  id: string;
  agentId: "codex";
  action: AgentIntegrationAction;
  state: "running" | "succeeded" | "failed";
  progress: number;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    state: "pending" | "running" | "succeeded" | "failed";
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>;
  startedAt: string;
  completedAt?: string;
  rolledBack?: boolean;
  error?: {
    code: string;
    message: string;
  };
  result?: {
    status: "not_installed" | "installed" | "needs_update";
    version?: string;
    verified: boolean;
    toolCount?: number;
  };
}
