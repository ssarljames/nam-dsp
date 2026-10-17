import { describe, expect, it } from 'vitest';
import { TAP_RESET_MS, pushTap, tapToRate, tapToTime } from './tapTempo';

const tapAll = (times: number[]) => times.reduce<number[]>((taps, t) => pushTap(taps, t), []);

describe('pushTap', () => {
  it('keeps taps that follow each other closely', () => {
    expect(tapAll([0, 500, 1000])).toEqual([0, 500, 1000]);
  });

  it('starts over after a pause longer than the reset time', () => {
    expect(tapAll([0, 500, 500 + TAP_RESET_MS + 1])).toEqual([500 + TAP_RESET_MS + 1]);
  });

  it('keeps a tap exactly at the reset time', () => {
    expect(tapAll([0, TAP_RESET_MS])).toEqual([0, TAP_RESET_MS]);
  });

  it('remembers only the last five taps, which is four intervals', () => {
    expect(tapAll([0, 100, 200, 300, 400, 500, 600])).toEqual([200, 300, 400, 500, 600]);
  });

  it('does not change the list it was given', () => {
    const taps = [0, 100];
    pushTap(taps, 200);
    expect(taps).toEqual([0, 100]);
  });
});

describe('tapToTime', () => {
  it('needs two taps', () => {
    expect(tapToTime([], 20, 1000)).toBeNull();
    expect(tapToTime([0], 20, 1000)).toBeNull();
  });

  it('reads one interval as the time', () => {
    expect(tapToTime([0, 400], 20, 1000)).toBe(400);
  });

  it('averages the intervals, so an uneven tap evens out', () => {
    // Intervals 400, 500, 450, 450: mean 450.
    expect(tapToTime([0, 400, 900, 1350, 1800], 20, 1000)).toBe(450);
  });

  it('clamps a tempo that is too slow or too fast to the range', () => {
    expect(tapToTime([0, 1800], 20, 1000)).toBe(1000);
    expect(tapToTime([0, 5], 20, 1000)).toBe(20);
  });

  it('ignores a list that is not going forward in time', () => {
    expect(tapToTime([500, 500], 20, 1000)).toBeNull();
    expect(tapToTime([900, 100], 20, 1000)).toBeNull();
  });
});

describe('tapToRate', () => {
  it('needs two taps', () => {
    expect(tapToRate([], 0.5, 15)).toBeNull();
    expect(tapToRate([0], 0.5, 15)).toBeNull();
  });

  it('makes one cycle per tap', () => {
    expect(tapToRate([0, 250], 0.5, 15)).toBe(4);
    expect(tapToRate([0, 500, 1000], 0.5, 15)).toBe(2);
  });

  it('averages the intervals, so an uneven tap evens out', () => {
    // Intervals 200, 300, 250, 250: mean 250 ms, 4 Hz.
    expect(tapToRate([0, 200, 500, 750, 1000], 0.5, 15)).toBe(4);
  });

  it('clamps a tempo that is too slow or too fast to the range', () => {
    expect(tapToRate([0, 40], 0.5, 15)).toBe(15);
    // The slowest a tap can be before it starts a new count is the slowest rate.
    expect(tapToRate([0, TAP_RESET_MS], 0.5, 15)).toBe(0.5);
  });

  it('ignores a list that is not going forward in time', () => {
    expect(tapToRate([500, 500], 0.5, 15)).toBeNull();
    expect(tapToRate([900, 100], 0.5, 15)).toBeNull();
  });
});
