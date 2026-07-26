import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DpapiSecretProtector,
  FileCredentialVault,
  type SecretProtector,
} from "../src/index.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

class TestProtector implements SecretProtector {
  async protect(plaintext: string): Promise<string> {
    return Buffer.from(plaintext, "utf8").toString("base64");
  }

  async unprotect(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext, "base64").toString("utf8");
  }
}

describe("credential vault", () => {
  it("stores independent protected references without plaintext", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tp-media-vault-"));
    temporaryPaths.push(directory);
    const path = join(directory, "credentials.json");
    const vault = new FileCredentialVault(path, new TestProtector());

    const tokenPlanReference = await vault.set(
      "token_plan",
      "synthetic-token-plan-secret",
    );
    const dashscopeReference = await vault.set(
      "dashscope",
      "synthetic-dashscope-secret",
    );
    const serialized = await readFile(path, "utf8");

    expect(tokenPlanReference).not.toBe(dashscopeReference);
    expect(serialized).not.toContain("synthetic-token-plan-secret");
    expect(serialized).not.toContain("synthetic-dashscope-secret");
    expect(await vault.get(tokenPlanReference)).toBe(
      "synthetic-token-plan-secret",
    );
    expect(await vault.get(dashscopeReference)).toBe(
      "synthetic-dashscope-secret",
    );

    expect(await vault.delete(tokenPlanReference)).toBe(true);
    expect(await vault.get(tokenPlanReference)).toBeUndefined();
    expect(await vault.get(dashscopeReference)).toBe(
      "synthetic-dashscope-secret",
    );
  });

  it.runIf(process.platform === "win32")(
    "round-trips a synthetic value through Windows DPAPI",
    async () => {
      const protector = new DpapiSecretProtector();
      const plaintext = `synthetic-dpapi-${Date.now()}`;
      const protectedValue = await protector.protect(plaintext);

      expect(protectedValue).not.toContain(plaintext);
      expect(await protector.unprotect(protectedValue)).toBe(plaintext);
    },
  );
});
