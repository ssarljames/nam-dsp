import { describe, expect, it } from 'vitest';
import { CONCERT_PITCH_A4, detectPitch, frequencyToNote } from './pitch';

/** Sums sine partials: partials = [[frequency, amplitude], ...]. */
function buildTone(
  partials: Array<[frequency: number, amplitude: number]>,
  sampleRate: number,
  durationSeconds: number
): Float32Array {
  const length = Math.floor(sampleRate * durationSeconds);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const [frequency, amplitude] of partials) {
      sample += amplitude * Math.sin(2 * Math.PI * frequency * t);
    }
    out[i] = sample;
  }
  return out;
}

/** Same as `buildTone`, but by exact sample count rather than a duration — avoids
 * floating-point rounding when the caller needs a specific buffer length, such as
 * the tuner's actual 8192-sample analyser window. */
function buildToneSamples(
  partials: Array<[frequency: number, amplitude: number]>,
  sampleRate: number,
  length: number
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const [frequency, amplitude] of partials) {
      sample += amplitude * Math.sin(2 * Math.PI * frequency * t);
    }
    out[i] = sample;
  }
  return out;
}

/** Deterministic seeded PRNG (mulberry32) so noise tests never flake. */
function seededNoise(length: number, seed: number, amplitude: number): Float32Array {
  let a = seed;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    out[i] = (r * 2 - 1) * amplitude;
  }
  return out;
}

/** Cents between two frequencies. */
function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

const SAMPLE_RATE = 48000;
const DURATION = 0.5;

const OPEN_STRINGS: Array<[name: string, frequency: number]> = [
  ['E2', 82.41],
  ['A2', 110.0],
  ['D3', 146.83],
  ['G3', 196.0],
  ['B3', 246.94],
  ['E4', 329.63],
];

/** The five open strings of a five-string bass, low to high. */
const BASS_OPEN_STRINGS: Array<[name: string, frequency: number]> = [
  ['B0', 30.87],
  ['E1', 41.2],
  ['A1', 55.0],
  ['D2', 73.42],
  ['G2', 98.0],
];

/**
 * The tuner analyser now runs at fftSize 8192 (see AudioEngine.tunerAnalyserNode),
 * 171 ms at 48 kHz. Bass tests build buffers at this length rather than the
 * 0.5 s duration used above, so they exercise the window the tuner actually
 * delivers.
 */
const BASS_WINDOW_SAMPLES = 8192;

