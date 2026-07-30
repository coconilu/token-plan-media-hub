import { createHash, randomUUID } from "node:crypto";
import {
  access,
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

import {
  type AgentLauncher,
  type AgentTaskStep,
  type CodexIntegrationAction,
  type CodexIntegrationManager,
} from "./codex-integration.js";

export type AgentIntegrationAction = CodexIntegrationAction;
export type AgentIntegrationStatus =
  | "not_installed"
  | "installed"
  | "needs_update";
export type AgentSupportStatus = "supported" | "planned";

export interface AgentIntegrationSnapshot {
  id: string;
  name: string;
  vendor: string;
  transport: "stdio MCP";
  support: {
    status: AgentSupportStatus;
    note?: string;
  };
  detected: boolean;
  detectionNote: string;
  configPath?: string;
  configExists: boolean;
  restartHint: string;
  launcher: {
    command: string;
    args: string[];
    ready: boolean;
  };
  integration: {
    id: "token-plan-media-hub";
    status: AgentIntegrationStatus;
    version?: string;
    configuredCommand?: string;
    configuredArgs?: string[];
    verified: boolean;
    verifiedAt?: string;
    toolCount?: number;
    issue?: string;
  };
  backup: {
    available: boolean;
    canRollback: boolean;
    createdAt?: string;
    action?: AgentIntegrationAction;
  };
}

export interface AgentIntegrationTask {
  id: string;
  agentId: string;
  action: AgentIntegrationAction;
  state: "running" | "succeeded" | "failed";
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
    status: AgentIntegrationStatus;
    version?: string;
    verified: boolean;
    toolCount?: number;
  };
}

export interface AgentIntegrationManager {
  snapshot(): Promise<AgentIntegrationSnapshot>;
  task(id?: string): AgentIntegrationTask | undefined;
  start(action: AgentIntegrationAction): AgentIntegrationTask;
}

export interface JsonAgentSpec {
  id: string;
  name: string;
  vendor: string;
  configPath: string;
  detectionPaths: string[];
  detectionNote: string;
  restartHint: string;
}

interface PlannedAgentSpec {
  id: string;
  name: string;
  vendor: string;
  configPath?: string;
  detectionPaths: string[];
  detectionNote: string;
  note: string;
}

export interface JsonAgentIntegrationManagerOptions {
  spec: JsonAgentSpec;
  launcher: AgentLauncher;
  dataRoot: string;
  smokeTest?: (launcher: AgentLauncher) => Promise<SmokeResult>;
}

interface BackupRecord {
  id: string;
  action: AgentIntegrationAction;
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

export interface SmokeResult {
  toolCount: number;
  listModels: "passed";
}

interface MutationContext {
  beforeContent?: string;
  backup?: BackupRecord;
  appliedHash?: string;
}

const INTEGRATION_ID = "token-plan-media-hub";
const INTEGRATION_VERSION = "0.1.0";
const EXPECTED_TOOL_COUNT = 10;

export class AgentIntegrationRegistry {
  private readonly managers = new Map<string, AgentIntegrationManager>();

  constructor(
    managers: Array<[string, AgentIntegrationManager]>,
    private readonly plannedAgents: PlannedAgentSpec[] = [],
    private readonly launcher?: AgentLauncher,
  ) {
    for (const [id, manager] of managers) this.managers.set(id, manager);
  }

  async snapshots(): Promise<AgentIntegrationSnapshot[]> {
    const supported = await Promise.all(
      [...this.managers.values()].map((manager) => manager.snapshot()),
    );
    const planned = await Promise.all(
      this.plannedAgents.map((spec) =>
        plannedSnapshot(spec, this.launcher),
      ),
    );
    return [...supported, ...planned];
  }

  tasks(): AgentIntegrationTask[] {
    return [...this.managers.values()].flatMap((manager) => {
      const task = manager.task();
      return task === undefined ? [] : [task];
    });
  }

  task(id: string): AgentIntegrationTask | undefined {
    for (const manager of this.managers.values()) {
      const task = manager.task(id);
      if (task !== undefined) return task;
    }
    return undefined;
  }

