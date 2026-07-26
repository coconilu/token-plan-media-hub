import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CapabilityProbeRequest,
  CapabilityProbeResult,
  CredentialMode,
  JsonValue,
  NormalizedProviderFailure,
  ProviderAdapter,
  ProviderContext,
  ProviderJobUpdate,
  ProviderOutput,
  ProviderRequest,
  ProviderSubmission,
} from "@token-plan-media-hub/core";

const TOKEN_PLAN_BASE = "https://token-plan.cn-beijing.maas.aliyuncs.com";
const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com";

export interface AliyunProviderOptions {
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  tokenPlanBaseUrl?: string;
  dashscopeBaseUrl?: string;
}

export class AliyunTokenPlanProvider implements ProviderAdapter {
  readonly id = "aliyun-token-plan";
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly tokenPlanBaseUrl: string;
  private readonly dashscopeBaseUrl: string;

  constructor(options: AliyunProviderOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.requestTimeoutMs ?? 120_000;
    this.tokenPlanBaseUrl = options.tokenPlanBaseUrl ?? TOKEN_PLAN_BASE;
    this.dashscopeBaseUrl = options.dashscopeBaseUrl ?? DASHSCOPE_BASE;
  }

  async submit(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    switch (request.capability) {
      case "text.generate":
        return this.generateText(context, request);
      case "image.generate":
        return this.generateImage(context, request);
      case "video.text_to_video":
        return this.generateVideo(context, request);
      case "speech.synthesize":
      case "speech.synthesize_with_clone":
        return this.synthesizeSpeech(context, request);
      case "voice.clone":
        return this.cloneVoice(context, request);
    }
  }

