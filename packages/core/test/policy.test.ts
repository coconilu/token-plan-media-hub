import { describe, expect, it } from "vitest";

import { assertVoiceCloneConsent } from "../src/index.js";

describe("voice clone policy", () => {
  it("rejects cloning without explicit consent", () => {
    expect(() => assertVoiceCloneConsent("voice.clone", false)).toThrow(
      /明确授权/,
    );
    expect(() => assertVoiceCloneConsent("voice.clone", true)).not.toThrow();
  });
});
