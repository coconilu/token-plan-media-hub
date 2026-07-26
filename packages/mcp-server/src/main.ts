#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CAPABILITIES,
  CREDENTIAL_MODES,
  type Capability,
  type CredentialMode,
} from "@token-plan-media-hub/core";
import { z } from "zod";

import { MediaHubApiClient } from "./api-client.js";

const api = new MediaHubApiClient();
const server = new McpServer(
  { name: "token-plan-media-hub", version: "0.1.0" },
  {
    instructions:
      "先用 list_models 选择模型与显式 credential_mode。生成工具只返回本地 job/artifact 信息；Key 不通过 MCP 传递。声音复刻必须显式 consent=true。",
  },
);

const capabilitySchema = z.enum(CAPABILITIES);
const credentialModeSchema = z.enum(CREDENTIAL_MODES);
const generationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

server.registerTool(
  "list_models",
  {
    title: "列出模型",
    description:
      "读取统一模型注册表，可按能力和凭据路由过滤。probe_required 表示仍需真实凭据探测。",
    inputSchema: {
      capability: capabilitySchema.optional(),
      credential_mode: credentialModeSchema.optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ capability, credential_mode }) => {
    const data = await api.get<{
      registry: {
        provider: string;
        region: string;
        models: Array<{
          id: string;
          capabilities: Capability[];
          recommendedFor: Capability[];
          credentialModes: CredentialMode[];
          availability: string;
        }>;
      };
      probes: unknown[];
    }>("/api/models");
    const models = data.registry.models
      .filter(
        (model) =>
          capability === undefined ||
          model.capabilities.includes(capability),
      )
      .filter(
        (model) =>
          credential_mode === undefined ||
          model.credentialModes.includes(credential_mode),
      );
    return toolResult({
      provider: data.registry.provider,
      region: data.registry.region,
      models,
      probes: data.probes,
    });
  },
);

server.registerTool(
  "generate_text",
  {
    title: "生成文本",
    description: "使用推荐的 Qwen 文本模型生成内容并写入本地产物库。",
    inputSchema: {
      model: z.string().default("qwen3.8-max-preview"),
      credential_mode: credentialModeSchema.default("token_plan"),
      prompt: z.string().min(1),
      temperature: z.number().min(0).max(2).default(0.7),
      max_tokens: z.number().int().min(1).max(8192).default(2048),
    },
    annotations: generationAnnotations,
  },
  async ({
    model,
    credential_mode,
    prompt,
    temperature,
    max_tokens,
  }) =>
    submit("text.generate", model, credential_mode, {
      prompt,
      temperature,
      max_tokens,
    }),
);