describe('detectPitch', () => {
  for (const [name, frequency] of OPEN_STRINGS) {
    it(`detects the open ${name} string within 3 cents`, () => {
      const signal = buildTone([[frequency, 0.6]], SAMPLE_RATE, DURATION);
      const result = detectPitch(signal, SAMPLE_RATE);
      expect(result).not.toBeNull();
      const errorCents = Math.abs(centsBetween(result!.frequency, frequency));
      expect(errorCents).toBeLessThan(3);
    });
  }

  it('does not report the octave above when the second harmonic is louder than the fundamental', () => {
    const fundamental = 110.0;
    const signal = buildTone(
      [
        [fundamental, 0.4],
        [fundamental * 2, 1.0],
      ],
      SAMPLE_RATE,
      DURATION
    );
    const result = detectPitch(signal, SAMPLE_RATE);
    expect(result).not.toBeNull();
    const errorCents = Math.abs(centsBetween(result!.frequency, fundamental));
    expect(errorCents).toBeLessThan(3);
  });

  it('detects a realistic decaying harmonic stack within 3 cents', () => {
    const fundamental = 146.83; // D3
    const signal = buildTone(
      [
        [fundamental, 1.0],
        [fundamental * 2, 0.5],
        [fundamental * 3, 0.25],
        [fundamental * 4, 0.12],
      ],
      SAMPLE_RATE,
      DURATION
    );
    const result = detectPitch(signal, SAMPLE_RATE);
    expect(result).not.toBeNull();
    const errorCents = Math.abs(centsBetween(result!.frequency, fundamental));
    expect(errorCents).toBeLessThan(3);
  });

  it('returns null for silence', () => {
    const silence = new Float32Array(Math.floor(SAMPLE_RATE * DURATION));
    expect(detectPitch(silence, SAMPLE_RATE)).toBeNull();
  });

  it('returns null for white noise', () => {
    const noise = seededNoise(Math.floor(SAMPLE_RATE * DURATION), 0x9e3779b9, 0.5);
    expect(detectPitch(noise, SAMPLE_RATE)).toBeNull();
  });

  it('detects a quiet tone just above the RMS gate', () => {
    // Sine RMS = amplitude / sqrt(2); pick an amplitude that clears the 0.003 gate.
    const amplitude = 0.006; // RMS ~= 0.0042
    const signal = buildTone([[110.0, amplitude]], SAMPLE_RATE, DURATION);
    const result = detectPitch(signal, SAMPLE_RATE);
    expect(result).not.toBeNull();
  });

  it('returns null for a tone just below the RMS gate', () => {
    const amplitude = 0.002; // RMS ~= 0.0014, below the 0.003 gate
    const signal = buildTone([[110.0, amplitude]], SAMPLE_RATE, DURATION);
    expect(detectPitch(signal, SAMPLE_RATE)).toBeNull();
  });

  for (const [name, frequency] of BASS_OPEN_STRINGS) {
    it(`detects the open ${name} bass string within 3 cents`, () => {
      const signal = buildToneSamples([[frequency, 0.6]], SAMPLE_RATE, BASS_WINDOW_SAMPLES);
      const result = detectPitch(signal, SAMPLE_RATE);
      expect(result).not.toBeNull();
      const errorCents = Math.abs(centsBetween(result!.frequency, frequency));
      expect(errorCents).toBeLessThan(3);
    });
  }

  it('does not report the octave (or the octave above that) above on a weak-fundamental low E1', () => {
    // Through a pickup, a low bass fundamental is often quieter than its
    // second and third harmonics. This is the octave guard's hardest case,
    // proven at bass frequencies rather than just at guitar's E2.
    const fundamental = 41.2; // E1
    const signal = buildToneSamples(
      [
        [fundamental, 0.2],
        [fundamental * 2, 1.0],
        [fundamental * 3, 0.7],
      ],
      SAMPLE_RATE,
      BASS_WINDOW_SAMPLES
    );
    const result = detectPitch(signal, SAMPLE_RATE);
    expect(result).not.toBeNull();
    const errorCents = Math.abs(centsBetween(result!.frequency, fundamental));
    expect(errorCents).toBeLessThan(3);
  });
});

describe('frequencyToNote', () => {
  it('reads concert A4 as A4 at 0 cents', () => {
    const reading = frequencyToNote(CONCERT_PITCH_A4);
    expect(reading.name).toBe('A');
    expect(reading.octave).toBe(4);
    expect(reading.cents).toBeCloseTo(0, 1);
  });

  it('reads 261.63 Hz as C4 (the octave boundary falls between B and C)', () => {
    const reading = frequencyToNote(261.63);
    expect(reading.name).toBe('C');
    expect(reading.octave).toBe(4);
    expect(Math.abs(reading.cents)).toBeLessThan(2);
  });

  it('reads 82.41 Hz as E2', () => {
    const reading = frequencyToNote(82.41);
    expect(reading.name).toBe('E');
    expect(reading.octave).toBe(2);
    expect(Math.abs(reading.cents)).toBeLessThan(2);
  });

  it('reads a tone 25 cents sharp of A4 as approximately +25 cents', () => {
    const sharp = CONCERT_PITCH_A4 * Math.pow(2, 25 / 1200);
    const reading = frequencyToNote(sharp);
    expect(reading.name).toBe('A');
    expect(reading.octave).toBe(4);
    expect(reading.cents).toBeCloseTo(25, 0);
  });

  it('reads a tone 25 cents flat of A4 as approximately -25 cents', () => {
    const flat = CONCERT_PITCH_A4 * Math.pow(2, -25 / 1200);
    const reading = frequencyToNote(flat);
    expect(reading.name).toBe('A');
    expect(reading.octave).toBe(4);
    expect(reading.cents).toBeCloseTo(-25, 0);
  });

  it('reads 30.87 Hz as B0 (five-string bass low B)', () => {
    const reading = frequencyToNote(30.87);
    expect(reading.name).toBe('B');
    expect(reading.octave).toBe(0);
    expect(Math.abs(reading.cents)).toBeLessThan(2);
  });

  it('reads 41.20 Hz as E1 (four/five-string bass low E)', () => {
    const reading = frequencyToNote(41.2);
    expect(reading.name).toBe('E');
    expect(reading.octave).toBe(1);
    expect(Math.abs(reading.cents)).toBeLessThan(2);
  });
});

