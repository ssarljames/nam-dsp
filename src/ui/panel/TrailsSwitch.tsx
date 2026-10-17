import { useState } from 'react';

interface TrailsSwitchProps {
  /** The stored setting, read once when the switch mounts. */
  initial: boolean;
  /** Told when it flips; the screen tells the engine and storage. */
  onChange: (on: boolean) => void;
}

/**
 * The reverb's TRAILS switch (spec 2026-10-01-reverb-effect §3.4): on, the
 * tail rings out when the reverb is switched off; off, it stops at once. A
 * small lit toggle under the type switch.
 */
export function TrailsSwitch({ initial, onChange }: TrailsSwitchProps) {
  const [on, setOn] = useState(initial);

  const toggle = () => {
    const next = !on;
    setOn(next);
    onChange(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Trails: let the tail ring out when the reverb is switched off"
      title="Let the tail ring out when the reverb is switched off"
      className={`trails-switch${on ? ' trails-switch--on' : ''}`}
      onClick={toggle}
    >
      <span className="trails-switch__led" aria-hidden="true" />
      TRAILS
    </button>
  );
}
