import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { PostEffectId } from '../../audio/engineMessages';
import { exceedsDragThreshold } from './effectDrag';
import { arrowDelta, dropSide, validDropTarget, type DropSide } from './effectOrder';
import { makeDragGhost } from './useEffectDrag';

/**
 * The handlers to spread on a placed effect's title (see Panel's `titleHandle`).
 * Only the press and the keys are element handlers: once a press starts, the
 * rest of the gesture is driven from `window`, so it still ends if the title
 * is removed from the DOM mid-drag (React handlers on a detached node never run).
 */
export interface HandleProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

interface Gesture {
  effect: PostEffectId;
  label: string;
  handle: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
  overSide: DropSide | null;
  detach: () => void;
}

const DROP_CLASS: Record<DropSide, string> = {
  before: 'chain__cell--drop-before',
  after: 'chain__cell--drop-after',
};

/** Where a release at (x, y) would put `dragged`: the other panel's cell, and which side of it. */
function dropAt(
  dragged: PostEffectId,
  x: number,
  y: number,
): { el: HTMLElement; target: PostEffectId; side: DropSide } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-effect-panel]') ?? null;
  const hovered = el?.dataset.effectPanel;
  const target = validDropTarget(dragged, hovered === 'chorus' || hovered === 'delay' ? hovered : null);
  if (!el || target === null) return null;
  return { el, target, side: dropSide(x, el.getBoundingClientRect()) };
}

function clearMark(el: HTMLElement | null): void {
  el?.classList.remove(DROP_CLASS.before, DROP_CLASS.after);
}

/**
 * Drag a placed effect by its title onto the other placed effect to change the
 * order: release on its left half to go before it, on its right half to go
 * after it, anywhere else to change nothing. Pointer events, so it works with
 * a mouse and on touch. ← and → on the focused title move it one place.
 *
 * Nothing here is React state: a drag never re-renders anything. The ghost and
 * the target's highlight are DOM nodes and classes, and the screen re-renders
 * once, when `onDrop` or `onStep` changes the order.
 */
export function usePanelDrag({
  onDrop,
  onStep,
}: {
  onDrop: (effect: PostEffectId, target: PostEffectId, side: DropSide) => void;
  onStep: (effect: PostEffectId, delta: -1 | 1) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const finish = useCallback((drop: boolean, x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    g.detach();
    g.ghost?.remove();
    clearMark(g.over);
    if (!g.started || !drop) return;
    const hit = dropAt(g.effect, x, y);
    if (hit) onDropRef.current(g.effect, hit.target, hit.side);
  }, []);

  // A drag in progress when the screen goes away must not leave a ghost behind.
  useEffect(() => () => finish(false, 0, 0), [finish]);

  const handleProps = useCallback(
    (effect: PostEffectId, label: string): HandleProps => ({
      onPointerDown: (e) => {
        if (e.button !== 0 || gesture.current) return;
        const handle = e.currentTarget;
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {
          // Proceed without capture; pointerup still ends the gesture.
        }

        const mine = (ev: globalThis.PointerEvent) => gesture.current?.pointerId === ev.pointerId;
        const onMove = (ev: globalThis.PointerEvent) => {
          const g = gesture.current;
          if (!g || !mine(ev)) return;
          // The title was removed mid-drag (a preset load, or its panel closed).
          if (!g.handle.isConnected) return finish(false, ev.clientX, ev.clientY);
          if (!g.started) {
            if (!exceedsDragThreshold(ev.clientX - g.startX, ev.clientY - g.startY)) return;
            g.started = true;
            g.ghost = makeDragGhost(g.label);
          }
          if (g.ghost) g.ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;

          const hit = dropAt(g.effect, ev.clientX, ev.clientY);
          const el = hit?.el ?? null;
          const side = hit?.side ?? null;
          if (el !== g.over || side !== g.overSide) {
            clearMark(g.over);
            if (hit) hit.el.classList.add(DROP_CLASS[hit.side]);
            g.over = el;
            g.overSide = side;
          }
        };
        const onUp = (ev: globalThis.PointerEvent) => {
          if (mine(ev)) finish(true, ev.clientX, ev.clientY);
        };
        // Cancel and lost capture end the gesture without dropping.
        const onEnd = (ev: globalThis.PointerEvent) => {
          if (mine(ev)) finish(false, ev.clientX, ev.clientY);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onEnd);
        window.addEventListener('lostpointercapture', onEnd, true);

        gesture.current = {
          effect,
          label,
          handle,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          started: false,
          ghost: null,
          over: null,
          overSide: null,
          detach: () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onEnd);
            window.removeEventListener('lostpointercapture', onEnd, true);
          },
        };
      },
      onKeyDown: (e) => {
        if (gesture.current) return;
        const delta = arrowDelta(e);
        if (delta === null) return;
        e.preventDefault();
        onStepRef.current(effect, delta);
      },
    }),
    [finish],
  );

  return { handleProps };
}
