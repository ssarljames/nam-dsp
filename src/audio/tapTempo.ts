/**
 * The maths behind a tap-tempo button. Pure, so it is tested without a browser:
 * the screen only passes in the time of each tap.
 */

/** A pause longer than this between taps starts a new count. */
export const TAP_RESET_MS = 2000;

/** Five taps make four intervals, which is as many as are averaged. */
const MAX_TAPS = 5;

/** The tap history after a tap at `now` (milliseconds, any steady clock). Never changes `taps`. */
export function pushTap(taps: readonly number[], now: number): number[] {
  const last = taps[taps.length - 1];
  const kept = last !== undefined && now - last > TAP_RESET_MS ? [] : taps;
  return [...kept, now].slice(-MAX_TAPS);
}

/**
 * The tempo the taps describe as a time between beats, clamped to `min`..`max`,
 * or null when there is not yet one: fewer than two taps, or taps that do not
 * move forward in time.
 */
export function tapToTime(taps: readonly number[], min: number, max: number): number | null {
  if (taps.length < 2) return null;
  const span = taps[taps.length - 1] - taps[0];
  if (!(span > 0)) return null;
  const mean = span / (taps.length - 1);
  return mean < min ? min : mean > max ? max : mean;
}

/**
 * The tempo the taps describe as one cycle per tap, in Hz, clamped to
 * `minHz`..`maxHz`, or null when there is not yet one (as tapToTime).
 */
export function tapToRate(taps: readonly number[], minHz: number, maxHz: number): number | null {
  const ms = tapToTime(taps, 0, Infinity);
  if (ms === null) return null;
  const hz = 1000 / ms;
  return hz < minHz ? minHz : hz > maxHz ? maxHz : hz;
}