  private async generateText(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    const body = await this.requestJson(
      context,
      `${this.baseUrl(context.credentialMode)}/compatible-mode/v1/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({
          model: request.model,
          messages: [
            {
              role: "user",
              content: request.parameters.prompt,
            },
          ],
          temperature: request.parameters.temperature ?? 0.7,
          max_tokens: request.parameters.max_tokens ?? 2048,
        }),
      },
    );
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const content = optionalString(
      object(object(choices[0]).message).content,
    );
    if (content === undefined) {
      throw normalizeAliyunFailure(
        502,
        optionalString(body.code),
        optionalString(body.message) ??
          "Text response did not contain message content.",
        requestIdOf(body),
      );
    }
    return {
      kind: "completed",
      outputs: [
        {
          kind: "media",
          mimeType: "text/markdown",
          filename: "output.md",
          data: Buffer.from(`${content.trim()}\n`, "utf8"),
        },
      ],
      ...(requestIdOf(body) === undefined
        ? {}
        : { requestId: requestIdOf(body)! }),
    };
  }

  async getJob(
    context: ProviderContext,
    providerTaskId: string,
  ): Promise<ProviderJobUpdate> {
    const body = await this.requestJson(
      context,
      `${this.baseUrl(context.credentialMode)}/api/v1/tasks/${encodeURIComponent(providerTaskId)}`,
      { method: "GET" },
    );
    const output = object(body.output);
    const status = string(output.task_status);
    const requestId = requestIdOf(body);

    if (status === "SUCCEEDED") {
      const mediaOutputs: ProviderOutput[] = [];
      const videoUrl = optionalString(output.video_url);
      if (videoUrl !== undefined) {
        mediaOutputs.push({
          kind: "media",
          mimeType: "video/mp4",
          filename: "output.mp4",
          temporaryUrl: videoUrl,
        });
      }
      for (const imageUrl of imageUrls(output)) {
        mediaOutputs.push({
          kind: "media",
          mimeType: "image/png",
          filename: `output-${mediaOutputs.length + 1}.png`,
          temporaryUrl: imageUrl,
        });
      }
      return {
        state: "succeeded",
        providerTaskId,
        outputs: mediaOutputs,
        ...(requestId === undefined ? {} : { requestId }),
      };
    }
    if (status === "FAILED" || status === "CANCELED") {
      const error = normalizeAliyunFailure(
        400,
        optionalString(output.code),
        optionalString(output.message) ?? "Provider task failed.",
        requestId,
        providerTaskId,
      );
      return {
        state: "failed",
        providerTaskId,
        error,
        ...(requestId === undefined ? {} : { requestId }),
      };
    }
    if (status === "UNKNOWN") {
      return {
        state: "timeout_unknown",
        providerTaskId,
        error: {
          code: "JOB_TIMEOUT_UNKNOWN",
          message: "Provider task status is UNKNOWN; the task may have expired.",
          retryable: false,
          providerTaskId,
          ...(requestId === undefined ? {} : { requestId }),
        },
        ...(requestId === undefined ? {} : { requestId }),
      };
    }
    return {
      state: status === "RUNNING" ? "running" : "queued",
      providerTaskId,
      ...(requestId === undefined ? {} : { requestId }),
    };
  }

  async probe(
    context: ProviderContext,
    request: CapabilityProbeRequest,
  ): Promise<CapabilityProbeResult> {
    const checkedAt = new Date().toISOString();
    if (request.capability === "voice.clone") {
      return {
        status: "unknown",
        checkedAt,
        error: {
          code: "CONSENT_REQUIRED",
          message: "声音复刻必须使用已授权音频完成真实测试。",
          retryable: false,
        },
      };
    }
    try {
      const parameters = probeParameters(request.capability);
      const submission = await this.submit(context, {
        ...request,
        parameters,
        client: { kind: "cli", name: "capability-probe" },
      });
      return {
        status: "verified",
        checkedAt,
        ...("requestId" in submission && submission.requestId !== undefined
          ? { requestId: submission.requestId }
          : {}),
      };
    } catch (error) {
      const failure = isFailure(error)
        ? error
        : {
            code: "PROVIDER_REJECTED" as const,
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          };
      return failure.code === "JOB_TIMEOUT_UNKNOWN"
        ? { status: "unknown", checkedAt, error: failure }
        : { status: "unavailable", checkedAt, error: failure };
    }
  }

  private async generateImage(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    const parameters = request.parameters;
    const body = await this.requestJson(
      context,
      `${this.baseUrl(context.credentialMode)}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: "POST",
        body: JSON.stringify({
          model: request.model,
          input: {
            messages: [
              {
                role: "user",
                content: [{ text: parameters.prompt }],
              },
            ],
          },
          parameters: {
            ...(parameters.size === undefined
              ? {}
              : { size: parameters.size }),
            n: 1,
            watermark: false,
          },
        }),
      },
    );
    const outputs = imageUrls(object(body.output)).map<ProviderOutput>(
      (temporaryUrl, index) => ({
        kind: "media",
        mimeType: "image/png",
        filename: `output-${index + 1}.png`,
        temporaryUrl,
      }),
    );
    if (outputs.length === 0) {
      throw normalizeAliyunFailure(
        502,
        optionalString(body.code),
        optionalString(body.message) ?? "Image response did not contain an image URL.",
        requestIdOf(body),
      );
    }
    return {
      kind: "completed",
      outputs,
      ...(requestIdOf(body) === undefined
        ? {}
        : { requestId: requestIdOf(body)! }),
    };
  }

  private async generateVideo(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    const body = await this.requestJson(
      context,
      `${this.baseUrl(context.credentialMode)}/api/v1/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: { "X-DashScope-Async": "enable" },
        body: JSON.stringify({
          model: request.model,
          input: { prompt: request.parameters.prompt },
          parameters: {
            resolution: request.parameters.resolution ?? "720P",
            ratio: request.parameters.ratio ?? "16:9",
            duration: request.parameters.duration ?? 5,
          },
        }),
      },
    );
    const taskId = string(object(body.output).task_id);
    return {
      kind: "accepted",
      providerTaskId: taskId,
      ...(requestIdOf(body) === undefined
        ? {}
        : { requestId: requestIdOf(body)! }),
    };
  }

  private async synthesizeSpeech(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    const voice =
      request.parameters.voice ?? request.parameters.voice_alias;
    const body = await this.requestJson(
      context,
      `${this.baseUrl(context.credentialMode)}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: "POST",
        body: JSON.stringify({
          model: request.model,
          input: {
            text: request.parameters.text,
            voice,
            language_type: request.parameters.language ?? "Auto",
          },
        }),
      },
    );
    const audio = object(object(body.output).audio);
    const temporaryUrl = string(audio.url);
    return {
      kind: "completed",
      outputs: [
        {
          kind: "media",
          mimeType: "audio/wav",
          filename: "output.wav",
          temporaryUrl,
        },
      ],
      ...(requestIdOf(body) === undefined
        ? {}
        : { requestId: requestIdOf(body)! }),
    };
  }

  private async cloneVoice(
    context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    const body = await this.requestJson(
      context,
      `${this.baseUrl(context.credentialMode)}/api/v1/services/audio/tts/customization`,
      {
        method: "POST",
        body: JSON.stringify({
          model: "qwen-voice-enrollment",
          input: {
            action: "create",
            target_model: request.model,
            preferred_name: request.parameters.name,
            audio: { data: request.parameters.reference_audio },
          },
        }),
      },
    );
    const output = object(body.output);
    return {
      kind: "completed",
      outputs: [
        {
          kind: "voice",
          providerVoiceId: string(output.voice),
          targetModel: optionalString(output.target_model) ?? request.model,
        },
      ],
      ...(requestIdOf(body) === undefined
        ? {}
        : { requestId: requestIdOf(body)! }),
    };
  }

  private async requestJson(
    context: ProviderContext,
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${context.credential}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: context.signal ?? controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok || body.code) {
        throw normalizeAliyunFailure(
          response.status,
          optionalString(body.code),
          optionalString(body.message) ?? `Provider HTTP ${response.status}`,
          requestIdOf(body),
        );
      }
      return body;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw {
          code: "JOB_TIMEOUT_UNKNOWN",
          message: "Provider request timed out; completion is unknown.",
          retryable: true,
        } satisfies NormalizedProviderFailure;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(mode: CredentialMode): string {
    return mode === "dashscope"
      ? this.dashscopeBaseUrl
      : this.tokenPlanBaseUrl;
  }
}

