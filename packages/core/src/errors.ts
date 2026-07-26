import type {
  ErrorCode,
  NormalizedProviderFailure,
} from "./contracts.js";

export class MediaCoreError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly providerTaskId: string | undefined;

  constructor(failure: NormalizedProviderFailure) {
    super(failure.message);
    this.name = "MediaCoreError";
    this.code = failure.code;
    this.retryable = failure.retryable;
    this.requestId = failure.requestId;
    this.providerTaskId = failure.providerTaskId;
  }

  toJSON(): NormalizedProviderFailure {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.providerTaskId === undefined
        ? {}
        : { providerTaskId: this.providerTaskId }),
    };
  }
}

export function assertVoiceCloneConsent(
  capability: string,
  consent: unknown,
): void {
  if (capability === "voice.clone" && consent !== true) {
    throw new MediaCoreError({
      code: "CONSENT_REQUIRED",
      message: "声音复刻必须先记录明确授权确认。",
      retryable: false,
    });
  }
}
