import { useState, type ReactNode } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { updateControls } from '../../state/persistence';
import { BypassSwitch } from './BypassSwitch';
import { Panel } from './Panel';

interface GatePanelProps {
  /**
   * The input meter. It lives here rather than beside the input device because
   * a gate's threshold is set by watching the input level — without the meter
   * next to it, THRESHOLD is guesswork.
   */
  meter: ReactNode;
  /** THRESHOLD, already wired to its core AudioParam by the screen. */
  threshold: ReactNode;
  engine: AudioEngine | null;
  /** Restored bypass state, read once at start. */
  initialBypassed: boolean;
}

/**
 * The fixed noise gate — first in the engine's chain, ahead of input gain, so
 * THRESHOLD reads in the same units as the meter beside it. One knob by design:
 * its dynamics are fixed, and a full gate with those as knobs is a separate
 * movable effect.
 */
export function GatePanel({ meter, threshold, engine, initialBypassed }: GatePanelProps) {
  const [on, setOn] = useState(!initialBypassed);

  const toggle = () => {
    const next = !on;
    setOn(next);
    engine?.setStageEnabled('gate', next);
    updateControls({ gateBypassed: !next });
  };

  return (
    <Panel
      title="NOISE GATE"
      className="panel--narrow"
      lit={on}
      titleAction={<BypassSwitch bypassed={!on} onToggle={toggle} label="Noise gate" />}
    >
      <div className="gate">
        <div className="gate__knobs">{threshold}</div>
        {meter}
      </div>
    </Panel>
  );
}