export interface DemoProviderOptions {
  assetDirectory: string;
  delayMs?: number;
}

export class DemoMediaProvider implements ProviderAdapter {
  readonly id = "demo";
  private readonly assetDirectory: string;
  private readonly delayMs: number;

  constructor(options: DemoProviderOptions) {
    this.assetDirectory = options.assetDirectory;
    this.delayMs = options.delayMs ?? 1200;
  }

  async submit(
    _context: ProviderContext,
    request: ProviderRequest,
  ): Promise<ProviderSubmission> {
    if (request.capability === "text.generate") {
      const prompt =
        typeof request.parameters.prompt === "string"
          ? request.parameters.prompt
          : "未提供提示词";
      return {
        kind: "completed",
        outputs: [
          {
            kind: "media",
            mimeType: "text/markdown",
            filename: "demo-text.md",
            data: Buffer.from(
              `# 演示文本\n\n这是对“${prompt}”的本地演示回复。\n`,
              "utf8",
            ),
          },
        ],
      };
    }
    if (request.capability === "video.text_to_video") {
      return {
        kind: "accepted",
        providerTaskId: `demo_video_${Date.now()}`,
      };
    }
    if (request.capability === "voice.clone") {
      return {
        kind: "completed",
        outputs: [
          {
            kind: "voice",
            providerVoiceId: `demo-voice-${Date.now()}`,
            targetModel: request.model,
          },
        ],
      };
    }
    if (
      request.capability === "speech.synthesize" ||
      request.capability === "speech.synthesize_with_clone"
    ) {
      return {
        kind: "completed",
        outputs: [
          {
            kind: "media",
            mimeType: "audio/wav",
            filename: "demo-speech.wav",
            data: createDemoWave(),
          },
        ],
      };
    }
    return {
      kind: "completed",
      outputs: [
        {
          kind: "media",
          mimeType: "image/png",
          filename: "demo-image.png",
          data: await readFile(join(this.assetDirectory, "demo-image.png")),
        },
      ],
    };
  }

