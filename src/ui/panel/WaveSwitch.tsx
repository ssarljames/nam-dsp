import { TREMOLO_WAVE_NAMES, type TremoloWave } from '../../audio/params';
import { WAVE_ICONS } from './icons';
import { TypeSwitch } from './TypeSwitch';

interface WaveSwitchProps {
  /** The stored wave, read once when the panel mounts. */
  initial: TremoloWave;
  /** Told when the wave changes; the screen tells the engine and storage. */
  onChange: (wave: TremoloWave) => void;
}

/** The tremolo's SINE / TRI / SQUARE / SAW switch, each option a drawn wave. */
export function WaveSwitch({ initial, onChange }: WaveSwitchProps) {
  return (
    <TypeSwitch
      labels={TREMOLO_WAVE_NAMES}
      icons={WAVE_ICONS}
      initial={initial}
      onChange={(value) => onChange(value as TremoloWave)}
      label="Waveform"
    />
  );
}
