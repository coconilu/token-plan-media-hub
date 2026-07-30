import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertPeSubsystem,
  peSubsystemVerificationPlan,
  readPeSubsystem,
  verifyPeSubsystemForPlatform,
  WINDOWS_CONSOLE_SUBSYSTEM,
  WINDOWS_GUI_SUBSYSTEM,
} from "./verify-pe-subsystem.mjs";

test("非 Windows 平台在读取产物前明确跳过", async () => {
  for (const platform of ["linux", "darwin"]) {
    const messages = [];
    const result = await verifyPeSubsystemForPlatform(
      join(tmpdir(), "missing-windows-artifact.exe"),
      WINDOWS_GUI_SUBSYSTEM,
      {
        platform,
        write: (message) => messages.push(message),
      },
    );
    assert.deepEqual(result, { status: "skipped", platform });
    assert.equal(peSubsystemVerificationPlan(platform).verify, false);
    assert.match(messages.join(""), /仅适用于 Windows 产物/);
    assert.match(messages.join(""), new RegExp(platform));
  }
});

test("Windows 平台不会把缺失产物静默当作通过", async () => {
  await assert.rejects(
    verifyPeSubsystemForPlatform(
      join(tmpdir(), "missing-windows-artifact.exe"),
      WINDOWS_GUI_SUBSYSTEM,
      {
        platform: "win32",
        write: () => {},
      },
    ),
    (error) => error?.code === "ENOENT",
  );
});

test("解析并验证 Windows GUI 与 Console Subsystem", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "media-hub-pe-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const guiPath = join(directory, "gui.exe");
  const consolePath = join(directory, "console.exe");
  await Promise.all([
    writeFile(guiPath, createPeExecutable(WINDOWS_GUI_SUBSYSTEM)),
    writeFile(consolePath, createPeExecutable(WINDOWS_CONSOLE_SUBSYSTEM)),
  ]);

  assert.equal(await readPeSubsystem(guiPath), WINDOWS_GUI_SUBSYSTEM);
  assert.equal(await readPeSubsystem(consolePath), WINDOWS_CONSOLE_SUBSYSTEM);
  await assertPeSubsystem(guiPath, WINDOWS_GUI_SUBSYSTEM, () => {});
  await assertPeSubsystem(consolePath, WINDOWS_CONSOLE_SUBSYSTEM, () => {});
});

test("Windows Subsystem 不匹配时明确失败", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "media-hub-pe-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const consolePath = join(directory, "console.exe");
  await writeFile(
    consolePath,
    createPeExecutable(WINDOWS_CONSOLE_SUBSYSTEM),
  );

  await assert.rejects(
    assertPeSubsystem(consolePath, WINDOWS_GUI_SUBSYSTEM, () => {}),
    /期望 Windows GUI \(2\)，实际为 Windows Console \(3\)/,
  );
});

function createPeExecutable(subsystem) {
  const peOffset = 0x80;
  const optionalHeaderOffset = peOffset + 24;
  const optionalHeaderSize = 0xf0;
  const executable = Buffer.alloc(optionalHeaderOffset + optionalHeaderSize);
  executable.write("MZ", 0, "ascii");
  executable.writeUInt32LE(peOffset, 0x3c);
  executable.writeUInt32LE(0x00004550, peOffset);
  executable.writeUInt16LE(optionalHeaderSize, peOffset + 20);
  executable.writeUInt16LE(0x020b, optionalHeaderOffset);
  executable.writeUInt16LE(subsystem, optionalHeaderOffset + 68);
  return executable;
}
