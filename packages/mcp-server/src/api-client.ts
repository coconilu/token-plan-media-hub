export class MediaHubApiClient {
  constructor(
    private readonly baseUrl =
      process.env.TP_MEDIA_URL ?? "http://127.0.0.1:4317",
  ) {}

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
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    } catch (error) {
      throw new Error(
        `无法连接 Token Plan Media Hub：${error instanceof Error ? error.message : String(error)}。请先运行 pnpm start。`,
      );
    }
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(errorMessage(body) ?? `HTTP ${response.status}`);
    }
    return body as T;
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
