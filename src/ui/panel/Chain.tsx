import { Children, useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { panScrollLeft, shouldStartPan } from './panChain';
import type { ChipProps } from './useEffectDrag';
import { EFFECTS, type EffectId, type SlotSide } from './effectDrag';

const CONTROLS = 'button, select, input, textarea, a, .knob, .panel__handle';
const BACKGROUND = '.chain__link, .chain__slot';
/** How long after the last scroll the scrollbar starts fading back. */
const SCROLL_IDLE_MS = 800;

/**
 * The signal chain, laid out left to right and scrolled sideways when it is
 * wider than the page. Alt-drag pans it, as does dragging its empty
 * background. Space is not used: it is the panic mute, and holding it to pan
 * would silence the audio for as long as the pan lasted.
 *
 * Layout only. The panels inside it are the same components wired the same
 * way as before; this decides where they sit, nothing else.
 */
export function Chain({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number } | null>(null);

  // The grab cursor is a hint that Alt-drag is available, so it follows the key.
  useEffect(() => {
    const show = (on: boolean) => ref.current?.classList.toggle('chain--alt', on);
    const down = (e: KeyboardEvent) => e.key === 'Alt' && show(true);
    const up = (e: KeyboardEvent) => e.key === 'Alt' && show(false);
    const blur = () => show(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const target = e.target as Element;
    if (!el) return;
    const start = shouldStartPan({
      altKey: e.altKey,
      // A slot's panels sit inside it; only its own dashed edge is background.
      onBackground: target === el || (target.closest(BACKGROUND) !== null && target.closest('.chain__cell') === null),
      onControl: target.closest(CONTROLS) !== null,
    });
    if (!start) return;
    e.preventDefault();
    pan.current = { x: e.clientX, left: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
    el.classList.add('chain--panning');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !pan.current) return;
    el.scrollLeft = panScrollLeft({
      startLeft: pan.current.left,
      startX: pan.current.x,
      x: e.clientX,
      max: el.scrollWidth - el.clientWidth,
    });
  };

  const endPan = () => {
    pan.current = null;
    ref.current?.classList.remove('chain--panning');
  };

  // The scrollbar is faint at rest and shows fully while the chain scrolls, by
  // wheel, keyboard, bar or pan; it fades again a moment after the last scroll.
  // A class on the element, not React state, so scrolling never re-renders.
  const scrollIdle = useRef<number | undefined>(undefined);
  const onScroll = () => {
    ref.current?.classList.add('chain--scrolling');
    window.clearTimeout(scrollIdle.current);
    scrollIdle.current = window.setTimeout(() => ref.current?.classList.remove('chain--scrolling'), SCROLL_IDLE_MS);
  };
  useEffect(() => () => window.clearTimeout(scrollIdle.current), []);

  return (
    <div
      ref={ref}
      className="chain"
      aria-label="Signal chain"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onScroll={onScroll}
    >
      {children}
    </div>
  );
}

/**
 * One chain member's slot in the row. A fixed size keeps its width — `narrow`
 * for the input and output ends, `snug` for the gate, `amp` for the amp and cab
 * panel, `wide` for the EQ, `effect` for a POST effect. All are fixed, so the
 * chain is only as long as its panels and is centred when the screen is wider.
 * `effect` marks the cell as that effect's drop target for a title drag.
 */
export function ChainCell({
  size,
  effect,
  tour,
  children,
}: {
  size?: 'narrow' | 'snug' | 'amp' | 'wide' | 'effect';
  effect?: EffectId;
  /** The guided tour's name for this cell (see tour/tourSteps.ts). */
  tour?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={size ? `chain__cell chain__cell--${size}` : 'chain__cell'}
      data-effect-panel={effect}
      data-tour={tour}
    >
      {children}
    </div>
  );
}

export function ChainLink() {
  return (
    <div className="chain__link" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path d="M3 8h9M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * Where effects sit — before the amp model (`pre`) or after the cab (`post`).
 * Empty, it is a thin dashed marker; once effects are placed it is a dashed
 * box around their panels, `children`. `armed` is set while a chip that fits
 * is being dragged, and highlights it; PRE takes only Drive, POST takes Chorus
 * and Delay. The drag hook finds slots by `data-slot`, and the panels inside
 * one by `data-effect-panel`, to draw the line where a new effect will land.
 */
export function ChainSlot({
  label,
  side,
  armed,
  children,
}: {
  label: string;
  side: SlotSide;
  armed?: boolean;
  children?: ReactNode;
}) {
  const filled = Children.toArray(children).length > 0;
  const hint = side === 'post' ? 'Drag a POST effect here' : 'Drag Drive here';
  return (
    <div
      className={`chain__slot${filled ? ' chain__slot--filled' : ''}${armed ? ' chain__slot--armed' : ''}`}
      data-slot={side}
      data-tour={`slot-${side}`}
      // Empty, the marker is decoration; filled, it holds real controls.
      aria-hidden={filled ? undefined : 'true'}
      title={filled ? undefined : hint}
    >
      <span className="chain__slot-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

const TRAY: ReadonlyArray<readonly [name: string, side: 'pre' | 'post']> = [
  ['Compressor', 'pre'],
  ['Boost', 'pre'],
  ['Drive', 'pre'],
  ['Delay', 'post'],
  ['Chorus', 'post'],
  ['Reverb', 'post'],
  ['Tremolo', 'post'],
];

/** The tray chips that are real effects, by the name the tray shows. */
const LIVE: Partial<Record<string, EffectId>> = {
  Drive: 'drive',
  Delay: 'delay',
  Chorus: 'chorus',
  Reverb: 'reverb',
  Tremolo: 'tremolo',
};

/**
 * The effects that can be dragged onto the pre and post slots. Drive, Delay,
 * Chorus, Reverb and Tremolo are real; the others are placeholders and say so. While
 * an effect is in the chain its chip shows as in use.
 */
export function EffectsTray({
  inUse,
  dragging,
  chipProps,
}: {
  inUse: ReadonlySet<EffectId>;
  dragging: EffectId | null;
  chipProps: (effect: EffectId, label: string) => ChipProps;
}) {
  const allInUse = EFFECTS.every((effect) => inUse.has(effect));
  return (
    <section className="tray" aria-label="Effects tray" data-tour="tray">
      <span className="tray__legend">EFFECTS TRAY</span>
      <div className="tray__chips">
        {TRAY.map(([name, side]) => {
          const effect = LIVE[name];
          if (effect === undefined) {
            return (
              <span key={name} className="tray__chip" aria-disabled="true" title="Not available yet">
                {name}
                <small>{side}</small>
              </span>
            );
          }
          const used = inUse.has(effect);
          return (
            <button
              key={name}
              type="button"
              className={`tray__chip tray__chip--live${used ? ' tray__chip--used' : ''}${dragging === effect ? ' tray__chip--dragging' : ''}`}
              disabled={used}
              aria-label={used ? `${name}, in use` : `${name}, drag onto the ${side.toUpperCase()} slot, or press Enter to add`}
              {...chipProps(effect, name)}
            >
              {name}
              <small>{side}</small>
            </button>
          );
        })}
      </div>
      <span className="tray__hint">
        {allInUse ? 'The effects are in the chain — remove one with its ✕' : 'Drag an effect onto PRE or POST'}
      </span>
    </section>
  );
}
