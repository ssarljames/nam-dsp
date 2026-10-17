interface BypassSwitchProps {
  bypassed: boolean;
  onToggle: () => void;
  /**
   * What this switch turns on, for its accessible name ("Noise gate", "EQ").
   * Every rack panel carries one of these, and a row of identical "Bypass"
   * buttons is indistinguishable to a screen reader.
   */
  label?: string;
}

/**
 * The per-panel bypass switch `LiveSwitch` promises every later panel will
 * carry — sits in the panel's title row (see `Panel`'s `titleAction`), so it
 * reads as a per-panel power state rather than a knob among knobs. Kept
 * separate from `LiveSwitch` because that one is the feedback-safety master
 * control with its own semantics; this is the plain per-effect toggle.
 */
export function BypassSwitch({ bypassed, onToggle, label }: BypassSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!bypassed}
      aria-label={label ?? 'Bypass'}
      className={`bypass-btn${!bypassed ? ' bypass-btn--on' : ''}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M7 5.5a8 8 0 1 0 10 0"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
