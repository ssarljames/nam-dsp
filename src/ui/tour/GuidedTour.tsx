import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeTooltip, type Rect } from './placement';
import { TOUR_STEPS } from './tourSteps';
import './tour.css';

const DONE_KEY = 'nam-pwa.tour-done';

/** True once the tour has been finished or skipped in this browser. */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    // Private mode: offering the tour again next time is the harmless failure.
    return false;
  }
}

function markTourSeen(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* private mode — see tourSeen */
  }
}

/** Space between the spotlight's edge and the element it frames. */
const SPOT_PAD = 6;

const findTarget = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/** The indices of the steps whose element is on screen right now. */
function availableSteps(): number[] {
  return TOUR_STEPS.flatMap((step, i) => (findTarget(step.target) ? [i] : []));
}

interface GuidedTourProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The guided tour: the page dims, one control at a time is lit up, and a
 * tooltip beside it explains it, with Back and Next. A native modal <dialog>,
 * so the page underneath cannot be clicked, focus stays in the tooltip, Escape
 * ends it, and the preset shortcuts stand down while it runs. Space is still
 * the panic mute.
 *
 * Finishing or skipping records that the tour has been seen; the screen only
 * opens it by itself when it has not.
 */
export function GuidedTour({ open, onClose }: GuidedTourProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<number[]>([]);
  const [rect, setRect] = useState<Rect | null>(null);

  const close = useCallback(() => {
    markTourSeen();
    onClose();
  }, [onClose]);

  // Open and close the dialog, and start from the first step on screen.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const found = availableSteps();
      if (found.length === 0) {
        close();
        return;
      }
      setSteps(found);
      setIndex(found[0]);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, close]);

  const measure = useCallback(() => {
    const el = findTarget(TOUR_STEPS[index].target);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - SPOT_PAD,
      left: r.left - SPOT_PAD,
      width: r.width + SPOT_PAD * 2,
      height: r.height + SPOT_PAD * 2,
    });
  }, [index]);

  // Each step: bring its element into the middle of the view, then frame it.
  // 'center' rather than 'nearest': the preset bar sticks to the bottom of the
  // window and would cover a panel scrolled only to the edge. Inline, it also
  // scrolls a panel into the middle of the sideways-scrolling chain.
  useLayoutEffect(() => {
    if (!open) return;
    const el = findTarget(TOUR_STEPS[index].target);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
    measure();
    nextRef.current?.focus();
  }, [open, index, measure]);

  // Follow the element while a smooth scroll runs, and on resize. One measure
  // per frame at most.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open, measure]);

  // Place the tooltip once it has rendered at its real size.
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!open || !tooltip || !rect) return;
    const p = placeTooltip(
      rect,
      { width: tooltip.offsetWidth, height: tooltip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    tooltip.style.top = `${p.top}px`;
    tooltip.style.left = `${p.left}px`;
    tooltip.style.setProperty('--arrow', `${p.arrow}px`);
    tooltip.dataset.side = p.side;
  });

  const position = steps.indexOf(index);
  const step = TOUR_STEPS[index];
  const isFirst = position <= 0;
  const isLast = position === steps.length - 1;

  const go = (delta: 1 | -1) => {
    // Recheck what is on screen: a step's element may have come or gone.
    const found = availableSteps();
    setSteps(found);
    const nextIndex = delta > 0 ? found.find((i) => i > index) : [...found].reverse().find((i) => i < index);
    if (nextIndex === undefined) {
      if (delta > 0) close();
      return;
    }
    setIndex(nextIndex);
  };

  return (
    <dialog
      ref={dialogRef}
      className="tour"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      // Escape, like Skip, ends the tour and counts as seen.
      onClose={close}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          go(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      {open && (
        <>
          <div
            className="tour__spot"
            aria-hidden="true"
            style={
              rect
                ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
                : { top: '50%', left: '50%', width: 0, height: 0 }
            }
          />
          <div ref={tooltipRef} className="tour__tip" role="document">
            <div className="tour__meta">
              <span className="tour__count">
                {position + 1} of {steps.length}
              </span>
              <button type="button" className="tour__skip" onClick={close}>
                Skip tour
              </button>
            </div>
            <h2 id="tour-title" className="tour__title">
              {step.title}
            </h2>
            <p id="tour-body" className="tour__body">
              {step.body}
            </p>
            <div className="tour__nav">
              <button type="button" className="tour__btn" disabled={isFirst} onClick={() => go(-1)}>
                ‹ Back
              </button>
              <button
                ref={nextRef}
                type="button"
                className="tour__btn tour__btn--next"
                onClick={() => (isLast ? close() : go(1))}
              >
                {isLast ? 'Finish' : 'Next ›'}
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
