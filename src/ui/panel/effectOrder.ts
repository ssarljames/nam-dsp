import type { PostEffectId } from '../../audio/engineMessages';

/** Anything that says whether an effect is placed: a set of POST effects, or of all effects. */
type PlacedSet = { has(effect: PostEffectId): boolean };

/**
 * The order of the POST effects, as pure functions over the stored order (a
 * permutation of both effects, placed or not) and the set that is placed.
 * Every function returns a new array and never changes its input.
 */

/** Which side of the target a dragged panel goes to. */
export type DropSide = 'before' | 'after';

export function sameOrder(a: readonly PostEffectId[], b: readonly PostEffectId[]): boolean {
  return a.length === b.length && a.every((effect, i) => effect === b[i]);
}

/** The placed effects, in the order they run: what the POST area shows. */
export function placedInOrder(order: readonly PostEffectId[], placed: PlacedSet): PostEffectId[] {
  return order.filter((effect) => placed.has(effect));
}

/** A newly placed effect goes after whatever is already in the chain. */
export function placeAtEnd(order: readonly PostEffectId[], effect: PostEffectId): PostEffectId[] {
  return [...order.filter((e) => e !== effect), effect];
}

/** `effect` moved to just before or just after `target`. Unchanged if they are the same. */
export function dropBeside(
  order: readonly PostEffectId[],
  effect: PostEffectId,
  target: PostEffectId,
  side: DropSide,
): PostEffectId[] {
  if (effect === target) return [...order];
  const rest = order.filter((e) => e !== effect);
  const at = rest.indexOf(target);
  if (at === -1) return [...order];
  rest.splice(side === 'before' ? at : at + 1, 0, effect);
  return rest;
}

/** Where a new effect lands among the placed ones: beside `target`, on `side`. */
export interface DropPoint {
  target: PostEffectId;
  side: DropSide;
}

/**
 * A newly placed effect: beside the drop point it was released at, or after
 * everything else when there is none (Enter on a chip, or an empty slot).
 */
export function placeAt(order: readonly PostEffectId[], effect: PostEffectId, at: DropPoint | null): PostEffectId[] {
  return at === null ? placeAtEnd(order, effect) : dropBeside(order, effect, at.target, at.side);
}

/**
 * The gap in a slot nearest the pointer, from its panels left to right: before
 * the first panel whose middle is right of `x`, or after the last one. Every
 * point in the slot maps to a gap, so a release anywhere in it places the
 * effect. Nothing when the slot holds no panel.
 */
export function insertionPoint(
  x: number,
  panels: ReadonlyArray<{ effect: PostEffectId; left: number; width: number }>,
): DropPoint | null {
  if (panels.length === 0) return null;
  const next = panels.find((p) => x < p.left + p.width / 2);
  return next ? { target: next.effect, side: 'before' } : { target: panels[panels.length - 1].effect, side: 'after' };
}

/**
 * `effect` moved one place back (-1) or forward (+1) among the placed effects:
 * past the neighbour on that side, if there is one. An effect that is not
 * placed, or is already at that end, stays where it is.
 */
export function moveBy(
  order: readonly PostEffectId[],
  placed: PlacedSet,
  effect: PostEffectId,
  delta: -1 | 1,
): PostEffectId[] {
  const visible = placedInOrder(order, placed);
  const from = visible.indexOf(effect);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= visible.length) return [...order];
  return dropBeside(order, effect, visible[to], delta < 0 ? 'before' : 'after');
}

/** The panel a dragged title may land on: any placed effect but itself. */
export function validDropTarget(dragged: PostEffectId, hovered: PostEffectId | null): PostEffectId | null {
  return hovered !== null && hovered !== dragged ? hovered : null;
}

/** The left half of the target means before it, the right half after it. */
export function dropSide(x: number, rect: { left: number; width: number }): DropSide {
  return x < rect.left + rect.width / 2 ? 'before' : 'after';
}

export interface ArrowKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

/**
 * The move for a key pressed on a focused title: plain ← and → only. Every
 * modifier is left alone (Alt+arrows is browser back and forward, Ctrl+arrows
 * switches desktops on some systems), and so is a held key. Space is never
 * used: it is the panic mute.
 */
export function arrowDelta(e: ArrowKeyEvent): -1 | 1 | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return null;
  if (e.key === 'ArrowLeft') return -1;
  if (e.key === 'ArrowRight') return 1;
  return null;
}
