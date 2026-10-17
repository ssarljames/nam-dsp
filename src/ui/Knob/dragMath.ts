import type { ParamSpec } from '../../audio/params';

/** Vertical travel for the full range of a knob, in CSS pixels. */
export const FULL_RANGE_PX = 200;

/** A detent grabs within this fraction of the parameter's full range. */
const DETENT_WINDOW = 0.02;

/** A press that travels less than this, in CSS pixels, is a click and not a drag. */
export const TAP_MOVE_PX = 3;

export function isTap(totalMovePx: number): boolean {
  return totalMovePx < TAP_MOVE_PX;
}

export interface DragModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function deltaToNormalized(dyPx: number, mods: DragModifiers): number {
  let scale = 1 / FULL_RANGE_PX;
  if (mods.shiftKey) scale *= 0.2; // fine
  if (mods.ctrlKey || mods.metaKey) scale *= 3; // coarse
  return -dyPx * scale; // up increases
}

/**
 * Magnetic snap. The raw normalized position keeps accumulating inside the
 * knob, so dragging past the window escapes naturally and no hysteresis state
 * is needed.
 */
export function applyDetent(spec: ParamSpec, value: number): number {
  if (spec.detent === undefined) return value;
  const window = (spec.max - spec.min) * DETENT_WINDOW;
  return Math.abs(value - spec.detent) <= window ? spec.detent : value;
}

export function stepValue(
  spec: ParamSpec,
  value: number,
  direction: 1 | -1,
  large: boolean,
): number {
  const increment = spec.step * (large ? 10 : 1) * direction;
  const next = value + increment;
  return next < spec.min ? spec.min : next > spec.max ? spec.max : next;
}