  start(
    agentId: string,
    action: AgentIntegrationAction,
  ): AgentIntegrationTask {
    const manager = this.managers.get(agentId);
    if (manager === undefined) {
      throw integrationError(
        "AGENT_NOT_SUPPORTED",
        "该 Agent 尚未开放自动配置，请等待适配完成。",
      );
    }
    return manager.start(action);
  }
}

export function createDefaultAgentIntegrationRegistry(options: {
  codexManager: CodexIntegrationManager;
  launcher: AgentLauncher;
  dataRoot: string;
}): AgentIntegrationRegistry {
  const userHome = homedir();
  const kimiHome =
    process.env.KIMI_CODE_HOME?.trim() || join(userHome, ".kimi-code");
  const jsonSpecs: JsonAgentSpec[] = [
    {
      id: "claude",
      name: "Claude Code",
      vendor: "Anthropic",
      configPath: join(userHome, ".claude.json"),
      detectionPaths: [
        join(userHome, ".claude.json"),
        join(userHome, ".claude"),
      ],
      detectionNote: "检测 Claude Code 用户配置",
      restartHint: "新建 Claude Code 会话后加载 MCP 工具。",
    },
    {
      id: "kimi",
      name: "Kimi Code CLI",
      vendor: "Moonshot AI",
      configPath: join(kimiHome, "mcp.json"),
      detectionPaths: [kimiHome],
      detectionNote: "检测 Kimi Code 用户目录",
      restartHint: "新建 Kimi Code CLI 会话后加载 MCP 工具。",
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      vendor: "Google",
      configPath: join(userHome, ".gemini", "settings.json"),
      detectionPaths: [join(userHome, ".gemini")],
      detectionNote: "检测 Gemini CLI 用户配置",
      restartHint: "新建 Gemini CLI 会话后加载 MCP 工具。",
    },
    {
      id: "cursor",
      name: "Cursor",
      vendor: "Anysphere",
      configPath: join(userHome, ".cursor", "mcp.json"),
      detectionPaths: [join(userHome, ".cursor")],
      detectionNote: "检测 Cursor 全局 MCP 配置",
      restartHint: "重新打开 Cursor Agent 会话后加载 MCP 工具。",
    },
  ];
  const supported: Array<[string, AgentIntegrationManager]> = [
    ["codex", describeCodexManager(options.codexManager)],
    ...jsonSpecs.map(
      (spec): [string, AgentIntegrationManager] => [
        spec.id,
        new JsonAgentIntegrationManager({
          spec,
          launcher: options.launcher,
          dataRoot: options.dataRoot,
        }),
      ],
    ),
  ];
  const appData = process.env.APPDATA ?? join(userHome, "AppData", "Roaming");
  const planned: PlannedAgentSpec[] = [
    {
      id: "opencode",
      name: "OpenCode",
      vendor: "Anomaly",
      configPath: join(userHome, ".config", "opencode", "opencode.json"),
      detectionPaths: [join(userHome, ".config", "opencode")],
      detectionNote: "检测 OpenCode 全局配置",
      note: "配置格式正在迁移，待完成版本识别后开放自动配置。",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      vendor: "Cognition",
      configPath: join(userHome, ".codeium", "windsurf", "mcp_config.json"),
      detectionPaths: [
        join(userHome, ".codeium", "windsurf"),
        join(appData, "Codeium", "Windsurf"),
      ],
      detectionNote: "检测 Windsurf 用户目录",
      note: "尚未完成安全的配置所有权与回滚适配。",
    },
    {
      id: "cline-roo",
      name: "Cline / Roo Code",
      vendor: "VS Code Extensions",
      detectionPaths: [
        join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev"),
        join(
          appData,
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
        ),
      ],
      detectionNote: "检测 VS Code 扩展全局存储",
      note: "扩展配置由 VS Code 管理，暂不直接修改其内部存储。",
    },
  ];
  return new AgentIntegrationRegistry(supported, planned, options.launcher);
}

export function describeCodexManager(
  manager: CodexIntegrationManager,
): AgentIntegrationManager {
  return {
    async snapshot() {
      const snapshot = await manager.snapshot();
      return {
        ...snapshot,
        vendor: "OpenAI",
        support: { status: "supported" },
        detectionNote: "检测 Codex 用户配置",
        restartHint: "新建 Codex 任务后加载 MCP 工具。",
      };
    },
    task(id) {
      return manager.task(id);
    },
    start(action) {
      return manager.start(action);
    },
  };
}

export class JsonAgentIntegrationManager
  implements AgentIntegrationManager
{
  private readonly spec: JsonAgentSpec;
  private readonly launcher: AgentLauncher;
  private readonly backupRoot: string;
  private readonly backupRecordPath: string;
  private readonly verificationRecordPath: string;
  private readonly smokeTest: (launcher: AgentLauncher) => Promise<SmokeResult>;
  private latestTask?: AgentIntegrationTask;

  constructor(options: JsonAgentIntegrationManagerOptions) {
    this.spec = options.spec;
    this.launcher = {
      command: resolve(options.launcher.command),
      args: [...options.launcher.args],
    };
    const stateRoot = join(
      options.dataRoot,
      "agent-integrations",
      this.spec.id,
    );
    this.backupRoot = join(stateRoot, "backups");
    this.backupRecordPath = join(stateRoot, "last-backup.json");
    this.verificationRecordPath = join(stateRoot, "verification.json");
    this.smokeTest = options.smokeTest ?? smokeMcp;
  }

  async snapshot(): Promise<AgentIntegrationSnapshot> {
    const config = await this.readConfig();
    const parsed = parseJsonObject(config.content);
    const configured = getMcpServer(parsed.value);
    const configuredCommand =
      isRecord(configured) && typeof configured.command === "string"
        ? configured.command
        : undefined;
    const configuredArgs =
      isRecord(configured) &&
      Array.isArray(configured.args) &&
      configured.args.every((item) => typeof item === "string")
        ? configured.args
        : undefined;
    const exact =
      configuredCommand !== undefined &&
      configuredArgs !== undefined &&
      sameCommand(configuredCommand, this.launcher.command) &&
      sameArgs(configuredArgs, this.launcher.args);
    const status: AgentIntegrationStatus =
      parsed.error !== undefined
        ? "needs_update"
        : configured === undefined
          ? "not_installed"
          : exact
            ? "installed"
            : "needs_update";
    const configHash =
      config.content === undefined ? undefined : sha256(config.content);
    const verification = await readJsonFile<VerificationRecord>(
      this.verificationRecordPath,
    );
    const verified =
      exact &&
      verification?.version === INTEGRATION_VERSION &&
      sameCommand(verification.command, this.launcher.command) &&
      sameArgs(verification.args, this.launcher.args);
    const backup = await readJsonFile<BackupRecord>(this.backupRecordPath);
    const canRollback =
      backup !== undefined &&
      backup.rolledBackAt === undefined &&
      backup.appliedHash !== undefined &&
      backup.appliedHash === configHash;
    const detected =
      config.exists ||
      (await anyPathExists(this.spec.detectionPaths));

    return {
      id: this.spec.id,
      name: this.spec.name,
      vendor: this.spec.vendor,
      transport: "stdio MCP",
      support: { status: "supported" },
      detected,
      detectionNote: this.spec.detectionNote,
      configPath: this.spec.configPath,
      configExists: config.exists,
      restartHint: this.spec.restartHint,
      launcher: {
        command: this.launcher.command,
        args: [...this.launcher.args],
        ready: await fileExists(this.launcher.command),
      },
      integration: {
        id: INTEGRATION_ID,
        status,
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
        ...(parsed.error === undefined ? {} : { issue: parsed.error }),
      },
      backup: {
        available: backup !== undefined && backup.rolledBackAt === undefined,
        canRollback,
        ...(backup?.createdAt === undefined
          ? {}
          : { createdAt: backup.createdAt }),
        ...(backup?.action === undefined ? {} : { action: backup.action }),
      },
    };
  }

  task(id?: string): AgentIntegrationTask | undefined {
    if (
      this.latestTask === undefined ||
      (id !== undefined && this.latestTask.id !== id)
    ) {
      return undefined;
    }
    return structuredClone(this.latestTask);
  }

  start(action: AgentIntegrationAction): AgentIntegrationTask {
    if (this.latestTask?.state === "running") {
      throw integrationError(
        "AGENT_TASK_RUNNING",
        `${this.spec.name} 接入任务正在执行，请等待当前任务完成。`,
      );
    }
    const task: AgentIntegrationTask = {
      id: randomUUID(),
      agentId: this.spec.id,
      action,
      state: "running",
      progress: 0,
      steps: stepsForAction(action, this.spec.name),
      startedAt: new Date().toISOString(),
    };
    this.latestTask = task;
    void this.execute(task);
    return structuredClone(task);
  }

  private async execute(task: AgentIntegrationTask): Promise<void> {
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
    task: AgentIntegrationTask,
    mutation: MutationContext,
  ): Promise<void> {
    await this.runStep(task, "environment", async () => {
      const snapshot = await this.snapshot();
      if (!snapshot.detected) {
        throw integrationError(
          "AGENT_NOT_DETECTED",
          `未检测到 ${this.spec.name}，请先安装或启动该 Agent。`,
        );
      }
      if (!snapshot.launcher.ready) {
        throw integrationError(
          "AGENT_LAUNCHER_MISSING",
          `MCP 启动器不存在：${this.launcher.command}`,
        );
      }
      const config = await this.readConfig();
      const parsed = parseJsonObject(config.content);
      if (parsed.error !== undefined) {
        throw integrationError(
          "AGENT_CONFIG_INVALID",
          parsed.error,
        );
      }
      if (config.content !== undefined) {
        mutation.beforeContent = config.content;
      }
    });
    await this.runStep(task, "backup", async () => {
      mutation.backup = await this.createBackup(
        task.action,
        mutation.beforeContent,
      );
    });
    await this.runStep(task, "write", async () => {
      const parsed = parseJsonObject(mutation.beforeContent);
      const next = setMcpServer(parsed.value ?? {}, {
        command: this.launcher.command,
        args: [...this.launcher.args],
      });
      const content = `${JSON.stringify(next, null, 2)}\n`;
      await atomicWrite(this.spec.configPath, content);
      mutation.appliedHash = sha256(content);
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
          `${this.spec.name} 配置读回结果与预期不一致。`,
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
      const content = await readFile(this.spec.configPath, "utf8");
      await atomicWrite(
        this.verificationRecordPath,
        `${JSON.stringify(
          {
            configPath: this.spec.configPath,
            configHash: sha256(content),
            command: this.launcher.command,
            args: [...this.launcher.args],
            version: INTEGRATION_VERSION,
            verifiedAt: new Date().toISOString(),
            toolCount: result.toolCount,
          } satisfies VerificationRecord,
          null,
          2,
        )}\n`,
      );
    });
  }

  private async runUninstall(
    task: AgentIntegrationTask,
    mutation: MutationContext,
  ): Promise<void> {
    await this.runStep(task, "environment", async () => {
      const config = await this.readConfig();
      const parsed = parseJsonObject(config.content);
      if (
        parsed.error !== undefined ||
        getMcpServer(parsed.value) === undefined
      ) {
        throw integrationError(
          "AGENT_NOT_INSTALLED",
          `${this.spec.name} 中没有可卸载的 Media Hub 接入。`,
        );
      }
      if (config.content !== undefined) {
        mutation.beforeContent = config.content;
      }
    });
    await this.runStep(task, "backup", async () => {
      mutation.backup = await this.createBackup(
        task.action,
        mutation.beforeContent,
      );
    });
    await this.runStep(task, "remove", async () => {
      const parsed = parseJsonObject(mutation.beforeContent);
      const next = removeMcpServer(parsed.value ?? {});
      const content = `${JSON.stringify(next, null, 2)}\n`;
      await atomicWrite(this.spec.configPath, content);
      mutation.appliedHash = sha256(content);
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
      if ((await this.snapshot()).integration.status !== "not_installed") {
        throw integrationError(
          "AGENT_CONFIG_VERIFY_FAILED",
          `卸载后仍检测到 ${this.spec.name} MCP 配置。`,
        );
      }
      await rm(this.verificationRecordPath, { force: true });
    });
  }

  private async runRollback(task: AgentIntegrationTask): Promise<void> {
    let backup: BackupRecord | undefined;
    await this.runStep(task, "environment", async () => {
      backup = await readJsonFile<BackupRecord>(this.backupRecordPath);
      if (backup === undefined || backup.rolledBackAt !== undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          `没有可用的 ${this.spec.name} 配置备份。`,
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
      const current = await this.readConfig();
      const currentHash =
        current.content === undefined ? undefined : sha256(current.content);
      if (currentHash !== backup.appliedHash) {
        throw integrationError(
          "AGENT_CONFIG_CHANGED",
          `${this.spec.name} 配置已被其他程序修改，已拒绝覆盖。`,
        );
      }
    });
    await this.runStep(task, "restore", async () => {
      if (backup?.appliedHash === undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          "没有可恢复的配置备份。",
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
          "回滚后的配置与备份指纹不一致。",
        );
      }
      await rm(this.verificationRecordPath, { force: true });
    });
  }

  private async runStep(
    task: AgentIntegrationTask,
    id: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const step = task.steps.find((candidate) => candidate.id === id);
    if (step === undefined) throw new Error(`Unknown integration step: ${id}`);
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
    action: AgentIntegrationAction,
    beforeContent: string | undefined,
  ): Promise<BackupRecord> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const record: BackupRecord = {
      id,
      action,
      configPath: this.spec.configPath,
      createdAt,
      existed: beforeContent !== undefined,
      ...(beforeContent === undefined
        ? {}
        : {
            backupPath: join(
              this.backupRoot,
              `${createdAt.replaceAll(":", "-")}-${id}.json`,
            ),
            beforeHash: sha256(beforeContent),
          }),
    };
    await mkdir(this.backupRoot, { recursive: true });
    if (record.backupPath !== undefined) {
      await atomicWrite(record.backupPath, beforeContent ?? "");
    }
    await this.writeBackupRecord(record);
    return record;
  }

