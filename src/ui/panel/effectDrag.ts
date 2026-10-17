import type { PostEffectId } from '../../audio/engineMessages';

/** The effects that can be dragged out of the tray: the PRE drive and the POST effects. */
export type EffectId = PostEffectId | 'drive';

/** Every live effect, in chain order. */
export const EFFECTS: readonly EffectId[] = Object.freeze(['drive', 'chorus', 'tremolo', 'delay', 'reverb'] as EffectId[]);

/** The two thin slots in the chain, before the amp and after the cab. */
export type SlotSide = 'pre' | 'post';

/** Where each effect may sit. */
const SIDE: Record<EffectId, SlotSide> = { drive: 'pre', chorus: 'post', tremolo: 'post', delay: 'post', reverb: 'post' };

/** Whether `effect` may be dropped on the `side` slot. */
export function canDrop(effect: EffectId, side: SlotSide): boolean {
  return SIDE[effect] === side;
}

/** How far the pointer must travel before a press on a chip becomes a drag. */
export const DRAG_THRESHOLD_PX = 6;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}
