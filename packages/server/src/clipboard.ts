import { spawn } from "node:child_process";

const WINDOWS_CLIPBOARD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$value = [Console]::In.ReadToEnd()
Set-Clipboard -Value $value
`;

export async function writeSystemClipboard(value: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("复制已保存的 Key 当前只支持 Windows 桌面端。");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-Command",
        WINDOWS_CLIPBOARD_SCRIPT,
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `写入 Windows 剪贴板失败（退出码 ${String(code)}）：${stderr.trim()}`,
          ),
        );
      }
    });
    child.stdin.end(value);
  });
}
