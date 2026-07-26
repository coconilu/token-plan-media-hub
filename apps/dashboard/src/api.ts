import type {
  Artifact,
  Capability,
  CredentialMode,
  MediaJob,
  ModelsResponse,
  VoiceAlias,
} from "./types";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const detail = errorMessage(body);
    throw new Error(detail ?? `请求失败：HTTP ${response.status}`);
  }
  return body as T;
}

function errorMessage(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null ||
    !("message" in value.error)
  ) {
    return undefined;
  }
  return typeof value.error.message === "string"
    ? value.error.message
    : undefined;
}

export const api = {
  runtime: () => request<{ mode: "demo" | "real" }>("/api/runtime"),
  setRuntime: (mode: "demo" | "real") =>
    request<{ mode: "demo" | "real" }>("/api/runtime", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  models: () => request<ModelsResponse>("/api/models"),
  jobs: () => request<{ jobs: MediaJob[] }>("/api/jobs?limit=100"),
  getJob: (id: string, refresh = false) =>
    request<MediaJob>(
      `/api/jobs/${encodeURIComponent(id)}${refresh ? "?refresh=1" : ""}`,
    ),
  submit: (input: {
    capability: Capability;
    model: string;
    credentialMode: CredentialMode;
    parameters: Record<string, unknown>;
  }) =>
    request<MediaJob>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  artifacts: () =>
    request<{ artifacts: Artifact[] }>("/api/artifacts?limit=100"),
  voices: () => request<{ voices: VoiceAlias[] }>("/api/voices"),
  credentials: () =>
    request<{
      credentials: Array<{
        kind: "token_plan" | "dashscope";
        configured: boolean;
        validationStatus: string;
        verifiedAt?: string;
      }>;
    }>("/api/credentials"),
  setCredential: (kind: string, value: string) =>
    request(`/api/credentials/${kind}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  deleteCredential: (kind: string) =>
    request(`/api/credentials/${kind}`, { method: "DELETE" }),
  probe: (
    capability: Capability,
    model: string,
    credentialMode: CredentialMode,
  ) =>
    request("/api/probes", {
      method: "POST",
      body: JSON.stringify({ capability, model, credentialMode }),
    }),
};
