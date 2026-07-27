import { createHash, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const AGENT_ID = "codex" as const;
const INTEGRATION_ID = "token-plan-media-hub";
const INTEGRATION_VERSION = "0.1.0";
const EXPECTED_TOOL_COUNT = 10;
const SECTION_HEADER =
  /^\s*\[mcp_servers\.(?:"token-plan-media-hub"|token-plan-media-hub)\]\s*(?:#.*)?$/;
const ANY_SECTION_HEADER = /^\s*\[[^\]]+\]\s*(?:#.*)?$/;

export type CodexIntegrationAction =
  | "install"
  | "update"
  | "repair"
  | "uninstall"
  | "rollback";

export type CodexIntegrationStatus =
  | "not_installed"
  | "installed"
  | "needs_update";

export type AgentTaskState = "running" | "succeeded" | "failed";
export type AgentTaskStepState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export interface AgentLauncher {
  command: string;
  args: string[];
}

export interface CodexIntegrationSnapshot {
  id: typeof AGENT_ID;
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
    id: typeof INTEGRATION_ID;
    status: CodexIntegrationStatus;
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
    action?: CodexIntegrationAction;
  };
}

export interface AgentTaskStep {
  id: string;
  title: string;
  description: string;
  state: AgentTaskStepState;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CodexIntegrationTask {
  id: string;
  agentId: typeof AGENT_ID;
  action: CodexIntegrationAction;
  state: AgentTaskState;
  progress: number;
  steps: AgentTaskStep[];
  startedAt: string;
  completedAt?: string;
  rolledBack?: boolean;
  error?: {
    code: string;
    message: string;
  };
  result?: {
    status: CodexIntegrationStatus;
    version?: string;
    verified: boolean;
    toolCount?: number;
  };
}

interface BackupRecord {
  id: string;
  action: CodexIntegrationAction;
  configPath: string;
  createdAt: string;
  existed: boolean;
  backupPath?: string;
  beforeHash?: string;
  appliedHash?: string;
  rolledBackAt?: string;
}

interface VerificationRecord {
  configPath: string;
  configHash: string;
  command: string;
  args: string[];
  version: string;
  verifiedAt: string;
  toolCount: number;
}

interface SmokeResult {
  toolCount: number;
  listModels: "passed";
}

interface CodexIntegrationManagerOptions {
  launcher: AgentLauncher;
  dataRoot: string;
  configPath?: string;
  smokeTest?: (launcher: AgentLauncher) => Promise<SmokeResult>;
}

interface MutationContext {
  beforeContent?: string;
  backup?: BackupRecord;
  appliedHash?: string;
}

export class CodexIntegrationManager {
  private readonly launcher: AgentLauncher;
  private readonly configPath: string;
  private readonly backupRoot: string;
  private readonly backupRecordPath: string;
  private readonly verificationRecordPath: string;
  private readonly smokeTest: (launcher: AgentLauncher) => Promise<SmokeResult>;
  private latestTask?: CodexIntegrationTask;

  constructor(options: CodexIntegrationManagerOptions) {
    this.launcher = {
      command: resolve(options.launcher.command),
      args: [...options.launcher.args],
    };
    this.configPath =
      options.configPath ?? join(homedir(), ".codex", "config.toml");
    this.backupRoot = join(
      options.dataRoot,
      "agent-integrations",
      AGENT_ID,
      "backups",
    );
    this.backupRecordPath = join(
      options.dataRoot,
      "agent-integrations",
      AGENT_ID,
      "last-backup.json",
    );
    this.verificationRecordPath = join(
      options.dataRoot,
      "agent-integrations",
      AGENT_ID,
      "verification.json",
    );
    this.smokeTest = options.smokeTest ?? smokeCodexMcp;
  }

  async snapshot(): Promise<CodexIntegrationSnapshot> {
    const config = await this.readConfig();
    const section = config.content === undefined
      ? undefined
      : readManagedSection(config.content);
    const configuredCommand =
      section === undefined ? undefined : parseTomlString(section, "command");
    const configuredArgs =
      section === undefined ? undefined : parseTomlStringArray(section, "args");
    const exact =
      configuredCommand !== undefined &&
      configuredArgs !== undefined &&
      sameCommand(configuredCommand, this.launcher.command) &&
      sameArgs(configuredArgs, this.launcher.args);
    const integrationStatus: CodexIntegrationStatus =
      section === undefined
        ? "not_installed"
        : exact
          ? "installed"
          : "needs_update";
    const launcherReady = await fileExists(this.launcher.command);
    const codexDirectory = dirname(this.configPath);
    const detected =
      config.exists || await directoryExists(codexDirectory);
    const backup = await this.readBackupRecord();
    const configHash =
      config.content === undefined ? undefined : sha256(config.content);
    const verification = await this.readVerificationRecord();
    const verified =
      exact &&
      configHash !== undefined &&
      verification?.configHash === configHash &&
      sameCommand(verification.command, this.launcher.command) &&
      sameArgs(verification.args, this.launcher.args);
    const canRollback =
      backup !== undefined &&
      backup.rolledBackAt === undefined &&
      backup.appliedHash !== undefined &&
      backup.appliedHash === configHash;

    return {
      id: AGENT_ID,
      name: "Codex",
      transport: "stdio MCP",
      detected,
      configPath: this.configPath,
      configExists: config.exists,
      launcher: {
        command: this.launcher.command,
        args: [...this.launcher.args],
        ready: launcherReady,
      },
      integration: {
        id: INTEGRATION_ID,
        status: integrationStatus,
        ...(exact ? { version: INTEGRATION_VERSION } : {}),
        ...(configuredCommand === undefined ? {} : { configuredCommand }),
        ...(configuredArgs === undefined ? {} : { configuredArgs }),
        verified,
        ...(verified && verification !== undefined
          ? {
              verifiedAt: verification.verifiedAt,
              toolCount: verification.toolCount,
            }
          : {}),
      },
      backup: {
        available: backup !== undefined && backup.rolledBackAt === undefined,
        canRollback,
        ...(backup === undefined ? {} : { createdAt: backup.createdAt }),
        ...(backup === undefined ? {} : { action: backup.action }),
      },
    };
  }

  task(id?: string): CodexIntegrationTask | undefined {
    if (
      this.latestTask === undefined ||
      (id !== undefined && this.latestTask.id !== id)
    ) {
      return undefined;
    }
    return structuredClone(this.latestTask);
  }

  start(action: CodexIntegrationAction): CodexIntegrationTask {
    if (this.latestTask?.state === "running") {
      throw integrationError(
        "AGENT_TASK_RUNNING",
        "Codex 接入任务正在执行，请等待当前任务完成。",
      );
    }
    const task: CodexIntegrationTask = {
      id: randomUUID(),
      agentId: AGENT_ID,
      action,
      state: "running",
      progress: 0,
      steps: stepsForAction(action),
      startedAt: new Date().toISOString(),
    };
    this.latestTask = task;
    void this.execute(task);
    return structuredClone(task);
  }

  private async execute(task: CodexIntegrationTask): Promise<void> {
    const mutation: MutationContext = {};
    try {
      if (
        task.action === "install" ||
        task.action === "update" ||
        task.action === "repair"
      ) {
        await this.runInstall(task, mutation);
      } else if (task.action === "uninstall") {
        await this.runUninstall(task, mutation);
      } else {
        await this.runRollback(task);
      }
      const snapshot = await this.snapshot();
      task.state = "succeeded";
      task.progress = 100;
      task.completedAt = new Date().toISOString();
      task.result = {
        status: snapshot.integration.status,
        ...(snapshot.integration.version === undefined
          ? {}
          : { version: snapshot.integration.version }),
        verified: snapshot.integration.verified,
        ...(snapshot.integration.toolCount === undefined
          ? {}
          : { toolCount: snapshot.integration.toolCount }),
      };
    } catch (error) {
      const candidate = normalizeError(error);
      if (
        mutation.backup !== undefined &&
        mutation.appliedHash !== undefined &&
        task.action !== "rollback"
      ) {
        try {
          await this.restoreBackup(mutation.backup, mutation.appliedHash);
          task.rolledBack = true;
        } catch (rollbackError) {
          candidate.message = `${candidate.message} 自动回滚失败：${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`;
        }
      }
      const activeStep = task.steps.find((step) => step.state === "running");
      if (activeStep !== undefined) {
        activeStep.state = "failed";
        activeStep.completedAt = new Date().toISOString();
        activeStep.error = candidate.message;
      }
      task.state = "failed";
      task.completedAt = new Date().toISOString();
      task.error = candidate;
    }
  }

  private async runInstall(
    task: CodexIntegrationTask,
    mutation: MutationContext,
  ): Promise<void> {
    await this.runStep(task, "environment", async () => {
      if (!(await fileExists(this.launcher.command))) {
        throw integrationError(
          "AGENT_LAUNCHER_MISSING",
          `MCP 启动器不存在：${this.launcher.command}`,
        );
      }
      await mkdir(dirname(this.configPath), { recursive: true });
      const content = (await this.readConfig()).content;
      if (content !== undefined) mutation.beforeContent = content;
    });
    await this.runStep(task, "backup", async () => {
      mutation.backup = await this.createBackup(
        task.action,
        mutation.beforeContent,
      );
    });
    await this.runStep(task, "write", async () => {
      const next = upsertManagedSection(
        mutation.beforeContent ?? "",
        this.launcher,
      );
      await atomicWrite(this.configPath, next);
      mutation.appliedHash = sha256(next);
      if (mutation.backup === undefined) {
        throw integrationError(
          "AGENT_BACKUP_MISSING",
          "配置备份记录缺失，已停止接入。",
        );
      }
      mutation.backup.appliedHash = mutation.appliedHash;
      await this.writeBackupRecord(mutation.backup);
    });
    await this.runStep(task, "readback", async () => {
      const snapshot = await this.snapshot();
      if (snapshot.integration.status !== "installed") {
        throw integrationError(
          "AGENT_CONFIG_VERIFY_FAILED",
          "Codex 配置读回结果与预期不一致。",
        );
      }
    });
    await this.runStep(task, "smoke", async () => {
      const result = await this.smokeTest(this.launcher);
      if (result.toolCount !== EXPECTED_TOOL_COUNT) {
        throw integrationError(
          "AGENT_SMOKE_FAILED",
          `MCP 工具数量异常：预期 ${EXPECTED_TOOL_COUNT}，实际 ${result.toolCount}。`,
        );
      }
      const content = await readFile(this.configPath, "utf8");
      await this.writeVerificationRecord({
        configPath: this.configPath,
        configHash: sha256(content),
        command: this.launcher.command,
        args: [...this.launcher.args],
        version: INTEGRATION_VERSION,
        verifiedAt: new Date().toISOString(),
        toolCount: result.toolCount,
      });
    });
  }

  private async runUninstall(
    task: CodexIntegrationTask,
    mutation: MutationContext,
  ): Promise<void> {
    await this.runStep(task, "environment", async () => {
      const config = await this.readConfig();
      if (
        config.content === undefined ||
        readManagedSection(config.content) === undefined
      ) {
        throw integrationError(
          "AGENT_NOT_INSTALLED",
          "Codex 中没有可卸载的 Token Plan Media Hub 接入。",
        );
      }
      mutation.beforeContent = config.content;
    });
    await this.runStep(task, "backup", async () => {
      mutation.backup = await this.createBackup(
        task.action,
        mutation.beforeContent,
      );
    });
    await this.runStep(task, "remove", async () => {
      const next = removeManagedSection(mutation.beforeContent ?? "");
      await atomicWrite(this.configPath, next);
      mutation.appliedHash = sha256(next);
      if (mutation.backup === undefined) {
        throw integrationError(
          "AGENT_BACKUP_MISSING",
          "配置备份记录缺失，已停止卸载。",
        );
      }
      mutation.backup.appliedHash = mutation.appliedHash;
      await this.writeBackupRecord(mutation.backup);
    });
    await this.runStep(task, "readback", async () => {
      const snapshot = await this.snapshot();
      if (snapshot.integration.status !== "not_installed") {
        throw integrationError(
          "AGENT_CONFIG_VERIFY_FAILED",
          "卸载后仍检测到 Codex MCP 配置。",
        );
      }
      await rm(this.verificationRecordPath, { force: true });
    });
  }

  private async runRollback(task: CodexIntegrationTask): Promise<void> {
    let backup: BackupRecord | undefined;
    await this.runStep(task, "environment", async () => {
      backup = await this.readBackupRecord();
      if (backup === undefined || backup.rolledBackAt !== undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          "没有可用的 Codex 配置备份。",
        );
      }
    });
    await this.runStep(task, "conflict-check", async () => {
      if (backup?.appliedHash === undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          "备份缺少已应用配置指纹，无法安全回滚。",
        );
      }
      const current = await readFile(this.configPath, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      const currentHash = current === undefined ? undefined : sha256(current);
      if (currentHash !== backup.appliedHash) {
        throw integrationError(
          "AGENT_CONFIG_CHANGED",
          "Codex 配置在接入操作后被其他程序修改。为避免覆盖新内容，已拒绝自动回滚。",
        );
      }
    });
    await this.runStep(task, "restore", async () => {
      if (backup === undefined || backup.appliedHash === undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          "没有可恢复的 Codex 配置备份。",
        );
      }
      await this.restoreBackup(backup, backup.appliedHash);
    });
    await this.runStep(task, "readback", async () => {
      if (backup === undefined) return;
      const config = await this.readConfig();
      const restoredHash =
        config.content === undefined ? undefined : sha256(config.content);
      if (restoredHash !== backup.beforeHash) {
        throw integrationError(
          "AGENT_ROLLBACK_VERIFY_FAILED",
          "回滚后的 Codex 配置与备份指纹不一致。",
        );
      }
      await rm(this.verificationRecordPath, { force: true });
    });
  }

  private async runStep(
    task: CodexIntegrationTask,
    id: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const step = task.steps.find((candidate) => candidate.id === id);
    if (step === undefined) {
      throw new Error(`Unknown Codex integration step: ${id}`);
    }
    step.state = "running";
    step.startedAt = new Date().toISOString();
    await action();
    step.state = "succeeded";
    step.completedAt = new Date().toISOString();
    task.progress = Math.round(
      (task.steps.filter((candidate) => candidate.state === "succeeded").length /
        task.steps.length) *
        100,
    );
  }

  private async createBackup(
    action: CodexIntegrationAction,
    beforeContent: string | undefined,
  ): Promise<BackupRecord> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const backup: BackupRecord = {
      id,
      action,
      configPath: this.configPath,
      createdAt,
      existed: beforeContent !== undefined,
      ...(beforeContent === undefined
        ? {}
        : {
            backupPath: join(
              this.backupRoot,
              `${createdAt.replaceAll(":", "-")}-${id}.toml`,
            ),
            beforeHash: sha256(beforeContent),
          }),
    };
    await mkdir(this.backupRoot, { recursive: true });
    if (backup.backupPath !== undefined) {
      await copyFile(this.configPath, backup.backupPath);
    }
    await this.writeBackupRecord(backup);
    return backup;
  }

  private async restoreBackup(
    backup: BackupRecord,
    expectedAppliedHash: string,
  ): Promise<void> {
    const config = await this.readConfig();
    const currentHash =
      config.content === undefined ? undefined : sha256(config.content);
    if (currentHash !== expectedAppliedHash) {
      throw integrationError(
        "AGENT_CONFIG_CHANGED",
        "Codex 配置已发生变化，拒绝覆盖新的用户内容。",
      );
    }
    if (backup.existed) {
      if (backup.backupPath === undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          "Codex 配置备份文件缺失。",
        );
      }
      const content = await readFile(backup.backupPath, "utf8");
      await atomicWrite(this.configPath, content);
    } else {
      await rm(this.configPath, { force: true });
    }
    backup.rolledBackAt = new Date().toISOString();
    await this.writeBackupRecord(backup);
    await rm(this.verificationRecordPath, { force: true });
  }

  private async readConfig(): Promise<{
    exists: boolean;
    content?: string;
  }> {
    try {
      return {
        exists: true,
        content: await readFile(this.configPath, "utf8"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false };
      }
      throw error;
    }
  }

  private async readBackupRecord(): Promise<BackupRecord | undefined> {
    return readJsonFile<BackupRecord>(this.backupRecordPath);
  }

  private async writeBackupRecord(record: BackupRecord): Promise<void> {
    await atomicWrite(
      this.backupRecordPath,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }

  private async readVerificationRecord():
    Promise<VerificationRecord | undefined> {
    return readJsonFile<VerificationRecord>(this.verificationRecordPath);
  }

  private async writeVerificationRecord(
    record: VerificationRecord,
  ): Promise<void> {
    await atomicWrite(
      this.verificationRecordPath,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
}

async function smokeCodexMcp(
  launcher: AgentLauncher,
): Promise<SmokeResult> {
  const client = new Client({
    name: "token-plan-media-hub-desktop-installer",
    version: INTEGRATION_VERSION,
  });
  const transport = new StdioClientTransport({
    command: launcher.command,
    args: launcher.args,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const models = await client.callTool({
      name: "list_models",
      arguments: {},
    });
    const modelPayload = Array.isArray(models.content)
      ? models.content.find(
          (item): item is { type: "text"; text: string } =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text" &&
            "text" in item &&
            typeof item.text === "string",
        )?.text
      : undefined;
    if (
      modelPayload === undefined ||
      !modelPayload.includes('"provider"')
    ) {
      throw integrationError(
        "AGENT_SMOKE_FAILED",
        "MCP list_models 没有返回有效模型注册表。",
      );
    }
    return {
      toolCount: tools.tools.length,
      listModels: "passed",
    };
  } finally {
    await client.close();
  }
}

function stepsForAction(action: CodexIntegrationAction): AgentTaskStep[] {
  const definitions =
    action === "uninstall"
      ? [
          ["environment", "环境检测", "检查 Codex 配置和桌面权限"],
          ["backup", "配置备份", "备份当前 config.toml"],
          ["remove", "卸载集成", "仅移除 Media Hub MCP 配置段"],
          ["readback", "读回校验", "确认配置段已安全移除"],
        ]
      : action === "rollback"
        ? [
            ["environment", "备份检测", "读取最近一次可回滚备份"],
            [
              "conflict-check",
              "冲突检测",
              "确认配置未被其他程序再次修改",
            ],
            ["restore", "恢复配置", "原子恢复操作前 config.toml"],
            ["readback", "读回校验", "核对恢复后的配置指纹"],
          ]
        : [
            ["environment", "环境检测", "检查 Codex、Gateway 与 MCP 启动器"],
            ["backup", "配置备份", "备份当前 config.toml"],
            ["write", "安装集成", "原子写入 Media Hub MCP 配置"],
            ["readback", "读回校验", "确认命令与参数完全一致"],
            ["smoke", "MCP 烟测", "验证 10 个工具和 list_models"],
          ];
  return definitions.map(([id, title, description]) => ({
    id: id ?? "",
    title: title ?? "",
    description: description ?? "",
    state: "pending",
  }));
}

function readManagedSection(content: string): string | undefined {
  const range = managedSectionRange(content);
  return range === undefined ? undefined : content.slice(range.start, range.end);
}

function upsertManagedSection(
  content: string,
  launcher: AgentLauncher,
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const section = [
    `[mcp_servers.${INTEGRATION_ID}]`,
    `# managed-by = "${INTEGRATION_ID}@${INTEGRATION_VERSION}"`,
    `command = ${tomlString(launcher.command)}`,
    `args = [${launcher.args.map(tomlString).join(", ")}]`,
  ].join(eol);
  const range = managedSectionRange(content);
  if (range !== undefined) {
    return `${content.slice(0, range.start)}${section}${content.slice(range.end)}`;
  }
  const trimmed = content.replace(/\s+$/u, "");
  return `${trimmed}${trimmed.length === 0 ? "" : `${eol}${eol}`}${section}${eol}`;
}

function removeManagedSection(content: string): string {
  const range = managedSectionRange(content);
  if (range === undefined) return content;
  const before = content.slice(0, range.start).replace(/[ \t]+$/u, "");
  const after = content.slice(range.end).replace(/^(?:\r?\n)+/u, "");
  if (before.trim().length === 0) return after;
  if (after.length === 0) return `${before.trimEnd()}\n`;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return `${before.trimEnd()}${eol}${eol}${after}`;
}

function managedSectionRange(
  content: string,
): { start: number; end: number } | undefined {
  const lines = content.match(/.*(?:\r?\n|$)/gu) ?? [];
  let offset = 0;
  let start: number | undefined;
  for (const line of lines) {
    const lineWithoutEol = line.replace(/\r?\n$/u, "");
    if (start === undefined) {
      if (SECTION_HEADER.test(lineWithoutEol)) start = offset;
    } else if (ANY_SECTION_HEADER.test(lineWithoutEol)) {
      return { start, end: offset };
    }
    offset += line.length;
  }
  return start === undefined ? undefined : { start, end: content.length };
}

function parseTomlString(section: string, key: string): string | undefined {
  const match = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*(?:#.*)?$`,
    "mu",
  ).exec(section);
  if (match?.[1] === undefined) return undefined;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return undefined;
  }
}

function parseTomlStringArray(
  section: string,
  key: string,
): string[] | undefined {
  const match = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*(\\[[^\\]]*\\])\\s*(?:#.*)?$`,
    "mu",
  ).exec(section);
  if (match?.[1] === undefined) return undefined;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${INTEGRATION_ID}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, content, "utf8");
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function sameCommand(left: string, right: string): boolean {
  const normalizedLeft = normalize(resolve(left));
  const normalizedRight = normalize(resolve(right));
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function sameArgs(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function integrationError(code: string, message: string): Error & {
  code: string;
  retryable: boolean;
} {
  return Object.assign(new Error(message), { code, retryable: false });
}

function normalizeError(error: unknown): {
  code: string;
  message: string;
} {
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code:
      typeof candidate.code === "string"
        ? candidate.code
        : "AGENT_INTEGRATION_FAILED",
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : String(error),
  };
}
