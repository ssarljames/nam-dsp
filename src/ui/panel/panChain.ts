/** Where the chain's scroll position ends up after a drag, clamped to its range. */
export function panScrollLeft({
  startLeft,
  startX,
  x,
  max,
}: {
  startLeft: number;
  startX: number;
  x: number;
  max: number;
}): number {
  const next = startLeft - (x - startX);
  return next < 0 ? 0 : next > max ? max : next;
}

/**
 * Whether a pointer-down starts a pan. Alt-drag works anywhere, a plain drag
 * works on the empty background between panels, and neither ever takes a drag
 * that begins on a control — a knob, a select, a button — which owns it.
 */
export function shouldStartPan({
  altKey,
  onBackground,
  onControl,
}: {
  altKey: boolean;
  onBackground: boolean;
  onControl: boolean;
}): boolean {
  if (onControl) return false;
  return altKey || onBackground;
}