  private async writeBackupRecord(record: BackupRecord): Promise<void> {
    await atomicWrite(
      this.backupRecordPath,
      `${JSON.stringify(record, null, 2)}\n`,
    );
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
        `${this.spec.name} 配置已发生变化，拒绝覆盖新的用户内容。`,
      );
    }
    if (backup.existed) {
      if (backup.backupPath === undefined) {
        throw integrationError(
          "AGENT_BACKUP_UNAVAILABLE",
          "配置备份文件缺失。",
        );
      }
      await atomicWrite(
        this.spec.configPath,
        await readFile(backup.backupPath, "utf8"),
      );
    } else {
      await rm(this.spec.configPath, { force: true });
    }
    backup.rolledBackAt = new Date().toISOString();
    await this.writeBackupRecord(backup);
    await rm(this.verificationRecordPath, { force: true });
  }

  private async readConfig(): Promise<{ exists: boolean; content?: string }> {
    try {
      return {
        exists: true,
        content: await readFile(this.spec.configPath, "utf8"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { exists: false };
      }
      throw error;
    }
  }
}

async function plannedSnapshot(
  spec: PlannedAgentSpec,
  launcher?: AgentLauncher,
): Promise<AgentIntegrationSnapshot> {
  const detected = await anyPathExists(spec.detectionPaths);
  return {
    id: spec.id,
    name: spec.name,
    vendor: spec.vendor,
    transport: "stdio MCP",
    support: { status: "planned", note: spec.note },
    detected,
    detectionNote: spec.detectionNote,
    ...(spec.configPath === undefined ? {} : { configPath: spec.configPath }),
    configExists:
      spec.configPath === undefined ? false : await pathExists(spec.configPath),
    restartHint: "适配完成后才会开放自动配置。",
    launcher: {
      command: launcher?.command ?? "",
      args: launcher?.args ?? [],
      ready:
        launcher === undefined ? false : await fileExists(launcher.command),
    },
    integration: {
      id: INTEGRATION_ID,
      status: "not_installed",
      verified: false,
    },
    backup: {
      available: false,
      canRollback: false,
    },
  };
}

