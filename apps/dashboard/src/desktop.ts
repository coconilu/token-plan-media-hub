interface BackendInfo {
  origin: string;
  desktop: boolean;
  discoveryFile: string;
  agentCommand: string;
  agentCommandReady: boolean;
}

let backendInfo: Promise<BackendInfo> | undefined;

const OFFICIAL_SOURCE_HOST = "help.aliyun.com";
const TOKEN_PLAN_CONSOLE_URL =
  "https://bailian.console.aliyun.com/cn-beijing?tab=plan";

export function isDesktopRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openOfficialSource(value: string): Promise<void> {
  const url = validateOfficialSourceUrl(value);
  await openExternalUrl(url);
}

export async function openTokenPlanConsole(): Promise<void> {
  await openExternalUrl(TOKEN_PLAN_CONSOLE_URL);
}

async function openExternalUrl(url: string): Promise<void> {
  if (!isDesktopRuntime()) {
    const opened = window.open(url, "_blank");
    if (opened === null) {
      throw new Error("浏览器阻止了新窗口，请允许弹出窗口后重试。");
    }
    opened.opener = null;
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function resolveBackendUrl(path: string): Promise<string> {
  if (!isDesktopRuntime()) return path;
  const info = await getBackendInfo();
  return new URL(path, `${info.origin}/`).toString();
}

export async function desktopAgentSetup(): Promise<
  | {
      command: string;
      args: string[];
      discoveryFile: string;
      ready: boolean;
    }
  | undefined
> {
  if (!isDesktopRuntime()) return undefined;
  const info = await getBackendInfo();
  return {
    command: info.agentCommand,
    args: [],
    discoveryFile: info.discoveryFile,
    ready: info.agentCommandReady,
  };
}

function validateOfficialSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("官方来源地址格式无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== OFFICIAL_SOURCE_HOST ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("仅允许打开 https://help.aliyun.com 官方文档。");
  }
  return url.toString();
}

async function getBackendInfo(): Promise<BackendInfo> {
  backendInfo ??= import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke<BackendInfo>("backend_info"),
  );
  return backendInfo;
}
