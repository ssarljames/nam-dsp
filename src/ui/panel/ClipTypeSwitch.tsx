import { DRIVE_TYPE_LABELS, type DriveType } from '../../audio/params';
import { TypeSwitch } from './TypeSwitch';

interface ClipTypeSwitchProps {
  /** The stored type, read once when the panel mounts. */
  initial: DriveType;
  /** Told when the type changes; the screen tells the engine and storage. */
  onChange: (type: DriveType) => void;
}

/** The drive's SOFT / HARD / ASYM switch. */
export function ClipTypeSwitch({ initial, onChange }: ClipTypeSwitchProps) {
  return (
    <TypeSwitch
      labels={DRIVE_TYPE_LABELS}
      initial={initial}
      onChange={(value) => onChange(value as DriveType)}
      label="Clipping type"
    />
  );
}
