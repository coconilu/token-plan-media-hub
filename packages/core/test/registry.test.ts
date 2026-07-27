import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertCredentialRoute,
  effectiveAvailability,
  validateModelParameters,
  validateRegistry,
} from "../src/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function fixtures(): Promise<{ registry: unknown; schema: unknown }> {
  const [registry, schema] = await Promise.all([
    readFile(
      resolve(
        repositoryRoot,
        "model-registry",
        "aliyun-token-plan.json",
      ),
      "utf8",
    ).then(JSON.parse),
    readFile(
      resolve(
        repositoryRoot,
        "model-registry",
        "model-registry.schema.json",
      ),
      "utf8",
    ).then(JSON.parse),
  ]);
  return { registry, schema };
}

describe("model registry", () => {
  it("validates the checked-in registry", async () => {
    const { registry, schema } = await fixtures();
    const result = validateRegistry(registry, schema);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.registry.models).toHaveLength(5);
      expect(
        Object.fromEntries(
          result.registry.models.flatMap((model) =>
            model.recommendedFor.map((capability) => [
              capability,
              model.id,
            ]),
          ),
        ),
      ).toEqual({
        "text.generate": "qwen3.8-max-preview",
        "image.generate": "wan2.7-image",
        "video.text_to_video": "happyhorse-1.1-t2v",
        "speech.synthesize": "qwen3-tts-flash",
        "voice.clone": "qwen3-tts-vc-2026-01-22",
        "speech.synthesize_with_clone":
          "qwen3-tts-vc-2026-01-22",
      });
      const voiceCloneModel = result.registry.models.find(
        (model) => model.id === "qwen3-tts-vc-2026-01-22",
      );
      expect(voiceCloneModel?.credentialModes).toEqual(["dashscope"]);
      expect(() =>
        assertCredentialRoute(voiceCloneModel!, "token_plan"),
      ).toThrow(/不会自动回退/);
    }
  });

  it("requires exactly one recommended model per capability", async () => {
    const { registry, schema } = await fixtures();
    const missingRecommendation = structuredClone(registry) as {
      models: Array<{
        id: string;
        recommendedFor: string[];
      }>;
    };
    const imageModel = missingRecommendation.models.find(
      (model) => model.id === "wan2.7-image",
    )!;
    imageModel.recommendedFor = [];

    const result = validateRegistry(missingRecommendation, schema);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes(
            "capability image.generate must have exactly one recommended model; found 0",
          ),
        ),
      ).toBe(true);
    }
  });

  it("rejects duplicate model ids beyond JSON Schema validation", async () => {
    const { registry, schema } = await fixtures();
    const duplicate = structuredClone(registry) as {
      models: unknown[];
    };
    duplicate.models.push(structuredClone(duplicate.models[0]));

    const result = validateRegistry(duplicate, schema);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((issue) => issue.message.includes("duplicate")))
        .toBe(true);
    }
  });

  it("does not silently fall back to a different credential route", async () => {
    const { registry, schema } = await fixtures();
    const result = validateRegistry(registry, schema);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const imageModel = result.registry.models.find(
      (model) => model.id === "wan2.7-image",
    );
    expect(imageModel).toBeDefined();
    expect(() => assertCredentialRoute(imageModel!, "dashscope")).toThrow(
      /不会自动回退/,
    );
  });

  it("marks old source evidence as stale", async () => {
    const { registry, schema } = await fixtures();
    const result = validateRegistry(registry, schema);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(
      effectiveAvailability(
        result.registry.models[0]!,
        new Date("2026-09-01T00:00:00.000Z"),
        30,
      ),
    ).toBe("stale");
  });

  it("applies optional parameter defaults from the registry", async () => {
    const { registry, schema } = await fixtures();
    const result = validateRegistry(registry, schema);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const videoModel = result.registry.models.find(
      (model) => model.id === "happyhorse-1.1-t2v",
    )!;
    const parameters: Record<string, string | number> = {
      prompt: "fixture",
    };

    validateModelParameters(
      videoModel,
      "video.text_to_video",
      parameters,
    );

    expect(parameters).toMatchObject({
      resolution: "720P",
      ratio: "16:9",
      duration: 5,
    });
  });
});
