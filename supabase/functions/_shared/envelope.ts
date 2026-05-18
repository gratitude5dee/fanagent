import { jsonResponse } from "./cors.ts";
import { serializeError } from "./errors.ts";

export type ApiEnvelope<T = unknown> = {
  success: boolean;
  code: string;
  message: string;
  data: T | null;
  error: string | null;
  errorDetail: unknown | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEnvelope(value: unknown): value is ApiEnvelope {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.code === "string" &&
    "data" in value &&
    "error" in value
  );
}

export function unwrapEnvelopeData<T = unknown>(value: unknown): T {
  if (!isEnvelope(value)) return value as T;
  if (value.success) return value.data as T;

  const message =
    typeof value.error === "string" && value.error.trim()
      ? value.error
      : typeof value.message === "string" && value.message.trim()
        ? value.message
        : value.code;
  throw new Error(message);
}

export function okEnvelope(data: unknown, message = "OK", status = 200): Response {
  return jsonResponse(
    {
      success: true,
      code: "OK",
      message,
      data,
      error: null,
      errorDetail: null,
    },
    status,
  );
}

export function errorEnvelope(error: unknown, code = "INTERNAL_ERROR", status = 500): Response {
  const errorDetail = serializeError(error);
  return jsonResponse(
    {
      success: false,
      code,
      message: errorDetail.message,
      data: null,
      error: errorDetail.message,
      errorDetail,
    },
    status,
  );
}
