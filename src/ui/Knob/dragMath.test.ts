import { describe, expect, it } from 'vitest';
import { CORE_PARAMS } from '../../audio/params';
import { FULL_RANGE_PX, TAP_MOVE_PX, applyDetent, deltaToNormalized, isTap, stepValue } from './dragMath';

const noMods = { shiftKey: false, ctrlKey: false, metaKey: false };

describe('deltaToNormalized', () => {
  it('increases when the pointer moves up', () => {
    expect(deltaToNormalized(-10, noMods)).toBeGreaterThan(0);
  });

  it('decreases when the pointer moves down', () => {
    expect(deltaToNormalized(10, noMods)).toBeLessThan(0);
  });

  it('covers the full range over FULL_RANGE_PX of travel', () => {
    expect(deltaToNormalized(-FULL_RANGE_PX, noMods)).toBeCloseTo(1, 10);
  });

  it('makes shift fine at one fifth', () => {
    expect(deltaToNormalized(-FULL_RANGE_PX, { ...noMods, shiftKey: true })).toBeCloseTo(0.2, 10);
  });

  it('makes ctrl and cmd coarse at three times', () => {
    expect(deltaToNormalized(-FULL_RANGE_PX, { ...noMods, ctrlKey: true })).toBeCloseTo(3, 10);
    expect(deltaToNormalized(-FULL_RANGE_PX, { ...noMods, metaKey: true })).toBeCloseTo(3, 10);
  });

  it('combines fine and coarse multiplicatively', () => {
    expect(
      deltaToNormalized(-FULL_RANGE_PX, { ...noMods, shiftKey: true, ctrlKey: true }),
    ).toBeCloseTo(0.6, 10);
  });
});

describe('applyDetent', () => {
  const bass = CORE_PARAMS.bass; // -12..+12, detent at 0 → window is +/-0.48 dB

  it('snaps to the detent inside the window', () => {
    expect(applyDetent(bass, 0.3)).toBe(0);
    expect(applyDetent(bass, -0.3)).toBe(0);
  });

  it('leaves values outside the window alone', () => {
    expect(applyDetent(bass, 1.5)).toBe(1.5);
    expect(applyDetent(bass, -1.5)).toBe(-1.5);
  });

  it('does nothing for a parameter with no detent', () => {
    expect(applyDetent(CORE_PARAMS.outputVolume, -0.2)).toBe(-0.2);
  });
});

describe('stepValue', () => {
  it('steps by the parameter step and clamps at the ends', () => {
    expect(stepValue(CORE_PARAMS.bass, 0, 1, false)).toBeCloseTo(0.5);
    expect(stepValue(CORE_PARAMS.bass, 0, -1, false)).toBeCloseTo(-0.5);
    expect(stepValue(CORE_PARAMS.bass, 12, 1, false)).toBe(12);
    expect(stepValue(CORE_PARAMS.bass, -12, -1, false)).toBe(-12);
  });

  it('takes a large step ten times the size', () => {
    expect(stepValue(CORE_PARAMS.bass, 0, 1, true)).toBeCloseTo(5);
  });
});

describe('isTap', () => {
  it('treats a press that barely moved as a tap', () => {
    expect(isTap(0)).toBe(true);
    expect(isTap(TAP_MOVE_PX - 1)).toBe(true);
  });

  it('treats a press that travelled as a drag', () => {
    expect(isTap(TAP_MOVE_PX)).toBe(false);
    expect(isTap(40)).toBe(false);
  });
});
