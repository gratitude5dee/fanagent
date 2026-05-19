import { supabase } from "@/integrations/supabase/client";
import {
  buildAudioClipRegisterBody,
  type AudioClipRegisterResponse,
  type AudioClipTranscribeResponse,
  type RegisteredAudioClipSummary,
  type TrimmedAudioInput,
} from "./audioClipPayload";

export { blobToBase64, buildAudioClipRegisterBody } from "./audioClipPayload";
export type {
  AudioClipRegisterResponse,
  AudioClipTranscribeResponse,
  RegisteredAudioClipSummary,
  TrimmedAudioInput,
} from "./audioClipPayload";

type FunctionEnvelope<T> = {
  success: boolean;
  code?: string;
  message?: string;
  data: T | null;
  error?: string | null;
};

function unwrapFunctionData<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || !("success" in value)) return value as T;
  const envelope = value as FunctionEnvelope<T>;
  if (envelope.success) return envelope.data as T;
  throw new Error(envelope.error || envelope.message || envelope.code || "Function failed");
}

async function invokeFanAgentFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (data) return unwrapFunctionData<T>(data);
    throw new Error(error.message);
  }
  return unwrapFunctionData<T>(data);
}

export async function registerAudioClip(input: {
  accountId: string;
  trimmedAudio: TrimmedAudioInput;
}): Promise<AudioClipRegisterResponse> {
  return invokeFanAgentFunction<AudioClipRegisterResponse>(
    "audio-clip-register",
    await buildAudioClipRegisterBody(input),
  );
}

export async function transcribeAudioClip(
  audioClipId: string,
  force = false,
): Promise<AudioClipTranscribeResponse> {
  return invokeFanAgentFunction<AudioClipTranscribeResponse>("audio-clip-transcribe", {
    audioClipId,
    force,
  });
}
