import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { canDrop, exceedsDragThreshold, type EffectId, type SlotSide } from './effectDrag';
import { insertionPoint, type DropPoint, type DropSide } from './effectOrder';

/** The handlers to spread on a tray chip (a `button`). */
export interface ChipProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/** How an effect was added: dragged onto a slot, or Enter on its chip. */
export type AddVia = 'pointer' | 'keyboard';

interface Gesture {
  effect: EffectId;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
  /** The panel carrying the drop line, and which side the line is on. */
  mark: HTMLElement | null;
  markSide: DropSide | null;
}

const OVER = 'chain__slot--over';
const REFUSE = 'effect-ghost--refuse';
// The same line usePanelDrag draws when a placed panel is reordered.
const DROP_CLASS: Record<DropSide, string> = {
  before: 'chain__cell--drop-before',
  after: 'chain__cell--drop-after',
};

/** The slot under a screen point, if any. Slots opt in with `data-slot`. */
function slotAt(x: number, y: number): { el: HTMLElement; side: SlotSide } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]') ?? null;
  const side = el?.dataset.slot;
  return el && (side === 'pre' || side === 'post') ? { el, side } : null;
}

/** The panels already in `slot`, left to right, keyed for insertionPoint. */
function panelsIn(slot: HTMLElement) {
  return [...slot.querySelectorAll<HTMLElement>('[data-effect-panel]')].flatMap((el) => {
    const effect = el.dataset.effectPanel;
    if (effect !== 'chorus' && effect !== 'delay') return [];
    const { left, width } = el.getBoundingClientRect();
    return [{ el, effect, left, width } as const];
  });
}

/** Where a release at `x` in `slot` would put the new effect, and the panel that shows it. */
function dropIn(slot: HTMLElement, x: number): { at: DropPoint; el: HTMLElement } | null {
  const panels = panelsIn(slot);
  const at = insertionPoint(x, panels);
  const el = at && panels.find((p) => p.effect === at.target)?.el;
  return at && el ? { at, el } : null;
}

function clearMark(g: Gesture): void {
  g.mark?.classList.remove(DROP_CLASS.before, DROP_CLASS.after);
  g.mark = null;
  g.markSide = null;
}

/** What follows the pointer during a drag. Shared with usePanelDrag. */
export function makeDragGhost(label: string): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'effect-ghost';
  ghost.textContent = label;
  document.body.appendChild(ghost);
  return ghost;
}

/**
 * Drag a tray chip onto a slot with pointer events, so it works with a mouse
 * and on a touch screen (HTML5 drag-and-drop does not work on touch). Over a
 * slot that already holds effects, a line marks the gap it will go into, and
 * the drop places it there. Enter on the focused chip adds it too, at the end,
 * for keyboard users. Space is deliberately not
 * used: it is the panic mute.
 *
 * `dragging` changes only when a drag starts or ends, so the screen re-renders
 * twice per drag, not on every pointer move; the hover highlight and the line
 * are classes toggled directly on the slot and the panel.
 */
export function useEffectDrag({
  onDrop,
}: {
  onDrop: (effect: EffectId, via: AddVia, at: DropPoint | null) => void;
}) {
  const [dragging, setDragging] = useState<EffectId | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const finish = useCallback((drop: boolean, x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    g.ghost?.remove();
    g.over?.classList.remove(OVER);
    clearMark(g);
    if (!g.started) return;
    setDragging(null);
    if (!drop) return;
    const hit = slotAt(x, y);
    if (hit && canDrop(g.effect, hit.side)) onDropRef.current(g.effect, 'pointer', dropIn(hit.el, x)?.at ?? null);
  }, []);

  // A drag in progress when the screen goes away must not leave a ghost behind.
  useEffect(() => () => finish(false, 0, 0), [finish]);

  const chipProps = useCallback(
    (effect: EffectId, label: string): ChipProps => ({
      onPointerDown: (e) => {
        if (e.button !== 0 || gesture.current) return;
        if ((e.currentTarget as HTMLButtonElement).disabled) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Proceed without capture; a lost gesture is still cleaned up on pointerup.
        }
        gesture.current = {
          effect,
          label,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          started: false,
          ghost: null,
          over: null,
          mark: null,
          markSide: null,
        };
      },
      onPointerMove: (e) => {
        const g = gesture.current;
        if (!g || e.pointerId !== g.pointerId) return;
        if (!g.started) {
          if (!exceedsDragThreshold(e.clientX - g.startX, e.clientY - g.startY)) return;
          g.started = true;
          g.ghost = makeDragGhost(g.label);
          setDragging(g.effect);
        }
        if (g.ghost) g.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;

        const hit = slotAt(e.clientX, e.clientY);
        const valid = hit !== null && canDrop(g.effect, hit.side);
        const target = valid ? hit.el : null;
        if (target !== g.over) {
          g.over?.classList.remove(OVER);
          target?.classList.add(OVER);
          g.over = target;
        }
        g.ghost?.classList.toggle(REFUSE, hit !== null && !valid);

        // The line at the gap the effect would go into, among those already in the slot.
        const drop = target ? dropIn(target, e.clientX) : null;
        const side = drop?.at.side ?? null;
        if ((drop?.el ?? null) !== g.mark || side !== g.markSide) {
          clearMark(g);
          if (drop) {
            drop.el.classList.add(DROP_CLASS[drop.at.side]);
            g.mark = drop.el;
            g.markSide = drop.at.side;
          }
        }
      },
      onPointerUp: (e) => {
        if (gesture.current && e.pointerId === gesture.current.pointerId) finish(true, e.clientX, e.clientY);
      },
      onPointerCancel: (e) => {
        if (gesture.current && e.pointerId === gesture.current.pointerId) finish(false, e.clientX, e.clientY);
      },
      // Capture can vanish mid-gesture (chip disabled or unmounted). End the
      // gesture without dropping so the ghost goes and later drags still work.
      // pointerup fires first and already clears the gesture, so this is then a no-op.
      onLostPointerCapture: (e) => {
        if (gesture.current && e.pointerId === gesture.current.pointerId) finish(false, e.clientX, e.clientY);
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter' && !e.repeat) {
          e.preventDefault();
          onDropRef.current(effect, 'keyboard', null);
        }
      },
    }),
    [finish],
  );

  return { dragging, chipProps };
}
