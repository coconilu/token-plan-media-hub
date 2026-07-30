import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultGatewayDiscoveryPath,
  parseGatewayManifest,
  resolveMediaHubGateway,
  validateLoopbackOrigin,
} from "../src/index.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

describe("Agent Gateway discovery", () => {
  it("resolves explicit and environment addresses before the discovery file", async () => {
    await expect(
      resolveMediaHubGateway({
        explicitOrigin: "http://127.0.0.1:5401/",
        environment: { TP_MEDIA_URL: "http://127.0.0.1:5402" },
      }),
    ).resolves.toMatchObject({
      origin: "http://127.0.0.1:5401",
      source: "explicit",
    });

    await expect(
      resolveMediaHubGateway({
        environment: { TP_MEDIA_URL: "http://127.0.0.1:5402" },
      }),
    ).resolves.toMatchObject({
      origin: "http://127.0.0.1:5402",
      source: "environment",
    });
  });

  it("reads a valid desktop discovery manifest", async () => {
    const root = await temporaryDirectory("tp-media-gateway-");
    const discoveryFile = join(root, "agent-gateway.json");
    await writeFile(
      discoveryFile,
      JSON.stringify({
        schemaVersion: 1,
        service: "token-plan-media-hub",
        transport: "loopback-http",
        origin: "http://127.0.0.1:54321",
        pid: 1234,
        startedAt: "2026-07-26T08:00:00.000Z",
      }),
      "utf8",
    );

    await expect(
      resolveMediaHubGateway({
        discoveryFile,
        environment: {},
      }),
    ).resolves.toMatchObject({
      origin: "http://127.0.0.1:54321",
      source: "discovery",
      discoveryFile,
    });
  });

  it("uses 4317 only when no discovery file exists", async () => {
    const root = await temporaryDirectory("tp-media-gateway-");
    await expect(
      resolveMediaHubGateway({
        discoveryFile: join(root, "missing.json"),
        environment: {},
      }),
    ).resolves.toMatchObject({
      origin: "http://127.0.0.1:4317",
      source: "development-fallback",
    });
  });

  it("rejects malformed, remote, and path-bearing gateway origins", async () => {
    const root = await temporaryDirectory("tp-media-gateway-");
    const discoveryFile = join(root, "agent-gateway.json");
    await writeFile(discoveryFile, "{not-json", "utf8");

    await expect(
      resolveMediaHubGateway({ discoveryFile, environment: {} }),
    ).rejects.toThrow("Agent Gateway 发现文件无效");
    expect(() => validateLoopbackOrigin("https://127.0.0.1:4317")).toThrow();
    expect(() => validateLoopbackOrigin("http://localhost:4317")).toThrow();
    expect(() => validateLoopbackOrigin("http://127.0.0.1:4317/api")).toThrow();
    expect(() =>
      parseGatewayManifest({
        schemaVersion: 1,
        service: "other-service",
        transport: "loopback-http",
        origin: "http://127.0.0.1:4317",
        pid: 1,
        startedAt: "2026-07-26T08:00:00.000Z",
      }),
    ).toThrow();
  });

  it("matches Tauri app-local-data conventions", () => {
    expect(
      defaultGatewayDiscoveryPath({
        platform: "win32",
        environment: { LOCALAPPDATA: "C:\\Local" },
        homeDirectory: "C:\\Users\\test",
      }),
    ).toBe(
      "C:\\Local\\com.bayeswang.token-plan-media-hub\\agent-gateway.json",
    );
    expect(
      defaultGatewayDiscoveryPath({
        platform: "win32",
        environment: {},
        homeDirectory: "C:\\Users\\test",
      }),
    ).toBe(
      "C:\\Users\\test\\AppData\\Local\\com.bayeswang.token-plan-media-hub\\agent-gateway.json",
    );
  });
});
