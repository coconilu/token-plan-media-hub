import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MEDIA_HUB_SERVICE_ID = "token-plan-media-hub";
export const MEDIA_HUB_APP_ID = "com.bayeswang.token-plan-media-hub";
export const GATEWAY_DISCOVERY_FILENAME = "agent-gateway.json";
export const DEVELOPMENT_GATEWAY_ORIGIN = "http://127.0.0.1:4317";

export interface AgentGatewayManifest {
  schemaVersion: 1;
  service: typeof MEDIA_HUB_SERVICE_ID;
  transport: "loopback-http";
  origin: string;
  pid: number;
  startedAt: string;
}

export interface GatewayResolution {
  origin: string;
  source: "explicit" | "environment" | "discovery" | "development-fallback";
  discoveryFile?: string;
  manifest?: AgentGatewayManifest;
}

export interface ResolveGatewayOptions {
  explicitOrigin?: string;
  discoveryFile?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

export async function resolveMediaHubGateway(
  options: ResolveGatewayOptions = {},
): Promise<GatewayResolution> {
  if (options.explicitOrigin !== undefined) {
    return {
      origin: validateLoopbackOrigin(options.explicitOrigin),
      source: "explicit",
    };
  }

  const environment = options.environment ?? process.env;
  if (environment.TP_MEDIA_URL !== undefined) {
    return {
      origin: validateLoopbackOrigin(environment.TP_MEDIA_URL),
      source: "environment",
    };
  }

  const discoveryFile =
    options.discoveryFile ??
    environment.TP_MEDIA_GATEWAY_FILE ??
    defaultGatewayDiscoveryPath({
      environment,
      ...(options.platform === undefined
        ? {}
        : { platform: options.platform }),
      ...(options.homeDirectory === undefined
        ? {}
        : { homeDirectory: options.homeDirectory }),
    });

  try {
    const manifest = parseGatewayManifest(
      JSON.parse(await readFile(discoveryFile, "utf8")) as unknown,
    );
    return {
      origin: manifest.origin,
      source: "discovery",
      discoveryFile,
      manifest,
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return {
        origin: DEVELOPMENT_GATEWAY_ORIGIN,
        source: "development-fallback",
        discoveryFile,
      };
    }
    throw new Error(
      `Agent Gateway 发现文件无效：${discoveryFile}。${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function defaultGatewayDiscoveryPath(
  options: {
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDirectory?: string;
  } = {},
): string {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === "win32") {
    const localData =
      environment.LOCALAPPDATA ??
      join(homeDirectory, "AppData", "Local");
    return join(
      localData,
      MEDIA_HUB_APP_ID,
      GATEWAY_DISCOVERY_FILENAME,
    );
  }
  if (platform === "darwin") {
    return join(
      homeDirectory,
      "Library",
      "Application Support",
      MEDIA_HUB_APP_ID,
      GATEWAY_DISCOVERY_FILENAME,
    );
  }
  return join(
    environment.XDG_DATA_HOME ?? join(homeDirectory, ".local", "share"),
    MEDIA_HUB_APP_ID,
    GATEWAY_DISCOVERY_FILENAME,
  );
}

export function parseGatewayManifest(value: unknown): AgentGatewayManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("内容必须是 JSON 对象。");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.service !== MEDIA_HUB_SERVICE_ID ||
    candidate.transport !== "loopback-http" ||
    typeof candidate.origin !== "string" ||
    typeof candidate.pid !== "number" ||
    !Number.isInteger(candidate.pid) ||
    candidate.pid <= 0 ||
    typeof candidate.startedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.startedAt))
  ) {
    throw new Error("Schema、服务标识或进程信息不匹配。");
  }
  return {
    schemaVersion: 1,
    service: MEDIA_HUB_SERVICE_ID,
    transport: "loopback-http",
    origin: validateLoopbackOrigin(candidate.origin),
    pid: candidate.pid,
    startedAt: candidate.startedAt,
  };
}

export function validateLoopbackOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`网关地址格式无效：${value}`);
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("网关地址必须是带端口的 http://127.0.0.1 回环 Origin。");
  }
  return url.origin;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
