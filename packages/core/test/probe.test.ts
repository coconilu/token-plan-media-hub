import { describe, expect, it } from "vitest";

import {
  probeModelCapability,
  type ModelDefinition,
  type ProviderAdapter,
} from "../src/index.js";

const model: ModelDefinition = {
  id: "happyhorse-1.1-t2v",
  capabilities: ["video.text_to_video"],
  recommendedFor: ["video.text_to_video"],
  credentialModes: ["token_plan"],
  availability: "documented",
  execution: "async",
  parameters: {
    "video.text_to_video": {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  source: {
    url: "https://example.com/model",
    verifiedAt: "2026-07-25",
  },
};

describe("capability probe", () => {
  it("preserves a timeout as unknown with task id", async () => {
    const provider: ProviderAdapter = {
      id: "test-provider",
      submit: async () => {
        throw new Error("not used");
      },
      getJob: async () => {
        throw new Error("not used");
      },
      probe: async () => ({
        status: "unknown",
        checkedAt: "2026-07-25T00:00:00.000Z",
        providerTaskId: "task_safe_fixture",
        error: {
          code: "JOB_TIMEOUT_UNKNOWN",
          message: "Timed out while provider task remains queryable.",
          providerTaskId: "task_safe_fixture",
          retryable: true,
        },
      }),
    };

    const result = await probeModelCapability({
      provider,
      context: {
        credential: "synthetic-test-value",
        credentialMode: "token_plan",
      },
      region: "cn-beijing",
      model,
      request: {
        capability: "video.text_to_video",
        model: model.id,
        credentialMode: "token_plan",
      },
    });

    expect(result.status).toBe("unknown");
    if (result.status === "unknown") {
      expect(result.error.code).toBe("JOB_TIMEOUT_UNKNOWN");
      expect(result.providerTaskId).toBe("task_safe_fixture");
    }
  });
});
