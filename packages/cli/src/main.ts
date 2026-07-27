#!/usr/bin/env node

import { resolve } from "node:path";

import {
  CAPABILITIES,
  CREDENTIAL_MODES,
  effectiveAvailability,
  loadRegistry,
  resolveMediaHubGateway,
  type Capability,
  type CredentialMode,
} from "@token-plan-media-hub/core";

interface CliOptions {
  registryPath: string;
  schemaPath: string;
  apiUrl?: string;
  values: Record<string, string>;
}

async function main(argv: string[]): Promise<void> {
  const [group, command, ...rest] = argv;
  const options = parseOptions(rest);

  if (group === "registry" && command === "validate") {
    const registry = await loadRegistry(
      options.registryPath,
      options.schemaPath,
    );
    writeJson({
      valid: true,
      provider: registry.provider,
      region: registry.region,
      models: registry.models.length,
    });
    return;
  }

  if (group === "models" && command === "list") {
    const registry = await loadRegistry(
      options.registryPath,
      options.schemaPath,
    );
    const capability = optionalCapability(options.values.capability);
    const credentialMode = optionalCredentialMode(
      options.values["credential-mode"],
    );
    const models = registry.models
      .filter(
        (model) =>
          capability === undefined ||
          model.capabilities.includes(capability),
      )
      .filter(
        (model) =>
          credentialMode === undefined ||
          model.credentialModes.includes(credentialMode),
      )
      .map((model) => ({
        ...model,
        effectiveAvailability: effectiveAvailability(model, new Date()),
      }));
    writeJson({
      provider: registry.provider,
      region: registry.region,
      models,
    });
    return;
  }

  if (group === "jobs" && command === "list") {
    writeJson(await apiRequest(options, "/api/jobs"));
    return;
  }
  if (group === "jobs" && command === "get") {
    const id = required(options, "id");
    const refresh = options.values.refresh !== "false";
    writeJson(
      await apiRequest(
        options,
        `/api/jobs/${encodeURIComponent(id)}${refresh ? "?refresh=1" : ""}`,
      ),
    );
    return;
  }

  if (group === "artifacts" && command === "list") {
    writeJson(await apiRequest(options, "/api/artifacts"));
    return;
  }

  if (group === "text" && command === "generate") {
    writeJson(
      await submit(options, {
        capability: "text.generate",
        model: options.values.model ?? "qwen3.8-max-preview",
        credentialMode: credentialModeOr(
          options.values["credential-mode"],
          "token_plan",
        ),
        parameters: {
          prompt: required(options, "prompt"),
          temperature: Number(options.values.temperature ?? 0.7),
          max_tokens: Number(options.values["max-tokens"] ?? 2048),
        },
      }),
    );
    return;
  }

  if (group === "image" && command === "generate") {
    writeJson(
      await submit(options, {
        capability: "image.generate",
        model: options.values.model ?? "wan2.7-image",
        credentialMode: credentialModeOr(
          options.values["credential-mode"],
          "token_plan",
        ),
        parameters: {
          prompt: required(options, "prompt"),
          size: options.values.size ?? "1024*1024",
        },
      }),
    );
    return;
  }

  if (group === "video" && command === "generate") {
    writeJson(
      await submit(options, {
        capability: "video.text_to_video",
        model: options.values.model ?? "happyhorse-1.1-t2v",
        credentialMode: credentialModeOr(
          options.values["credential-mode"],
          "token_plan",
        ),
        parameters: {
          prompt: required(options, "prompt"),
          resolution: options.values.resolution ?? "720P",
          ratio: options.values.ratio ?? "16:9",
          duration: Number(options.values.duration ?? 5),
        },
      }),
    );
    return;
  }

  if (group === "speech" && command === "synthesize") {
    writeJson(
      await submit(options, {
        capability: "speech.synthesize",
        model: options.values.model ?? "qwen3-tts-flash",
        credentialMode: credentialModeOr(
          options.values["credential-mode"],
          "dashscope",
        ),
        parameters: {
          text: required(options, "text"),
          voice: options.values.voice ?? "Cherry",
          language: options.values.language ?? "Chinese",
        },
      }),
    );
    return;
  }

  throw new Error(usage());
}

async function submit(
  options: CliOptions,
  input: {
    capability: Capability;
    model: string;
    credentialMode: CredentialMode;
    parameters: Record<string, unknown>;
  },
) {
  return apiRequest(options, "/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      clientName: "tp-media-cli",
      clientKind: "cli",
    }),
  });
}

async function apiRequest(
  options: CliOptions,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const gateway = await resolveMediaHubGateway(
    options.apiUrl === undefined
      ? {}
      : { explicitOrigin: options.apiUrl },
  );
  let response: Response;
  try {
    response = await fetch(`${gateway.origin}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new Error(
      `Cannot connect to Agent Gateway ${gateway.origin} (${gateway.source}). ` +
        `Start the Token Plan Media Hub desktop app or set TP_MEDIA_URL. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      errorMessage(body) ?? `Media Hub returned HTTP ${response.status}.`,
    );
  }
  return body;
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    registryPath: resolve(
      process.cwd(),
      "model-registry",
      "aliyun-token-plan.json",
    ),
    schemaPath: resolve(
      process.cwd(),
      "model-registry",
      "model-registry.schema.json",
    ),
    values: {},
  };

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === undefined || !argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${String(argument)}.`);
    }
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }
    const key = argument.slice(2);
    if (key === "registry") options.registryPath = resolve(value);
    else if (key === "schema") options.schemaPath = resolve(value);
    else if (key === "api") options.apiUrl = value.replace(/\/$/, "");
    else options.values[key] = value;
  }
  return options;
}

function optionalCapability(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!CAPABILITIES.includes(value as Capability)) {
    throw new Error(`Unknown capability: ${value}.`);
  }
  return value as Capability;
}

function optionalCredentialMode(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!CREDENTIAL_MODES.includes(value as CredentialMode)) {
    throw new Error(`Unknown credential mode: ${value}.`);
  }
  return value as CredentialMode;
}

function credentialModeOr(
  value: string | undefined,
  fallback: CredentialMode,
) {
  return optionalCredentialMode(value) ?? fallback;
}

function required(options: CliOptions, key: string): string {
  const value = options.values[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required option --${key}.`);
  }
  return value;
}

function errorMessage(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null ||
    !("message" in value.error)
  ) {
    return undefined;
  }
  return typeof value.error.message === "string"
    ? value.error.message
    : undefined;
}

function usage(): string {
  return [
    "Usage:",
    "  tp-media registry validate",
    "  tp-media models list [--capability <name>] [--credential-mode <mode>]",
    "  tp-media text generate --prompt <text> [--model qwen3.8-max-preview]",
    "  tp-media image generate --prompt <text> [--model <id>]",
    "  tp-media video generate --prompt <text> [--duration 5]",
    "  tp-media speech synthesize --text <text> [--voice Cherry]",
    "  tp-media jobs list | jobs get --id <job-id>",
    "  tp-media artifacts list",
    "API commands discover the running desktop Agent Gateway automatically.",
    "Override discovery with --api, TP_MEDIA_URL, or TP_MEDIA_GATEWAY_FILE.",
  ].join("\n");
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
