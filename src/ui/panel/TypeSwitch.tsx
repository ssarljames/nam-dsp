import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

interface TypeSwitchProps {
  /**
   * The legends, in value order: option i selects value i. With `icons`, they
   * are the options' accessible names and tooltips instead.
   */
  labels: readonly string[];
  /** Drawn in place of the legends, in value order: the tremolo's waves. */
  icons?: readonly ReactNode[];
  /** The stored value, read once when the switch mounts. */
  initial: number;
  /** Told when the value changes; the screen tells the engine and storage. */
  onChange: (value: number) => void;
  /** The group's accessible name: "Clipping type", "Reverb type". */
  label: string;
  /** Lays the options out as a grid this many wide, rather than one row. */
  columns?: number;
}

/**
 * A segmented switch: one lit option among a few, for an effect's type (the
 * drive's clipping, the reverb's room, the tremolo's wave). A radio group, so it is one tab stop
 * and ← → (or ↑ ↓) move the selection, wrapping. Choosing re-renders only
 * this switch, never the chain.
 */
export function TypeSwitch({ labels, icons, initial, onChange, label, columns }: TypeSwitchProps) {
  const [value, setValue] = useState(initial);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (next: number, focus: boolean) => {
    if (focus) buttons.current[next]?.focus();
    if (next === value) return;
    setValue(next);
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const count = labels.length;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (value + 1) % count;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (value + count - 1) % count;
    else return;
    e.preventDefault();
    select(next, true);
  };

  return (
    <div
      className={`type-switch${columns ? ' type-switch--grid' : ''}${icons ? ' type-switch--icons' : ''}`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {labels.map((legend, i) => (
        <button
          key={legend + i}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === i}
          tabIndex={value === i ? 0 : -1}
          className={`type-switch__option${value === i ? ' type-switch__option--on' : ''}`}
          onClick={() => select(i, false)}
          {...(icons ? { 'aria-label': legend, title: legend } : {})}
        >
          {icons ? icons[i] : legend}
        </button>
      ))}
    </div>
  );
}
