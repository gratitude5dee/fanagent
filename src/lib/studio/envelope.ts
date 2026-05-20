type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
};

export function unwrapFunctionData<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}
