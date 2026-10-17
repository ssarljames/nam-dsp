/**
 * Pure pitch-detection maths for the tuner. No browser APIs, no `AnalyserNode`,
 * no DOM — this module is driven with plain `Float32Array` buffers so it can
 * be unit tested with synthetic waveforms at known frequencies. The UI panel
 * that feeds it live audio is a separate, later task.
 *
 * Algorithm: normalised autocorrelation over a decimated signal, bounded to
 * the bass-through-guitar range, with an octave-error guard and parabolic
 * interpolation for sub-sample lag precision.
 */

/** A4 reference frequency. Exported so it is defined in exactly one place. */
export const CONCERT_PITCH_A4 = 440;

export interface PitchResult {
  /** Detected fundamental frequency, in Hz. */
  frequency: number;
  /** Normalised autocorrelation peak, 0..1. Higher means a cleaner periodic signal. */
  clarity: number;
}

export interface NoteReading {
  /** Note name using sharps, e.g. 'E', 'F#'. */
  name: string;
  /** Scientific pitch notation octave number. A440 is A4. */
  octave: number;
  /** Cents deviation from the nearest equal-tempered note. Negative is flat. */
  cents: number;
}

/** Below this RMS level, treat the buffer as silence and detect nothing. */
const RMS_GATE = 0.003;

/** Box-average decimation factor. Cuts correlation cost ~16x. */
const DECIMATION = 4;

/**
 * Bass through guitar pitch range. The floor sits just below A0 (27.5 Hz) so
 * a five-string bass dropped to low A is still detectable; the low end of a
 * five-string bass proper is B0 (30.87 Hz). The ceiling is unchanged from
 * the guitar-only range — bass needs nothing above it.
 */
const MIN_FREQUENCY_HZ = 27;
const MAX_FREQUENCY_HZ = 1400;

/** Below this normalised correlation, there is no reliable periodicity. */
const CLARITY_THRESHOLD = 0.5;

/** A sub-multiple-lag peak at least this fraction of the best peak wins the octave guard. */
const OCTAVE_GUARD_RATIO = 0.8;

/**
 * Largest integer divisor the sub-multiple guard tries. A steady tone's
 * autocorrelation stays nearly as strong at 2x, 3x, ... the true period as
 * at the true period itself (normalisation compensates for the shrinking
 * overlap), so widening the search range to reach bass frequencies means the
 * global peak can now land on any small multiple, not just double. The loop
 * below stops naturally once the candidate lag runs below the search floor;
 * this cap just bounds it defensively.
 */
const MAX_SUBMULTIPLE_DIVISOR = 8;

const NOTE_NAMES_FROM_C = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function rms(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

/** Box-average decimation by `DECIMATION`. Drops any trailing partial group. */
function decimate(samples: Float32Array): Float32Array {
  const outLength = Math.floor(samples.length / DECIMATION);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    const base = i * DECIMATION;
    for (let j = 0; j < DECIMATION; j++) sum += samples[base + j];
    out[i] = sum / DECIMATION;
  }
  return out;
}

/**
 * Normalised autocorrelation at a single lag:
 * r(tau) = sum(x[i] * x[i+tau]) / sqrt(sum(x[i]^2) * sum(x[i+tau]^2))
 */
function correlationAt(signal: Float32Array, lag: number): number {
  const overlap = signal.length - lag;
  let num = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < overlap; i++) {
    const a = signal[i];
    const b = signal[i + lag];
    num += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  const denom = Math.sqrt(energyA * energyB);
  return denom > 0 ? num / denom : 0;
}

export function detectPitch(samples: Float32Array, sampleRate: number): PitchResult | null {
  if (samples.length === 0) return null;
  if (rms(samples) < RMS_GATE) return null;

  const decimated = decimate(samples);
  const decimatedRate = sampleRate / DECIMATION;
  if (decimated.length < 4) return null;

  const minLag = Math.max(1, Math.floor(decimatedRate / MAX_FREQUENCY_HZ));
  const maxLag = Math.min(decimated.length - 1, Math.ceil(decimatedRate / MIN_FREQUENCY_HZ));
  if (maxLag <= minLag + 1) return null;

  // Compute correlation one lag wider on each side than the search range so
  // parabolic interpolation always has both neighbours available.
  const lagLo = Math.max(1, minLag - 1);
  const lagHi = Math.min(decimated.length - 1, maxLag + 1);
  const corr = new Float64Array(lagHi + 1);
  for (let lag = lagLo; lag <= lagHi; lag++) {
    corr[lag] = correlationAt(decimated, lag);
  }

  let bestLag = -1;
  let bestValue = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] > bestValue) {
      bestValue = corr[lag];
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;

  // Sub-multiple guard: naive autocorrelation can lock onto a lag that is
  // any small integer multiple of the true period (reporting a submultiple
  // of the true frequency), not just double it. Walk candidate lags at
  // bestLag/2, bestLag/3, ... and adopt the shortest (highest-frequency)
  // candidate whose correlation is still within OCTAVE_GUARD_RATIO of the
  // best found — almost certainly the true, shorter period. Candidates are
  // taken relative to the original winning lag, and the search keeps going
  // through larger divisors so it lands on the smallest period that still
  // qualifies, not just the first.
  const originalBestLag = bestLag;
  const originalBestValue = bestValue;
  for (let divisor = 2; divisor <= MAX_SUBMULTIPLE_DIVISOR; divisor++) {
    const candidateLag = Math.round(originalBestLag / divisor);
    if (candidateLag < lagLo) break;
    if (candidateLag === originalBestLag) continue;

    let candidateBestValue = -Infinity;
    let candidateBestLag = candidateLag;
    for (let lag = Math.max(lagLo, candidateLag - 1); lag <= Math.min(lagHi, candidateLag + 1); lag++) {
      if (corr[lag] > candidateBestValue) {
        candidateBestValue = corr[lag];
        candidateBestLag = lag;
      }
    }
    if (candidateBestValue >= OCTAVE_GUARD_RATIO * originalBestValue) {
      bestLag = candidateBestLag;
      bestValue = candidateBestValue;
    }
  }

  if (bestValue < CLARITY_THRESHOLD) return null;

  // Parabolic interpolation around the winning lag for sub-sample precision.
  const y0 = bestLag - 1 >= lagLo ? corr[bestLag - 1] : bestValue;
  const y1 = bestValue;
  const y2 = bestLag + 1 <= lagHi ? corr[bestLag + 1] : bestValue;
  const denom = y0 - 2 * y1 + y2;
  const delta = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
  const clampedDelta = Math.max(-1, Math.min(1, delta));
  const interpolatedLag = bestLag + clampedDelta;

  const frequency = decimatedRate / interpolatedLag;
  const clarity = Math.max(0, Math.min(1, bestValue));

  return { frequency, clarity };
}

export function frequencyToNote(frequency: number): NoteReading {
  const semitonesFromA4 = 12 * Math.log2(frequency / CONCERT_PITCH_A4);
  const roundedSemitones = Math.round(semitonesFromA4);
  const cents = (semitonesFromA4 - roundedSemitones) * 100;

  // MIDI note number: A4 = 69. This is what gets the C/B octave boundary
  // right — a naive floor(semitones / 12) does not.
  const midi = 69 + roundedSemitones;
  const noteIndex = ((midi % 12) + 12) % 12;
  const name = NOTE_NAMES_FROM_C[noteIndex];
  const octave = Math.floor(midi / 12) - 1;

  return { name, octave, cents };
}
