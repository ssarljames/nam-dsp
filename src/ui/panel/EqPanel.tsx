import { useState, type ReactNode } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { updateControls } from '../../state/persistence';
import { BypassSwitch } from './BypassSwitch';
import { Panel } from './Panel';

interface EqPanelProps {
  /** BASS, MID and TREBLE, already wired to their AudioParams by the screen. */
  bands: ReactNode;
  /** The EQ's engaged LEVEL, wired to its core AudioParam by the screen. */
  level: ReactNode;
  engine: AudioEngine | null;
  /** Restored bypass state, read once at start. */
  initialBypassed: boolean;
}

/**
 * The tone controls — last in the rack and last in the engine's chain, after
 * the amp model, where they shape the finished tone. Bypassed, the whole
 * stage is skipped, so its LEVEL goes with it.
 */
export function EqPanel({ bands, level, engine, initialBypassed }: EqPanelProps) {
  const [on, setOn] = useState(!initialBypassed);

  const toggle = () => {
    const next = !on;
    setOn(next);
    engine?.setStageEnabled('eq', next);
    updateControls({ eqBypassed: !next });
  };

  return (
    <Panel
      title="EQ"
      lit={on}
      titleAction={<BypassSwitch bypassed={!on} onToggle={toggle} label="EQ" />}
    >
      <div className="panel__knobs">
        {bands}
        {level}
      </div>
    </Panel>
  );
}
