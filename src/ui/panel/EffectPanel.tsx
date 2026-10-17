import { useState, type ReactNode } from 'react';
import { BypassSwitch } from './BypassSwitch';
import { Panel } from './Panel';
import type { HandleProps } from './usePanelDrag';

interface EffectPanelProps {
  /** Silkscreened title: CHORUS, DELAY. */
  title: string;
  /** The effect's name in labels: Chorus, Delay. */
  name: string;
  /** The three knobs, already wired to their AudioParams by the screen. */
  knobs: ReactNode;
  /** Restored power state, read once when the panel mounts. */
  initialBypassed: boolean;
  /** Told when the power switch flips; the screen tells the engine and storage. */
  onPowerChange: (on: boolean) => void;
  /** Takes the effect out of the chain and puts its chip back in the tray. */
  onRemove: () => void;
  /** The title's drag and arrow-key handlers, from usePanelDrag. None for an effect that cannot be reordered. */
  handle?: HandleProps;
  /** A row under the knobs: the drive's clipping switch. */
  extra?: ReactNode;
  /** Added to the knob row's class: the reverb's five knobs sit on two rows. */
  knobsClassName?: string;
}

/**
 * An effect's panel, the same shape for every effect: the title is the handle
 * that reorders it (for a POST effect), the power switch bypasses it but
 * keeps it in the chain, and the small cross removes it.
 */
export function EffectPanel({
  title,
  name,
  knobs,
  initialBypassed,
  onPowerChange,
  onRemove,
  handle,
  extra,
  knobsClassName,
}: EffectPanelProps) {
  const [on, setOn] = useState(!initialBypassed);

  const toggle = () => {
    const next = !on;
    setOn(next);
    onPowerChange(next);
  };

  return (
    <Panel
      title={title}
      label={name}
      lit={on}
      titleHandle={
        handle
          ? {
              ...handle,
              role: 'button',
              'aria-label': `Move ${name}. Left and right arrows reorder`,
              title: 'Drag onto the other effect to reorder, or use the left and right arrows',
            }
          : undefined
      }
      titleAction={
        <>
          <button
            type="button"
            className="remove-btn"
            aria-label={`Remove ${name.toLowerCase()}`}
            title={`Remove ${name.toLowerCase()}`}
            onClick={onRemove}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <BypassSwitch bypassed={!on} onToggle={toggle} label={name} />
        </>
      }
    >
      <div className="effect-panel__body">
        <div className={knobsClassName ? `panel__knobs ${knobsClassName}` : 'panel__knobs'}>{knobs}</div>
        {extra}
      </div>
    </Panel>
  );
}
