import { describe, expect, it } from 'vitest';
import { IR_FADE_SAMPLES, downmixToMono, prepareIr } from './irPrep';

const energy = (taps: Float32Array) => Math.sqrt(taps.reduce((sum, v) => sum + v * v, 0));

describe('downmixToMono', () => {
  it('averages the channels', () => {
    const mono = downmixToMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 1, 1)]);
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0]);
  });

  it("returns a copy of a single channel, not the decoder's own buffer", () => {
    const source = Float32Array.of(0.1, 0.2);
    const mono = downmixToMono([source]);
    expect(Array.from(mono)).toEqual([expect.closeTo(0.1, 6), expect.closeTo(0.2, 6)]);
    expect(mono).not.toBe(source);
  });

  it('rejects a file with no channels', () => {
    expect(() => downmixToMono([])).toThrow('no audio');
  });
});

describe('prepareIr', () => {
  it('keeps a short IR its own length and does not flag it as truncated', () => {
    const { taps, truncated } = prepareIr(Float32Array.of(0.5, 0.25, -0.125), 4096);
    expect(taps).toHaveLength(3);
    expect(truncated).toBe(false);
  });

  it('normalises to unit energy', () => {
    const { taps } = prepareIr(Float32Array.of(3, -4, 12, 0.5), 4096);
    expect(energy(taps)).toBeCloseTo(1, 5);
  });

  it('leaves a lone unit impulse as a unit impulse, whatever its level', () => {
    expect(Array.from(prepareIr(Float32Array.of(0.3), 4096).taps)).toEqual([expect.closeTo(1, 6)]);
  });

  it('truncates to the tap cap, flags it, and fades the cut', () => {
    const { taps, truncated } = prepareIr(new Float32Array(200).fill(1), 100);
    expect(taps).toHaveLength(100);
    expect(truncated).toBe(true);

    const firstFaded = 100 - IR_FADE_SAMPLES;
    expect(taps[0]).toBeCloseTo(taps[firstFaded - 1], 6); // untouched before the fade
    expect(taps[firstFaded - 1]).toBeGreaterThan(taps[98]);
    expect(taps[98]).toBeGreaterThan(taps[99]);
    expect(taps[99]).toBe(0); // the last sample is faded all the way out
  });

  it('does not fade an IR that was not cut', () => {
    const { taps } = prepareIr(new Float32Array(100).fill(1), 100);
    expect(taps[99]).toBeCloseTo(taps[0], 6);
  });

  it('does not modify its input', () => {
    const input = Float32Array.of(1, 2, 3);
    prepareIr(input, 4096);
    expect(Array.from(input)).toEqual([1, 2, 3]);
  });

  it('returns a buffer sized exactly to the taps, so it can be transferred', () => {
    const { taps } = prepareIr(new Float32Array(500).fill(0.1), 100);
    expect(taps.byteOffset).toBe(0);
    expect(taps.buffer.byteLength).toBe(taps.length * 4);
  });

  it('rejects an empty file', () => {
    expect(() => prepareIr(new Float32Array(0), 4096)).toThrow('no audio');
  });

  it('rejects a silent file', () => {
    expect(() => prepareIr(new Float32Array(64), 4096)).toThrow('silent');
  });

  it('rejects a file with a NaN or infinite sample', () => {
    expect(() => prepareIr(Float32Array.of(1, Number.NaN), 4096)).toThrow('non-finite');
    expect(() => prepareIr(Float32Array.of(1, Number.POSITIVE_INFINITY), 4096)).toThrow('non-finite');
  });
});
