export type LiorandbErrorCode =
  | "READONLY_MODE"
  | "CLOSED"
  | "VALIDATION_FAILED"
  | "RESERVED_KEY"
  | "DUPLICATE_KEY"
  | "INDEX_ALREADY_EXISTS"
  | "UNIQUE_INDEX_VIOLATION"
  | "UNKNOWN_OPERATION"
  | "UNKNOWN_ACTION"
  | "UNSUPPORTED_QUERY"
  | "ENCRYPTION_ERROR"
  | "BACKPRESSURE"
  | "IO_ERROR"
  | "CORRUPTION"
  | "INTERNAL";

export type LiorandbErrorDetails = Record<string, unknown>;

export class LiorandbError extends Error {
  public readonly name = "LiorandbError";
  public readonly code: LiorandbErrorCode;
  public readonly details?: LiorandbErrorDetails;

  constructor(
    code: LiorandbErrorCode,
    message: string,
    options?: { cause?: unknown; details?: LiorandbErrorDetails }
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(message, options?.cause !== undefined ? ({ cause: options.cause } as any) : undefined);
    this.code = code;
    this.details = options?.details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cause: (this as any).cause
    };
  }
}

export function isLiorandbError(err: unknown): err is LiorandbError {
  return err instanceof Error && err.name === "LiorandbError" && "code" in err;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function asLiorandbError(
  err: unknown,
  fallback: {
    code: LiorandbErrorCode;
    message: string;
    details?: LiorandbErrorDetails;
  }
): LiorandbError {
  if (isLiorandbError(err)) return err;

  return new LiorandbError(fallback.code, fallback.message, {
    cause: err,
    details: {
      ...(fallback.details ?? {}),
      originalMessage: describeError(err)
    }
  });
}

export async function withLiorandbError<T>(
  fallback: {
    code: LiorandbErrorCode;
    message: string;
    details?: LiorandbErrorDetails;
  },
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asLiorandbError(err, fallback);
  }
}

export function withLiorandbErrorSync<T>(
  fallback: {
    code: LiorandbErrorCode;
    message: string;
    details?: LiorandbErrorDetails;
  },
  fn: () => T
): T {
  try {
    return fn();
  } catch (err) {
    throw asLiorandbError(err, fallback);
  }
}