/**
 * A plucked string rather than a test sine: a full harmonic series with
 * per-partial decay (upper partials die faster), random phase per partial,
 * broadband noise, and a start offset so the buffer is not aligned to the
 * period. Length is the tuner's real 8192-sample analyser window.
 *
 * Pure sines are the easy case for autocorrelation. These signals are what
 * actually reaches the detector, and they are what would expose an octave
 * error in the sub-multiple guard — the failure mode that is silent to the
 * suite but glaring to anyone holding the instrument.
 */
function buildPluck(
  f0: number,
  options: {
    partialCount?: number;
    rolloff?: number;
    decaySeconds?: number;
    noise?: number;
    seed?: number;
    /** Per-partial amplitudes, overriding the 1/n^rolloff default. */
    amplitudes?: number[];
  } = {}
): Float32Array {
  const {
    partialCount = 14,
    rolloff = 1,
    decaySeconds = 1.2,
    noise = 0.004,
    seed = 1,
    amplitudes,
  } = options;
  const sampleRate = 48000;
  const length = 8192;
  const startSeconds = 0.017;

  let a = seed;
  const random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const phases: number[] = [];
  for (let n = 0; n < partialCount; n++) phases.push(random() * 2 * Math.PI);

  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = startSeconds + i / sampleRate;
    let sample = 0;
    for (let n = 1; n <= partialCount; n++) {
      const frequency = n * f0;
      if (frequency > sampleRate / 2) break;
      const amplitude = amplitudes?.[n - 1] ?? 1 / Math.pow(n, rolloff);
      sample += amplitude * Math.exp(-t / (decaySeconds / Math.sqrt(n))) *
        Math.sin(2 * Math.PI * frequency * t + phases[n - 1]);
    }
    out[i] = sample * 0.25 + (random() * 2 - 1) * noise;
  }
  return out;
}

describe('detectPitch on realistic plucked strings', () => {
  const openStrings: Array<[label: string, frequency: number]> = [
    ['bass B0', 30.87],
    ['bass E1', 41.2],
    ['bass A1', 55.0],
    ['bass D2', 73.42],
    ['bass G2', 98.0],
    ['guitar E2', 82.41],
    ['guitar A2', 110.0],
    ['guitar D3', 146.83],
    ['guitar G3', 196.0],
    ['guitar B3', 246.94],
    ['guitar E4', 329.63],
  ];

  for (const [index, [label, frequency]] of openStrings.entries()) {
    it(`tracks ${label} within 3 cents through a full harmonic series`, () => {
      const result = detectPitch(buildPluck(frequency, { seed: 11 * (index + 1) }), 48000);
      expect(result).not.toBeNull();
      expect(Math.abs(centsBetween(result!.frequency, frequency))).toBeLessThan(3);
    });
  }

  // A magnetic pickup routinely delivers a low string whose fundamental is
  // quieter than its second and third partials. Reporting the partial instead
  // of the note is the classic bass-tuner failure.
  for (const [label, frequency] of [['B0', 30.87], ['E1', 41.2]] as const) {
    it(`tracks bass ${label} when the fundamental is far weaker than its partials`, () => {
      const samples = buildPluck(frequency, {
        seed: 909,
        amplitudes: [0.1, 1.0, 0.9, 0.6, 0.4, 0.3, 0.2, 0.15],
        partialCount: 8,
      });
      const result = detectPitch(samples, 48000);
      expect(result).not.toBeNull();
      expect(Math.abs(centsBetween(result!.frequency, frequency))).toBeLessThan(3);
    });
  }

  // The sub-multiple guard walks divisors 2..8 and prefers the shortest
  // qualifying period, so it is biased toward reporting too high. A bright,
  // partial-rich tone is where that bias would show as an octave-up error.
  for (const [label, frequency] of [['bass B0', 30.87], ['bass E1', 41.2], ['guitar E2', 82.41]] as const) {
    it(`does not jump an octave on a bright, partial-rich ${label}`, () => {
      const samples = buildPluck(frequency, { seed: 4242, partialCount: 20, rolloff: 0.3 });
      const result = detectPitch(samples, 48000);
      expect(result).not.toBeNull();
      // Within a semitone: catches any 2x/3x/5x lock without asserting
      // fine accuracy, which the tests above already cover.
      expect(Math.abs(centsBetween(result!.frequency, frequency))).toBeLessThan(100);
    });
  }
});
