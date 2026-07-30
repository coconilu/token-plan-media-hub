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
  JsonAgentIntegrationManager,
  type AgentIntegrationTask,
} from "../src/agent-integrations.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("JsonAgentIntegrationManager", () => {
  it("preserves unrelated JSON settings while installing and uninstalling MCP", async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(
        {
          theme: "dark",
          mcpServers: {
            existing: { command: "existing-mcp", args: ["--safe"] },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manager = fixture.manager();
    const install = await waitForTask(manager, manager.start("install"));
    expect(install).toMatchObject({
      state: "succeeded",
      result: { status: "installed", verified: true, toolCount: 10 },
    });

    const installed = JSON.parse(
      await readFile(fixture.configPath, "utf8"),
    ) as {
      theme: string;
      mcpServers: Record<
        string,
        { command: string; args: string[] }
      >;
    };
    expect(installed.theme).toBe("dark");
    expect(installed.mcpServers.existing).toEqual({
      command: "existing-mcp",
      args: ["--safe"],
    });
    expect(installed.mcpServers["token-plan-media-hub"]).toEqual({
      command: fixture.launcherPath,
      args: [],
    });

    const uninstall = await waitForTask(manager, manager.start("uninstall"));
    expect(uninstall.state).toBe("succeeded");
    const uninstalled = JSON.parse(
      await readFile(fixture.configPath, "utf8"),
    ) as { theme: string; mcpServers: Record<string, unknown> };
    expect(uninstalled.theme).toBe("dark");
    expect(uninstalled.mcpServers.existing).toBeDefined();
    expect(uninstalled.mcpServers["token-plan-media-hub"]).toBeUndefined();
  });

  it("rejects invalid JSON and never overwrites the user's config", async () => {
    const fixture = await createFixture();
    const invalid = '{ "theme": "dark",\n';
    await writeFile(fixture.configPath, invalid, "utf8");
    const manager = fixture.manager();

    expect((await manager.snapshot()).integration).toMatchObject({
      status: "needs_update",
      issue: "Agent 配置不是有效 JSON，已停止自动修改。",
    });
    const task = await waitForTask(manager, manager.start("repair"));
    expect(task).toMatchObject({
      state: "failed",
      error: { code: "AGENT_CONFIG_INVALID" },
    });
    expect(await readFile(fixture.configPath, "utf8")).toBe(invalid);
  });

  it("keeps verification but refuses rollback after an unrelated JSON edit", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.configPath, '{\n  "theme": "dark"\n}\n', "utf8");
    const manager = fixture.manager();

    await waitForTask(manager, manager.start("install"));
    await appendFile(fixture.configPath, "\n", "utf8");
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
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "tp-media-json-agent-"));
  temporaryPaths.push(root);
  const configRoot = join(root, "agent");
  const configPath = join(configRoot, "settings.json");
  const launcherPath = join(root, "token-plan-media-mcp.exe");
  await mkdir(configRoot, { recursive: true });
  await writeFile(launcherPath, "fixture", "utf8");
  return {
    configPath,
    launcherPath,
    manager() {
      return new JsonAgentIntegrationManager({
        spec: {
          id: "fixture",
          name: "Fixture Agent",
          vendor: "Fixture",
          configPath,
          detectionPaths: [configRoot],
          detectionNote: "检测测试配置",
          restartHint: "新建任务加载 MCP。",
        },
        launcher: { command: launcherPath, args: [] },
        dataRoot: join(root, "data"),
        async smokeTest() {
          return { toolCount: 10, listModels: "passed" };
        },
      });
    },
  };
}

async function waitForTask(
  manager: JsonAgentIntegrationManager,
  started: AgentIntegrationTask,
): Promise<AgentIntegrationTask> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = manager.task(started.id);
    if (current !== undefined && current.state !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for task ${started.id}`);
}
