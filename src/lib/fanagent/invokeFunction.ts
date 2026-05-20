// Shared wrapper around supabase.functions.invoke so the UI always surfaces
// the real server error (envelope, status code, body) instead of the generic
// "Failed to send a request to the Edge Function" message.

import { supabase } from "@/integrations/supabase/client";

type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
  errorDetail?: unknown;
};

function unwrapEnvelope<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}

function describeFetchError(error: unknown, name: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to send a request to the Edge Function/i.test(message)) {
    return `${name}: edge function unreachable (network, cold start, or function crashed before responding).`;
  }
  if (/aborted|AbortError|signal is aborted/i.test(message)) {
    return `${name}: request aborted (timeout or page navigation).`;
  }
  return `${name}: ${message}`;
}

export async function invokeEdgeFunction<T>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
    if (error) {
      // FunctionsHttpError exposes the response body via context.response — pull
      // it so the UI shows the real server message instead of the generic
      // transport error.
      const context = (error as { context?: { response?: Response } }).context;
      if (context?.response) {
        try {
          const cloned = context.response.clone();
          const text = await cloned.text();
          if (text) {
            try {
              return unwrapEnvelope<T>(JSON.parse(text));
            } catch {
              throw new Error(`${name} [${context.response.status}]: ${text.slice(0, 500)}`);
            }
          }
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message.startsWith(name)) throw parseError;
        }
      }
      if (data) return unwrapEnvelope<T>(data);
      throw new Error(describeFetchError(error, name));
    }
    return unwrapEnvelope<T>(data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(name)) throw error;
    throw new Error(describeFetchError(error, name));
  }
}