  async getJob(
    _context: ProviderContext,
    providerTaskId: string,
  ): Promise<ProviderJobUpdate> {
    const timestamp = Number(providerTaskId.split("_").at(-1));
    if (!Number.isFinite(timestamp)) {
      return {
        state: "failed",
        providerTaskId,
        error: {
          code: "PROVIDER_REJECTED",
          message: "Invalid demo task id.",
          retryable: false,
        },
      };
    }
    if (Date.now() - timestamp < this.delayMs) {
      return { state: "running", providerTaskId };
    }
    return {
      state: "succeeded",
      providerTaskId,
      outputs: [
        {
          kind: "media",
          mimeType: "video/mp4",
          filename: "demo-video.mp4",
          data: await readFile(join(this.assetDirectory, "demo-video.mp4")),
        },
      ],
    };
  }

  async probe(
    _context: ProviderContext,
    _request: CapabilityProbeRequest,
  ): Promise<CapabilityProbeResult> {
    return {
      status: "verified",
      checkedAt: new Date().toISOString(),
      requestId: `demo_probe_${Date.now()}`,
    };
  }
}

function probeParameters(
  capability: CapabilityProbeRequest["capability"],
): Record<string, JsonValue> {
  switch (capability) {
    case "text.generate":
      return {
        prompt: "Reply with exactly: OK",
        temperature: 0,
        max_tokens: 8,
      };
    case "image.generate":
      return {
        prompt: "Capability probe: a single neutral gray square.",
        size: "1024*1024",
      };
    case "video.text_to_video":
      return {
        prompt: "Capability probe: a still neutral gray frame.",
        resolution: "720P",
        ratio: "16:9",
        duration: 3,
      };
    case "speech.synthesize":
    case "speech.synthesize_with_clone":
      return { text: "测试", voice: "Cherry", language: "Chinese" };
    case "voice.clone":
      return {};
  }
}

function normalizeAliyunFailure(
  status: number,
  providerCode: string | undefined,
  message: string,
  requestId?: string,
  providerTaskId?: string,
): NormalizedProviderFailure {
  const codeText = `${providerCode ?? ""} ${message}`.toLowerCase();
  const code =
    status === 401 || codeText.includes("invalidapikey")
      ? "AUTH_INVALID"
      : codeText.includes("region")
        ? "REGION_UNAVAILABLE"
        : codeText.includes("plan") || codeText.includes("permission")
          ? "PLAN_UNSUPPORTED"
          : codeText.includes("model")
            ? "MODEL_UNAVAILABLE"
            : status === 400 || codeText.includes("parameter")
              ? "PARAMETER_INVALID"
              : "PROVIDER_REJECTED";
  return {
    code,
    message,
    retryable: status === 429 || status >= 500,
    ...(requestId === undefined ? {} : { requestId }),
    ...(providerTaskId === undefined ? {} : { providerTaskId }),
  };
}

function requestIdOf(body: Record<string, unknown>): string | undefined {
  return optionalString(body.request_id) ?? optionalString(body.requestId);
}

function imageUrls(output: Record<string, unknown>): string[] {
  const choices = Array.isArray(output.choices) ? output.choices : [];
  const urls: string[] = [];
  for (const choice of choices) {
    const message = object(object(choice).message);
    const content = Array.isArray(message.content) ? message.content : [];
    for (const item of content) {
      const url = optionalString(object(item).image);
      if (url !== undefined) urls.push(url);
    }
  }
  return urls;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Provider response is missing a required string field.");
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isFailure(value: unknown): value is NormalizedProviderFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "retryable" in value
  );
}

function createDemoWave(): Uint8Array {
  const sampleRate = 24_000;
  const durationSeconds = 2.5;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.min(1, t * 8, (durationSeconds - t) * 5);
    const sample =
      Math.sin(2 * Math.PI * 220 * t) * 0.45 +
      Math.sin(2 * Math.PI * 330 * t) * 0.25 +
      Math.sin(2 * Math.PI * 440 * t) * 0.15;
    buffer.writeInt16LE(
      Math.round(sample * envelope * 32767),
      44 + index * 2,
    );
  }
  return buffer;
}