server.registerTool(
  "probe_capability",
  {
    title: "实测模型能力",
    description:
      "使用 Dashboard 中保存的本地凭据做最小真实调用，可能产生少量实际用量。声音复刻不会自动探测。",
    inputSchema: {
      capability: capabilitySchema,
      model: z.string().min(1),
      credential_mode: credentialModeSchema,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async ({ capability, model, credential_mode }) =>
    toolResult(
      await api.post("/api/probes", {
        capability,
        model,
        credentialMode: credential_mode,
      }),
    ),
);

server.registerTool(
  "generate_image",
  {
    title: "生成图片",
    description: "提交图片生成任务，媒体自动下载到本地产物库。",
    inputSchema: {
      model: z.string().default("wan2.7-image"),
      credential_mode: credentialModeSchema.default("token_plan"),
      prompt: z.string().min(1),
      size: z.string().default("1024*1024"),
    },
    annotations: generationAnnotations,
  },
  async ({ model, credential_mode, prompt, size }) =>
    submit("image.generate", model, credential_mode, { prompt, size }),
);

server.registerTool(
  "generate_video",
  {
    title: "生成视频",
    description:
      "提交异步文生视频任务；随后用 get_job 刷新状态并取得 artifact ID。",
    inputSchema: {
      model: z.string().default("happyhorse-1.1-t2v"),
      credential_mode: credentialModeSchema.default("token_plan"),
      prompt: z.string().min(1),
      resolution: z.enum(["720P", "1080P"]).default("720P"),
      ratio: z.string().default("16:9"),
      duration: z.number().int().min(3).max(15).default(5),
    },
    annotations: generationAnnotations,
  },
  async ({
    model,
    credential_mode,
    prompt,
    resolution,
    ratio,
    duration,
  }) =>
    submit("video.text_to_video", model, credential_mode, {
      prompt,
      resolution,
      ratio,
      duration,
    }),
);

server.registerTool(
  "synthesize_speech",
  {
    title: "合成语音",
    description: "使用系统音色生成语音并写入本地产物库。",
    inputSchema: {
      model: z.string().default("qwen3-tts-flash"),
      credential_mode: credentialModeSchema.default("dashscope"),
      text: z.string().min(1),
      voice: z.string().min(1).default("Cherry"),
      language: z.string().default("Chinese"),
    },
    annotations: generationAnnotations,
  },
  async ({ model, credential_mode, text, voice, language }) =>
    submit("speech.synthesize", model, credential_mode, {
      text,
      voice,
      language,
    }),
);

server.registerTool(
  "clone_voice",
  {
    title: "复刻声音",
    description:
      "使用已授权的 data: audio URL 创建本地音色别名。真实音色 ID 加密保存且不返回。",
    inputSchema: {
      model: z.string().default("qwen3-tts-vc-2026-01-22"),
      credential_mode: credentialModeSchema.default("dashscope"),
      reference_audio: z.string().startsWith("data:audio/"),
      name: z.string().min(1),
      language: z.string().default("Chinese"),
      consent: z
        .literal(true)
        .describe("确认拥有该声音或已获得明确复刻授权"),
    },
    annotations: generationAnnotations,
  },
  async ({
    model,
    credential_mode,
    reference_audio,
    name,
    language,
    consent,
  }) =>
    submit("voice.clone", model, credential_mode, {
      reference_audio,
      name,
      language,
      consent,
    }),
);

server.registerTool(
  "synthesize_with_cloned_voice",
  {
    title: "使用复刻音色合成",
    description: "通过本地音色别名合成语音，不暴露 Provider 音色 ID。",
    inputSchema: {
      model: z.string().default("qwen3-tts-vc-2026-01-22"),
      credential_mode: credentialModeSchema.default("dashscope"),
      text: z.string().min(1),
      voice_alias: z.string().min(1),
      language: z.string().default("Chinese"),
    },
    annotations: generationAnnotations,
  },
  async ({ model, credential_mode, text, voice_alias, language }) =>
    submit("speech.synthesize_with_clone", model, credential_mode, {
      text,
      voice_alias,
      language,
    }),
);

server.registerTool(
  "get_job",
  {
    title: "读取媒体任务",
    description: "读取任务并可主动刷新异步 Provider 状态。",
    inputSchema: {
      job_id: z.string().min(1),
      refresh: z.boolean().default(true),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async ({ job_id, refresh }) =>
    toolResult(
      await api.get(
        `/api/jobs/${encodeURIComponent(job_id)}${refresh ? "?refresh=1" : ""}`,
      ),
    ),
);

server.registerTool(
  "list_artifacts",
  {
    title: "列出本地产物",
    description: "列出媒体文件及其 manifest，不返回凭据或声音样本。",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ limit }) =>
    toolResult(await api.get(`/api/artifacts?limit=${String(limit)}`)),
);

async function submit(
  capability: Capability,
  model: string,
  credentialMode: CredentialMode,
  parameters: Record<string, unknown>,
) {
  return toolResult(
    await api.post("/api/jobs", {
      capability,
      model,
      credentialMode,
      parameters,
      clientName: "mcp-client",
      clientKind: "mcp",
    }),
  );
}

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
