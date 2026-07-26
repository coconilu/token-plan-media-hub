import { readFile } from "node:fs/promises";

import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";

import {
  CAPABILITIES,
  type Capability,
  type Availability,
  type CredentialMode,
  type ModelDefinition,
  type ModelRegistry,
} from "./contracts.js";
import { MediaCoreError } from "./errors.js";

export interface RegistryValidationIssue {
  path: string;
  message: string;
}

export type RegistryValidationResult =
  | { valid: true; registry: ModelRegistry }
  | { valid: false; issues: RegistryValidationIssue[] };

function compileSchema(schema: unknown): ValidateFunction<ModelRegistry> {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  const addFormats = formatsPlugin as unknown as (
    instance: Ajv2020,
  ) => Ajv2020;
  addFormats(ajv);
  return ajv.compile<ModelRegistry>(schema as AnySchema);
}

function formatAjvIssue(error: ErrorObject): RegistryValidationIssue {
  return {
    path: error.instancePath || "/",
    message: error.message ?? "schema validation failed",
  };
}

function semanticIssues(registry: ModelRegistry): RegistryValidationIssue[] {
  const issues: RegistryValidationIssue[] = [];
  const ids = new Set<string>();

  for (const [index, model] of registry.models.entries()) {
    if (ids.has(model.id)) {
      issues.push({
        path: `/models/${index}/id`,
        message: `duplicate model id: ${model.id}`,
      });
    }
    ids.add(model.id);

    for (const capability of model.recommendedFor) {
      if (!model.capabilities.includes(capability)) {
        issues.push({
          path: `/models/${index}/recommendedFor`,
          message: `recommended capability is not declared by the model: ${capability}`,
        });
      }
    }

    const schemaCapabilities = Object.keys(model.parameters);
    for (const capability of model.capabilities) {
      if (model.parameters[capability] === undefined) {
        issues.push({
          path: `/models/${index}/parameters`,
          message: `missing parameter schema for capability: ${capability}`,
        });
      }
    }
    for (const capability of schemaCapabilities) {
      if (!model.capabilities.includes(capability as never)) {
        issues.push({
          path: `/models/${index}/parameters/${capability}`,
          message: `parameter schema has undeclared capability: ${capability}`,
        });
      }

      const parameterSchema =
        model.parameters[capability as keyof typeof model.parameters];
      if (parameterSchema === undefined) continue;
      const propertyNames = new Set(
        Object.keys(parameterSchema.properties),
      );
      for (const required of parameterSchema.required ?? []) {
        if (!propertyNames.has(required)) {
          issues.push({
            path: `/models/${index}/parameters/${capability}/required`,
            message: `required parameter is not declared: ${required}`,
          });
        }
      }
    }
  }

  for (const capability of CAPABILITIES) {
    const recommended = registry.models.filter((model) =>
      model.recommendedFor.includes(capability as Capability),
    );
    if (recommended.length !== 1) {
      issues.push({
        path: "/models",
        message: `capability ${capability} must have exactly one recommended model; found ${recommended.length}`,
      });
    }
  }

  return issues;
}

export function validateRegistry(
  value: unknown,
  schema: unknown,
): RegistryValidationResult {
  const validate = compileSchema(schema);
  if (!validate(value)) {
    return {
      valid: false,
      issues: (validate.errors ?? []).map(formatAjvIssue),
    };
  }

  const issues = semanticIssues(value);
  return issues.length === 0
    ? { valid: true, registry: value }
    : { valid: false, issues };
}

export async function loadRegistry(
  registryPath: string,
  schemaPath: string,
): Promise<ModelRegistry> {
  const [registryText, schemaText] = await Promise.all([
    readFile(registryPath, "utf8"),
    readFile(schemaPath, "utf8"),
  ]);
  const value: unknown = JSON.parse(registryText);
  const schema: unknown = JSON.parse(schemaText);
  const result = validateRegistry(value, schema);

  if (!result.valid) {
    throw new MediaCoreError({
      code: "LOCAL_DEPENDENCY_MISSING",
      message: `模型注册表无效：${result.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
      retryable: false,
    });
  }

  return result.registry;
}

export function effectiveAvailability(
  model: ModelDefinition,
  now: Date,
  maxAgeDays = 30,
): Availability {
  if (model.availability === "unavailable") {
    return "unavailable";
  }

  const verifiedAt = new Date(`${model.source.verifiedAt}T00:00:00.000Z`);
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (
    Number.isNaN(verifiedAt.valueOf()) ||
    now.valueOf() - verifiedAt.valueOf() > maxAgeMs
  ) {
    return "stale";
  }

  return model.availability;
}

export function assertCredentialRoute(
  model: ModelDefinition,
  credentialMode: CredentialMode,
): void {
  if (!model.credentialModes.includes(credentialMode)) {
    throw new MediaCoreError({
      code: "MODEL_UNAVAILABLE",
      message: `模型 ${model.id} 不支持凭据路由 ${credentialMode}，不会自动回退。`,
      retryable: false,
    });
  }
}

export function validateModelParameters(
  model: ModelDefinition,
  capability: ModelDefinition["capabilities"][number],
  parameters: unknown,
): asserts parameters is Record<string, import("./contracts.js").JsonValue> {
  const schema = model.parameters[capability];
  if (schema === undefined) {
    throw new MediaCoreError({
      code: "MODEL_UNAVAILABLE",
      message: `模型 ${model.id} 缺少 ${capability} 的参数 Schema。`,
      retryable: false,
    });
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    useDefaults: true,
  });
  const validate = ajv.compile(schema as AnySchema);
  if (!validate(parameters)) {
    throw new MediaCoreError({
      code: "PARAMETER_INVALID",
      message: `参数无效：${(validate.errors ?? [])
        .map((error) => `${error.instancePath || "/"} ${error.message ?? ""}`)
        .join("; ")}`,
      retryable: false,
    });
  }
}
