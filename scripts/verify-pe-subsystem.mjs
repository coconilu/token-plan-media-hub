import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PE_SIGNATURE = 0x00004550;
const PE32_MAGIC = 0x010b;
const PE32_PLUS_MAGIC = 0x020b;
const SUBSYSTEM_OFFSET = 68;

export const WINDOWS_GUI_SUBSYSTEM = 2;
export const WINDOWS_CONSOLE_SUBSYSTEM = 3;

export async function readPeSubsystem(path) {
  const executable = await readFile(path);
  if (
    executable.length < 64 ||
    executable[0] !== 0x4d ||
    executable[1] !== 0x5a
  ) {
    throw new Error(`文件不是有效的 PE 可执行文件：${path}`);
  }

  const peOffset = executable.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  if (
    peOffset + 24 > executable.length ||
    executable.readUInt32LE(peOffset) !== PE_SIGNATURE
  ) {
    throw new Error(`文件缺少有效的 PE 签名：${path}`);
  }

  const optionalHeaderSize = executable.readUInt16LE(peOffset + 20);
  if (
    optionalHeaderSize < SUBSYSTEM_OFFSET + 2 ||
    optionalHeaderOffset + optionalHeaderSize > executable.length
  ) {
    throw new Error(`文件的 PE Optional Header 无效：${path}`);
  }

  const magic = executable.readUInt16LE(optionalHeaderOffset);
  if (magic !== PE32_MAGIC && magic !== PE32_PLUS_MAGIC) {
    throw new Error(
      `文件使用了不支持的 PE Optional Header 格式 0x${magic.toString(16)}：${path}`,
    );
  }
  return executable.readUInt16LE(optionalHeaderOffset + SUBSYSTEM_OFFSET);
}

export async function assertPeSubsystem(path, expected) {
  const subsystem = await readPeSubsystem(path);
  if (subsystem !== expected) {
    throw new Error(
      `PE Subsystem 回归：期望 ${formatSubsystem(expected)}，实际为 ${formatSubsystem(subsystem)}：${path}`,
    );
  }
  process.stdout.write(
    `PE Subsystem 验证通过：${formatSubsystem(subsystem)}：${path}\n`,
  );
}

export function formatSubsystem(subsystem) {
  if (subsystem === WINDOWS_GUI_SUBSYSTEM) {
    return "Windows GUI (2)";
  }
  if (subsystem === WINDOWS_CONSOLE_SUBSYSTEM) {
    return "Windows Console (3)";
  }
  return `Unknown (${subsystem})`;
}

async function main() {
  const [expectedName, executablePath, ...extraArguments] =
    process.argv.slice(2);
  if (
    extraArguments.length > 0 ||
    executablePath === undefined ||
    !["gui", "console"].includes(expectedName)
  ) {
    throw new Error(
      "用法：node scripts/verify-pe-subsystem.mjs <gui|console> <executable>",
    );
  }
  await assertPeSubsystem(
    resolve(executablePath),
    expectedName === "gui"
      ? WINDOWS_GUI_SUBSYSTEM
      : WINDOWS_CONSOLE_SUBSYSTEM,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