function stepsForAction(
  action: AgentIntegrationAction,
  agentName: string,
): AgentTaskStep[] {
  const definitions =
    action === "uninstall"
      ? [
          ["environment", "环境检测", `检查 ${agentName} 配置和桌面权限`],
          ["backup", "配置备份", "备份当前 Agent 配置"],
          ["remove", "卸载集成", "仅移除 Media Hub MCP 配置"],
          ["readback", "读回校验", "确认配置已安全移除"],
        ]
      : action === "rollback"
        ? [
            ["environment", "备份检测", "读取最近一次可回滚备份"],
            ["conflict-check", "冲突检测", "确认配置未被其他程序修改"],
            ["restore", "恢复配置", "原子恢复操作前配置"],
            ["readback", "读回校验", "核对恢复后的配置指纹"],
          ]
        : [
            ["environment", "环境检测", `检查 ${agentName}、Gateway 与启动器`],
            ["backup", "配置备份", "备份当前 Agent 配置"],
            ["write", "安装集成", "原子写入 Media Hub MCP 配置"],
            ["readback", "读回校验", "确认命令与参数完全一致"],
            ["smoke", "可用性检查", "验证工具列表和模型列表"],
          ];
  return definitions.map(([id, title, description]) => ({
    id: id ?? "",
    title: title ?? "",
    description: description ?? "",
    state: "pending",
  }));
}

