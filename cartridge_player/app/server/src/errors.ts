/** Typed, catchable errors. Call sites must be able to distinguish these. */

export class AppError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 500) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.status = status
  }
}

/** A target was asked to launch a payload kind it cannot handle (§6.1). */
export class UnsupportedPayloadError extends AppError {
  readonly targetId: string
  readonly payloadKind: string

  constructor(targetId: string, payloadKind: string) {
    super(
      'unsupported_payload',
      `Target "${targetId}" cannot launch a "${payloadKind}" payload`,
      400,
    )
    this.targetId = targetId
    this.payloadKind = payloadKind
  }
}

/** Nothing registered under that provider id. */
export class UnknownProviderError extends AppError {
  constructor(providerId: string) {
    super('unknown_provider', `No provider registered with id "${providerId}"`, 400)
  }
}

/** Nothing registered under that target id. */
export class UnknownTargetError extends AppError {
  constructor(targetId: string) {
    super('unknown_target', `No target registered with id "${targetId}"`, 400)
  }
}

/** The target cannot be built because setup is incomplete. */
export class TargetNotConfiguredError extends AppError {
  constructor(detail: string) {
    super('target_not_configured', detail, 409)
  }
}

/** An upstream metadata service was unreachable or returned garbage. */
export class ProviderUnavailableError extends AppError {
  constructor(providerId: string, detail: string) {
    super(
      'provider_unavailable',
      `${providerId} is unreachable: ${detail}`,
      503,
    )
  }
}

/** Home Assistant rejected or could not receive a call. */
export class HomeAssistantError extends AppError {
  constructor(detail: string) {
    super('home_assistant_error', detail, 502)
  }
}
