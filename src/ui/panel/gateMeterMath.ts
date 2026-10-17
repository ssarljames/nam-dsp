import { LEVEL_SLIDER_THUMB } from '../Knob/sliderGeometry';

/** The gate threshold's range, which is also the meter's: dB of the input, before any gain. */
export const GATE_DB_MIN = -80;
export const GATE_DB_MAX = 0;

/**
 * How fast the shown level falls once the signal drops, in dB per millisecond
 * (60 dB a second). The gate itself follows a 10 ms envelope; drawn at that
 * speed the bar would flicker too fast to read.
 */
export const GATE_METER_FALL_DB_PER_MS = 0.06;

const clampDb = (db: number) => Math.max(GATE_DB_MIN, Math.min(GATE_DB_MAX, db));

/**
 * Vertical position for a level, measured from the top of a meter `height`
 * pixels tall. It uses the thumb's travel, not the whole height, so a level
 * sits at the same height as the slider thumb set to that value.
 */
export function dbToY(db: number, height: number): number {
  const inset = LEVEL_SLIDER_THUMB / 2;
  const fraction = (clampDb(db) - GATE_DB_MIN) / (GATE_DB_MAX - GATE_DB_MIN);
  return inset + (1 - fraction) * (height - 2 * inset);
}

/** A peak amplitude in dB. Silence reads as a very low finite number rather than -Infinity. */
export function peakToDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-6));
}

/** Instant rise, steady fall, never below the signal itself. */
export function nextLevelDb(previous: number, instant: number, deltaMs: number): number {
  return Math.max(instant, previous - GATE_METER_FALL_DB_PER_MS * deltaMs);
}

/**
 * Where the bar changes colour. Everything up to the threshold is gray — the
 * gate would close on it — and only what rises above the threshold is drawn
 * in colour. `colorTopDb` is null when nothing is over it.
 */
export function meterSegments(
  levelDb: number,
  thresholdDb: number,
): { grayTopDb: number; colorTopDb: number | null } {
  const level = clampDb(levelDb);
  const threshold = clampDb(thresholdDb);
  if (level <= threshold) return { grayTopDb: level, colorTopDb: null };
  return { grayTopDb: threshold, colorTopDb: level };
}