function parseJsonObject(content: string | undefined): {
  value?: Record<string, unknown>;
  error?: string;
} {
  if (content === undefined || content.trim().length === 0) return { value: {} };
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed)
      ? { value: parsed }
      : { error: "Agent 配置根节点必须是 JSON 对象。" };
  } catch {
    return { error: "Agent 配置不是有效 JSON，已停止自动修改。" };
  }
}

function getMcpServer(
  root: Record<string, unknown> | undefined,
): unknown {
  if (!isRecord(root?.mcpServers)) return undefined;
  return root.mcpServers[INTEGRATION_ID];
}

function setMcpServer(
  root: Record<string, unknown>,
  entry: { command: string; args: string[] },
): Record<string, unknown> {
  const currentServers = isRecord(root.mcpServers) ? root.mcpServers : {};
  return {
    ...root,
    mcpServers: {
      ...currentServers,
      [INTEGRATION_ID]: entry,
    },
  };
}

function removeMcpServer(
  root: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(root.mcpServers)) return root;
  const servers = { ...root.mcpServers };
  delete servers[INTEGRATION_ID];
  return {
    ...root,
    mcpServers: servers,
  };
}

async function smokeMcp(launcher: AgentLauncher): Promise<SmokeResult> {
  const client = new Client({
    name: "token-plan-media-hub-agent-installer",
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
    const payload = Array.isArray(models.content)
      ? models.content.find(
          (item): item is { type: "text"; text: string } =>
            isRecord(item) &&
            item.type === "text" &&
            typeof item.text === "string",
        )?.text
      : undefined;
    if (payload === undefined || !payload.includes('"provider"')) {
      throw integrationError(
        "AGENT_SMOKE_FAILED",
        "MCP list_models 没有返回有效模型注册表。",
      );
    }
    return { toolCount: tools.tools.length, listModels: "passed" };
  } finally {
    await client.close();
  }
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

async function anyPathExists(paths: string[]): Promise<boolean> {
  const results = await Promise.all(paths.map(pathExists));
  return results.some(Boolean);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
