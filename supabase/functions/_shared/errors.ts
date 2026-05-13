export type SerializedError = {
  message: string;
  name?: string;
  code?: string;
  details?: unknown;
  hint?: string;
  status?: number;
  cause?: SerializedError;
};

function clip(value: string, maxLength = 1200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function stringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    });
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unexpected error",
      name: error.name,
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message =
      readString(record, "message") ??
      readString(record, "error") ??
      readString(record, "msg") ??
      clip(stringify(error));
    return {
      message,
      name: readString(record, "name"),
      code: readString(record, "code") ?? readString(record, "error_code"),
      details: record.details ?? record.detail ?? record.description ?? undefined,
      hint: readString(record, "hint"),
      status: readNumber(record, "status") ?? readNumber(record, "statusCode"),
    };
  }

  return { message: String(error) };
}

export function errorMessage(error: unknown): string {
  const serialized = serializeError(error);
  const parts = [
    serialized.message,
    serialized.code ? `code=${serialized.code}` : "",
    serialized.details ? `details=${clip(stringify(serialized.details), 600)}` : "",
    serialized.hint ? `hint=${serialized.hint}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}
