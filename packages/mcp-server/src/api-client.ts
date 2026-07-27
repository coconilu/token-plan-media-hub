import { resolveMediaHubGateway } from "@token-plan-media-hub/core";

export class MediaHubApiClient {
  private baseUrl?: Promise<string>;

  constructor(private readonly explicitBaseUrl?: string) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = await this.resolveBaseUrl();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch (error) {
      throw new Error(
        `无法连接 Agent Gateway ${baseUrl}：${
          error instanceof Error ? error.message : String(error)
        }。请先启动 Token Plan Media Hub 桌面端，或设置 TP_MEDIA_URL。`,
      );
    }
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(errorMessage(body) ?? `HTTP ${response.status}`);
    }
    return body as T;
  }

  private resolveBaseUrl(): Promise<string> {
    this.baseUrl ??= resolveMediaHubGateway(
      this.explicitBaseUrl === undefined
        ? {}
        : { explicitOrigin: this.explicitBaseUrl },
    ).then((gateway) => gateway.origin);
    return this.baseUrl;
  }
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
