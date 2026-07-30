import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CodexIntegrationManager,
  type CodexIntegrationTask,
} from "../src/codex-integration.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("CodexIntegrationManager", () => {
  it("backs up, installs, reads back, and verifies the real MCP section", async () => {
    const fixture = await createFixture();
    const original = [
      'model = "gpt-5"',
      "",
      "[projects.'C:\\\\workspace']",
      'trust_level = "trusted"',
      "",
    ].join("\n");
    await writeFile(fixture.configPath, original, "utf8");

    const manager = fixture.manager();
    const task = await waitForTask(manager, manager.start("install"));

    expect(task).toMatchObject({
      state: "succeeded",
      progress: 100,
      result: {
        status: "installed",
        verified: true,
        toolCount: 10,
      },
    });
    expect(task.steps.every((step) => step.state === "succeeded")).toBe(true);

    const content = await readFile(fixture.configPath, "utf8");
    expect(content).toContain('model = "gpt-5"');
    expect(content).toContain("[projects.'C:\\\\workspace']");
    expect(content).toContain("[mcp_servers.token-plan-media-hub]");
    expect(content).toContain(JSON.stringify(fixture.launcherPath));
    expect(content).toContain("args = []");

    const snapshot = await manager.snapshot();
    expect(snapshot.integration).toMatchObject({
      status: "installed",
      version: "0.1.0",
      verified: true,
      toolCount: 10,
    });
    expect(snapshot.backup).toMatchObject({
      available: true,
      canRollback: true,
      action: "install",
    });
  });

  it("uninstalls only the managed section and can safely roll it back", async () => {
    const fixture = await createFixture();
    const original = 'model = "gpt-5"\n';
    await writeFile(fixture.configPath, original, "utf8");
    const manager = fixture.manager();

    await waitForTask(manager, manager.start("install"));
    const installedContent = await readFile(fixture.configPath, "utf8");
    const uninstall = await waitForTask(manager, manager.start("uninstall"));

    expect(uninstall.state).toBe("succeeded");
    const uninstalledContent = await readFile(fixture.configPath, "utf8");
    expect(uninstalledContent).toContain('model = "gpt-5"');
    expect(uninstalledContent).not.toContain("token-plan-media-hub");
    expect((await manager.snapshot()).integration.status).toBe(
      "not_installed",
    );

    const rollback = await waitForTask(manager, manager.start("rollback"));
    expect(rollback.state).toBe("succeeded");
    expect(await readFile(fixture.configPath, "utf8")).toBe(installedContent);
    expect((await manager.snapshot()).integration.status).toBe("installed");
  });

  it("keeps verification but refuses rollback after an unrelated config change", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.configPath, 'model = "gpt-5"\n', "utf8");
    const manager = fixture.manager();

    await waitForTask(manager, manager.start("install"));
    await appendFile(fixture.configPath, '\nmodel_verbosity = "high"\n', "utf8");

    const snapshot = await manager.snapshot();
    expect(snapshot.integration).toMatchObject({
      status: "installed",
      verified: true,
    });
    expect(snapshot.backup.canRollback).toBe(false);
    const rollback = await waitForTask(manager, manager.start("rollback"));
    expect(rollback).toMatchObject({
      state: "failed",
      error: { code: "AGENT_CONFIG_CHANGED" },
    });
    expect(await readFile(fixture.configPath, "utf8")).toContain(
      'model_verbosity = "high"',
    );
  });

  it("automatically restores the original file when MCP smoke testing fails", async () => {
    const fixture = await createFixture();
    const original = 'model = "gpt-5"\n';
    await writeFile(fixture.configPath, original, "utf8");
    const manager = fixture.manager(async () => {
      throw Object.assign(new Error("synthetic smoke failure"), {
        code: "AGENT_SMOKE_FAILED",
      });
    });

    const task = await waitForTask(manager, manager.start("install"));
    expect(task).toMatchObject({
      state: "failed",
      rolledBack: true,
      error: { code: "AGENT_SMOKE_FAILED" },
    });
    expect(await readFile(fixture.configPath, "utf8")).toBe(original);
    expect((await manager.snapshot()).integration.status).toBe(
      "not_installed",
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "tp-media-codex-"));
  temporaryPaths.push(root);
  const configPath = join(root, ".codex", "config.toml");
  const launcherPath = join(root, "token-plan-media-mcp.exe");
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(launcherPath, "fixture", "utf8");
  return {
    configPath,
    launcherPath,
    manager(
      smokeTest: () => Promise<{
        toolCount: number;
        listModels: "passed";
      }> = async () => ({ toolCount: 10, listModels: "passed" }),
    ) {
      return new CodexIntegrationManager({
        launcher: { command: launcherPath, args: [] },
        dataRoot: join(root, "data"),
        configPath,
        smokeTest,
      });
    },
  };
}

async function waitForTask(
  manager: CodexIntegrationManager,
  started: CodexIntegrationTask,
): Promise<CodexIntegrationTask> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = manager.task(started.id);
    if (current !== undefined && current.state !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for task ${started.id}`);
}
