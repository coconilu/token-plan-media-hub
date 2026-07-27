interface BackendInfo {
  origin: string;
  desktop: boolean;
  desktopCopyToken: string;
  discoveryFile: string;
  agentCommand: string;
  agentCommandReady: boolean;
}

let backendInfo: Promise<BackendInfo> | undefined;

const OFFICIAL_SOURCE_HOST = "help.aliyun.com";
const QIANWEN_PLATFORM_URLS = {
  apiKeys: "https://platform.qianwenai.com/home/api-keys",
  tokenPlanUsage:
    "https://platform.qianwenai.com/home/billing/subscription/token-plan-individual",
  payAsYouGoUsage:
    "https://platform.qianwenai.com/home/billing/pay-as-you-go",
} as const;

export type QianwenPlatformPage = keyof typeof QIANWEN_PLATFORM_URLS;

export function isDesktopRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openOfficialSource(value: string): Promise<void> {
  const url = validateOfficialSourceUrl(value);
  await openExternalUrl(url);
}

export async function openQianwenPlatformPage(
  page: QianwenPlatformPage,
): Promise<void> {
  await openExternalUrl(QIANWEN_PLATFORM_URLS[page]);
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

export async function desktopCredentialCopyHeaders(): Promise<
  Record<string, string>
> {
  if (!isDesktopRuntime()) {
    throw new Error("复制已保存的 Key 仅支持桌面应用。");
  }
  const info = await getBackendInfo();
  return { "X-TP-Media-Desktop-Token": info.desktopCopyToken };
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
