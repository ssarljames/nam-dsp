interface LiveSwitchProps {
  live: boolean;
  onToggle: () => void;
}

/**
 * The global live switch: the one control that decides whether anything
 * reaches the output at all. It is deliberately not a per-effect control —
 * each panel added later carries its own bypass switch, and this stays the
 * master.
 *
 * It is also the feedback-safety control (spec §10): the engine starts muted
 * and only an explicit throw of this makes sound, so its state has to be
 * readable at a glance. The lever angle, the LED and the legend colour all
 * carry it, rather than relying on any one of the three.
 */
export function LiveSwitch({ live, onToggle }: LiveSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      aria-label="Live"
      data-tour="live"
      className={`switch${live ? ' switch--on' : ''}`}
      onClick={onToggle}
    >
      <span className="switch__led" aria-hidden="true" />
      <span className="switch__bezel" aria-hidden="true">
        <span className="switch__lever" />
      </span>
      <span className="switch__legend">LIVE</span>
    </button>
  );
}
