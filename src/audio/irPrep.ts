/**
 * Turns an uploaded audio file into the mono, 48 kHz tap array the cab stage
 * convolves with. All of it happens on the main thread, once, where allocating
 * and being slow are fine — the engine only ever sees the finished floats
 * (spec 2026-09-24-cab-ir §4).
 */

/** The AudioContext runs at 48 kHz (AudioEngine.createContext), and so does the engine. */
export const IR_SAMPLE_RATE = 48000;

/** When an IR is cut at the tap cap, this many final samples fade to zero. */
export const IR_FADE_SAMPLES = 64;

/** Below this energy an IR is treated as silence. */
const SILENCE_FLOOR = 1e-9;

export interface PreparedIr {
  /** Mono taps that own an exact-size buffer, so the buffer can be transferred whole. */
  taps: Float32Array;
  truncated: boolean;
}

/** decodeAudioData keeps the file's channel count, so this is a separate step. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) throw new Error('the file contains no audio');
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i];
  }
  if (channels.length > 1) {
    const scale = 1 / channels.length;
    for (let i = 0; i < length; i++) mono[i] *= scale;
  }
  return mono;
}

/**
 * Truncates to `maxTaps`, fades the cut, and normalises so the IR's energy
 * `sqrt(Σh²)` is 1. IR files vary wildly in level; this keeps loudness roughly
 * comparable between them and leaves LEVEL to trim from there. The constant
 * lives here, in one place, if it sounds wrong.
 *
 * Throws with a message fit for the log rather than loading something the
 * engine would reject or play as silence.
 */
export function prepareIr(samples: Float32Array, maxTaps: number): PreparedIr {
  if (samples.length === 0) throw new Error('the file contains no audio');

  const truncated = samples.length > maxTaps;
  // slice() copies into a fresh, exact-size buffer and leaves the input alone.
  const taps = samples.slice(0, truncated ? maxTaps : samples.length);

  for (let i = 0; i < taps.length; i++) {
    if (!Number.isFinite(taps[i])) throw new Error('the file contains a non-finite sample');
  }

  if (truncated) {
    const fade = Math.min(IR_FADE_SAMPLES, taps.length);
    for (let j = 0; j < fade; j++) taps[taps.length - fade + j] *= 1 - (j + 1) / fade;
  }

  let sumOfSquares = 0;
  for (let i = 0; i < taps.length; i++) sumOfSquares += taps[i] * taps[i];
  const norm = Math.sqrt(sumOfSquares);
  if (!(norm > SILENCE_FLOOR)) throw new Error('the file is silent');

  const scale = 1 / norm;
  for (let i = 0; i < taps.length; i++) taps[i] *= scale;

  return { taps, truncated };
}

/**
 * Decodes whatever the browser can (WAV at least) and resamples to 48 kHz, then
 * averages to mono. A failed decode rejects with the browser's own error.
 * Browser-only, so it is not covered by the Vitest suite.
 */
export async function decodeIrBytes(bytes: ArrayBuffer): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, IR_SAMPLE_RATE);
  const audio = await context.decodeAudioData(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
  return downmixToMono(channels);
}
