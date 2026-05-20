import { invokeEdgeFunction } from "./invokeFunction";
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

async function invokeFanAgentFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  return invokeEdgeFunction<T>(name, body);
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
