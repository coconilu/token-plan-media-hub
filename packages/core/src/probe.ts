import type {
  CapabilityProbeRequest,
  CapabilityProbeResult,
  ModelDefinition,
  ProviderAdapter,
  ProviderContext,
} from "./contracts.js";
import { assertCredentialRoute } from "./registry.js";

export type ProbeRecord = CapabilityProbeResult & {
  provider: string;
  region: string;
  model: string;
  capability: CapabilityProbeRequest["capability"];
  credentialMode: CapabilityProbeRequest["credentialMode"];
};

export async function probeModelCapability(input: {
  provider: ProviderAdapter;
  context: ProviderContext;
  region: string;
  model: ModelDefinition;
  request: CapabilityProbeRequest;
}): Promise<ProbeRecord> {
  const { provider, context, region, model, request } = input;
  assertCredentialRoute(model, request.credentialMode);

  if (
    model.id !== request.model ||
    !model.capabilities.includes(request.capability)
  ) {
    throw new Error(
      `Probe request does not match registry model ${model.id}.`,
    );
  }

  const result = await provider.probe(context, request);
  return {
    ...result,
    provider: provider.id,
    region,
    model: request.model,
    capability: request.capability,
    credentialMode: request.credentialMode,
  };
}
