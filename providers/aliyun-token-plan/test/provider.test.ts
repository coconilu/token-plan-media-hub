import { describe, expect, it, vi } from "vitest";

import { AliyunTokenPlanProvider } from "../src/index.js";

describe("AliyunTokenPlanProvider", () => {
  it("maps text generation to the OpenAI-compatible chat endpoint", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          messages: Array<{ role: string; content: string }>;
          temperature: number;
          max_tokens: number;
        };
        expect(body).toMatchObject({
          model: "qwen3.8-max-preview",
          messages: [{ role: "user", content: "fixture" }],
          temperature: 0.2,
          max_tokens: 128,
        });
        return Response.json({
          id: "request_fixture",
          choices: [
            {
              message: {
                role: "assistant",
                content: "generated fixture",
              },
            },
          ],
        });
      },
    );
    const provider = new AliyunTokenPlanProvider({
      fetch: fetch as typeof globalThis.fetch,
    });

    const result = await provider.submit(
      { credential: "sk-sp-synthetic", credentialMode: "token_plan" },
      {
        capability: "text.generate",
        model: "qwen3.8-max-preview",
        credentialMode: "token_plan",
        parameters: {
          prompt: "fixture",
          temperature: 0.2,
          max_tokens: 128,
        },
        client: { kind: "cli", name: "test" },
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/compatible-mode/v1/chat/completions"),
      expect.any(Object),
    );
    expect(result).toMatchObject({
      kind: "completed",
      outputs: [
        {
          kind: "media",
          mimeType: "text/markdown",
          filename: "output.md",
        },
      ],
    });
    if (result.kind !== "completed") return;
    const output = result.outputs[0];
    expect(output?.kind).toBe("media");
    if (output?.kind !== "media" || output.data === undefined) return;
    expect(Buffer.from(output.data).toString("utf8")).toBe(
      "generated fixture\n",
    );
  });

  it("maps the provider-neutral image request to the documented endpoint", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        input: { messages: Array<{ content: Array<{ text: string }> }> };
      };
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-sp-synthetic",
        "Content-Type": "application/json",
      });
      expect(body.model).toBe("wan2.7-image");
      expect(body.input.messages[0]?.content[0]?.text).toBe("fixture");
      return Response.json({
        request_id: "request_fixture",
        output: {
          choices: [
            {
              message: {
                content: [{ image: "https://example.test/output.png" }],
              },
            },
          ],
        },
      });
    });
    const provider = new AliyunTokenPlanProvider({
      fetch: fetch as typeof globalThis.fetch,
    });

    const result = await provider.submit(
      { credential: "sk-sp-synthetic", credentialMode: "token_plan" },
      {
        capability: "image.generate",
        model: "wan2.7-image",
        credentialMode: "token_plan",
        parameters: { prompt: "fixture", size: "1024*1024" },
        client: { kind: "cli", name: "test" },
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v1/services/aigc/multimodal-generation/generation",
      ),
      expect.any(Object),
    );
    expect(result).toMatchObject({
      kind: "completed",
      outputs: [
        {
          kind: "media",
          temporaryUrl: "https://example.test/output.png",
        },
      ],
    });
  });

  it("waits for an asynchronous probe to produce media before verifying the route", async () => {
    let taskChecks = 0;
    const fetch = vi.fn(
      async (url: string | URL | Request) => {
        if (String(url).includes("/api/v1/tasks/")) {
          taskChecks += 1;
          return Response.json({
            request_id: `task_check_${taskChecks}`,
            output:
              taskChecks === 1
                ? { task_status: "RUNNING" }
                : {
                    task_status: "SUCCEEDED",
                    video_url: "https://example.test/probe.mp4",
                  },
          });
        }
        return Response.json({
          request_id: "probe_submission",
          output: { task_id: "probe_task" },
        });
      },
    );
    const provider = new AliyunTokenPlanProvider({
      fetch: fetch as typeof globalThis.fetch,
      probePollIntervalMs: 0,
      probeTimeoutMs: 1_000,
    });

    const result = await provider.probe(
      { credential: "sk-sp-synthetic", credentialMode: "token_plan" },
      {
        capability: "video.text_to_video",
        model: "happyhorse-1.1-t2v",
        credentialMode: "token_plan",
      },
    );

    expect(result).toMatchObject({
      status: "verified",
      requestId: "task_check_2",
    });
    expect(taskChecks).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
