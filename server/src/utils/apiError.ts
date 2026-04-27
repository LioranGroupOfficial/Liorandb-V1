import type { Response } from "express";
import { isLiorandbError } from "@liorandb/core";

export function sendApiError(res: Response, error: unknown, fallbackStatus = 500) {
  if (isLiorandbError(error)) {
    const status = mapCoreStatus(error.code, fallbackStatus);
    return res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? undefined,
    });
  }

  if (error instanceof Error) {
    return res.status(fallbackStatus).json({ error: error.message });
  }

  return res.status(fallbackStatus).json({ error: "server error" });
}

function mapCoreStatus(code: string, fallback: number) {
  switch (code) {
    case "READONLY_MODE":
      return 409;
    case "VALIDATION_FAILED":
    case "RESERVED_KEY":
    case "UNKNOWN_OPERATION":
    case "UNKNOWN_ACTION":
    case "UNSUPPORTED_QUERY":
      return 400;
    case "DUPLICATE_KEY":
    case "INDEX_ALREADY_EXISTS":
    case "UNIQUE_INDEX_VIOLATION":
      return 409;
    case "BACKPRESSURE":
      return 429;
    case "CLOSED":
      return 503;
    default:
      return fallback;
  }
}
