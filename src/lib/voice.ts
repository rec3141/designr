// Minimal browser voice recorder that produces 16kHz mono WAV base64.
// OpenRouter's input_audio content block only accepts "wav" or "mp3" per the
// OpenAI-compat spec, so we can't just hand MediaRecorder's webm/opus blob
// straight through. Instead we capture PCM via Web Audio, downsample to
// 16kHz, and encode a minimal WAV container in memory.

type AnyAudioContext = typeof AudioContext;

export type Recorder = {
  stop: () => Promise<string>; // resolves to base64 wav (no data: prefix)
  cancel: () => void;
};

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const Ctor: AnyAudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: AnyAudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);

  // ScriptProcessorNode is deprecated but ubiquitous and dead simple.
  // 4096-sample buffer gives ~85ms chunks at 48kHz — fine for dictation.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  // Must connect to destination or onaudioprocess won't fire in some browsers.
  processor.connect(ctx.destination);

  const inputSampleRate = ctx.sampleRate;
  const targetSampleRate = 16000;
  let cancelled = false;

  function teardown() {
    try { processor.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }

  return {
    async stop(): Promise<string> {
      teardown();
      if (cancelled) return "";
      const merged = concatFloat32(chunks);
      const downsampled = downsample(merged, inputSampleRate, targetSampleRate);
      const wav = encodeWav16(downsampled, targetSampleRate);
      return arrayBufferToBase64(wav);
    },
    cancel() {
      cancelled = true;
      teardown();
    },
  };
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return input;
  if (outRate > inRate) throw new Error("upsample not supported");
  const ratio = inRate / outRate;
  const newLen = Math.floor(input.length / ratio);
  const result = new Float32Array(newLen);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLen) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    // Average samples in the window for a basic anti-alias.
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  // 16-bit PCM mono WAV.
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
