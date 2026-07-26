import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type CredentialKind = "token_plan" | "dashscope";
export type SecretKind = CredentialKind | "voice";
export type CredentialReference = `cred_${CredentialKind}_${string}`;
export type VoiceReference = `cred_voice_${string}`;
export type SecretReference = CredentialReference | VoiceReference;

export interface SecretProtector {
  protect(plaintext: string): Promise<string>;
  unprotect(ciphertext: string): Promise<string>;
}

interface VaultData {
  version: 1;
  entries: Record<
    string,
    {
      kind: SecretKind;
      protectedValue: string;
      updatedAt: string;
    }
  >;
}

export class FileCredentialVault {
  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
  ) {}

  async set(
    kind: CredentialKind,
    value: string,
  ): Promise<CredentialReference> {
    return this.setSecret(kind, value) as Promise<CredentialReference>;
  }

  async setVoice(value: string): Promise<VoiceReference> {
    return this.setSecret("voice", value) as Promise<VoiceReference>;
  }

  private async setSecret(
    kind: SecretKind,
    value: string,
  ): Promise<SecretReference> {
    if (value.trim().length === 0) {
      throw new Error("Credential must not be empty.");
    }

    const data = await this.read();
    const reference =
      `cred_${kind}_${randomUUID()}` as SecretReference;
    data.entries[reference] = {
      kind,
      protectedValue: await this.protector.protect(value),
      updatedAt: new Date().toISOString(),
    };
    await this.write(data);
    return reference;
  }

  async get(reference: SecretReference): Promise<string | undefined> {
    const entry = (await this.read()).entries[reference];
    return entry === undefined
      ? undefined
      : this.protector.unprotect(entry.protectedValue);
  }

  async delete(reference: SecretReference): Promise<boolean> {
    const data = await this.read();
    if (data.entries[reference] === undefined) {
      return false;
    }
    delete data.entries[reference];
    await this.write(data);
    return true;
  }

  private async read(): Promise<VaultData> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("version" in parsed) ||
        parsed.version !== 1 ||
        !("entries" in parsed) ||
        typeof parsed.entries !== "object" ||
        parsed.entries === null
      ) {
        throw new Error("Credential vault format is invalid.");
      }
      return parsed as VaultData;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { version: 1, entries: {} };
      }
      throw error;
    }
  }

  private async write(data: VaultData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

const DPAPI_PROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const DPAPI_UNPROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$ciphertext = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($ciphertext)
$plain = [Security.Cryptography.ProtectedData]::Unprotect(
  $bytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
`;

export class DpapiSecretProtector implements SecretProtector {
  async protect(plaintext: string): Promise<string> {
    return runPowerShell(DPAPI_PROTECT_SCRIPT, plaintext);
  }

  async unprotect(ciphertext: string): Promise<string> {
    return runPowerShell(DPAPI_UNPROTECT_SCRIPT, ciphertext);
  }
}

async function runPowerShell(script: string, input: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("DPAPI credential storage is only available on Windows.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `Windows DPAPI operation failed with exit code ${String(code)}: ${stderr.trim()}`,
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}
