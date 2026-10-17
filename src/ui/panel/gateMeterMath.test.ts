import { describe, expect, it } from 'vitest';
import { GATE_METER_FALL_DB_PER_MS, dbToY, meterSegments, nextLevelDb, peakToDb } from './gateMeterMath';

describe('dbToY', () => {
  it('puts 0 dB at the top and -80 dB at the bottom of the thumb travel', () => {
    // The thumb is 14px tall, so its centre travels from 7px in to 7px short of each end.
    expect(dbToY(0, 150)).toBe(7);
    expect(dbToY(-80, 150)).toBe(143);
    expect(dbToY(-40, 150)).toBe(75);
  });

  it('pins anything outside the range to its end', () => {
    expect(dbToY(12, 150)).toBe(7);
    expect(dbToY(-200, 150)).toBe(143);
  });
});

describe('peakToDb', () => {
  it('reads full scale as 0 dB and half as about -6 dB', () => {
    expect(peakToDb(1)).toBeCloseTo(0, 6);
    expect(peakToDb(0.5)).toBeCloseTo(-6.02, 2);
  });

  it('reads silence as a finite floor, not minus infinity', () => {
    expect(Number.isFinite(peakToDb(0))).toBe(true);
    expect(peakToDb(0)).toBeLessThan(-100);
  });
});

describe('nextLevelDb', () => {
  it('jumps straight up to a louder signal', () => {
    expect(nextLevelDb(-50, -10, 16)).toBe(-10);
  });

  it('falls at a steady rate rather than dropping at once', () => {
    expect(nextLevelDb(-20, -80, 100)).toBeCloseTo(-20 - GATE_METER_FALL_DB_PER_MS * 100, 6);
  });

  it('never falls below the signal itself', () => {
    expect(nextLevelDb(-20, -21, 1000)).toBe(-21);
  });
});

describe('meterSegments', () => {
  it('shows a signal under the threshold as gray only', () => {
    expect(meterSegments(-50, -40)).toEqual({ grayTopDb: -50, colorTopDb: null });
  });

  it('splits at the threshold when the signal is over it', () => {
    expect(meterSegments(-20, -40)).toEqual({ grayTopDb: -40, colorTopDb: -20 });
  });

  it('draws nothing at the floor', () => {
    expect(meterSegments(-80, -60)).toEqual({ grayTopDb: -80, colorTopDb: null });
  });

  it('treats a signal exactly at the threshold as under it', () => {
    expect(meterSegments(-40, -40)).toEqual({ grayTopDb: -40, colorTopDb: null });
  });

  it('clamps the level to the meter range', () => {
    expect(meterSegments(6, -40)).toEqual({ grayTopDb: -40, colorTopDb: 0 });
    expect(meterSegments(-120, -40)).toEqual({ grayTopDb: -80, colorTopDb: null });
  });
});
