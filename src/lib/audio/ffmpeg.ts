// Browser-native audio trimming. This intentionally avoids wasm transcoder
// loading, which is brittle under hosted CSP/COEP/CDN conditions.

type AudioContextConstructor = typeof AudioContext;

function audioContextCtor(): AudioContextConstructor {
  const globalAudio = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Ctor = globalAudio.AudioContext ?? globalAudio.webkitAudioContext;
  if (!Ctor) throw new Error("This browser does not support Web Audio decoding.");
  return Ctor;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function audioBufferToWav(buffer: AudioBuffer, startSec: number, endSec: number): Blob {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
  const endFrame = Math.min(
    buffer.length,
    Math.max(startFrame + 1, Math.ceil(endSec * sampleRate)),
  );
  const frameCount = endFrame - startFrame;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frameCount * blockAlign;
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  const channels = Array.from({ length: channelCount }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([wav], { type: "audio/wav" });
}

export async function trimAudio(file: File, startSec: number, endSec: number): Promise<Blob> {
  const Ctor = audioContextCtor();
  const context = new Ctor();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    return audioBufferToWav(decoded, startSec, endSec);
  } finally {
    await context.close().catch(() => {});
  }
}
