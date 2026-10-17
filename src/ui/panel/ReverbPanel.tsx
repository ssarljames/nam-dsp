import { useCallback, useState } from 'react';
import {
  REVERB_CHARACTER_SPECS,
  REVERB_PARAMS,
  REVERB_PARAM_INDEX,
  REVERB_SLOT,
  REVERB_TYPE_LABELS,
  formatReverbDecay,
  type ReverbParamId,
  type ReverbType,
} from '../../audio/params';
import type { StoredReverb } from '../../state/persistence';
import { Knob } from '../Knob/Knob';
import { EffectPanel } from './EffectPanel';
import { TrailsSwitch } from './TrailsSwitch';
import { TypeSwitch } from './TypeSwitch';
import type { HandleProps } from './usePanelDrag';

interface ReverbPanelProps {
  /** The reverb's slot AudioParam for a param index, or null before the engine exists. */
  slotParam: (index: number) => AudioParam | null;
  /** The stored record, read once when the panel mounts. */
  initial: StoredReverb;
  /** A knob was released: the screen stores the value. */
  onCommit: (key: ReverbParamId, value: number) => void;
  /** The type switch moved: the screen tells the engine and storage. */
  onTypeChange: (type: ReverbType) => void;
  /** TRAILS flipped: the screen tells the engine and storage. */
  onTrailsChange: (on: boolean) => void;
  onPowerChange: (on: boolean) => void;
  onRemove: () => void;
  handle: HandleProps;
}

/**
 * The REVERB panel (spec 2026-10-01-reverb-effect §4.3): MIX, DECAY and TONE,
 * then PRE-DELAY and the type's own knob, a 2x3 type switch and TRAILS. The
 * type is the one piece of state here: it relabels the fifth knob and turns
 * DECAY's readout into that type's seconds, so choosing one re-renders this
 * panel. Turning a knob never does.
 */
export function ReverbPanel({
  slotParam,
  initial,
  onCommit,
  onTypeChange,
  onTrailsChange,
  onPowerChange,
  onRemove,
  handle,
}: ReverbPanelProps) {
  const [type, setType] = useState<ReverbType>(initial.type);
  const formatDecay = useCallback((percent: number) => formatReverbDecay(type, percent), [type]);

  const knob = (key: ReverbParamId) => (
    <Knob
      key={key}
      spec={key === 'character' ? REVERB_CHARACTER_SPECS[type] : REVERB_PARAMS[key]}
      param={slotParam(REVERB_PARAM_INDEX[key])}
      initialValue={initial[key]}
      onCommit={(value) => onCommit(key, value)}
      size={56}
      {...(key === 'decay' ? { format: formatDecay } : {})}
    />
  );

  return (
    <EffectPanel
      title="REVERB"
      name="Reverb"
      knobs={
        <>
          {knob('mix')}
          {knob('decay')}
          {knob('tone')}
          {knob('preDelay')}
          {knob('character')}
        </>
      }
      knobsClassName="panel__knobs--rows"
      extra={
        <div className="reverb-panel__switches">
          <TypeSwitch
            labels={REVERB_TYPE_LABELS}
            initial={initial.type}
            onChange={(value) => {
              setType(value as ReverbType);
              onTypeChange(value as ReverbType);
            }}
            label="Reverb type"
            columns={3}
          />
          <TrailsSwitch initial={initial.trails} onChange={onTrailsChange} />
        </div>
      }
      initialBypassed={initial.bypassed}
      onPowerChange={onPowerChange}
      onRemove={onRemove}
      handle={handle}
    />
  );
}

/** The reverb's slot AudioParams, by param index. */
export function reverbSlotParam(engine: { slotParam(slot: number, index: number): AudioParam } | null) {
  return (index: number) => (engine ? engine.slotParam(REVERB_SLOT, index) : null);
}
