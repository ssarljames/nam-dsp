/**
 * The preset shortcuts as one pure function, so the whole table is testable
 * and the window listener that calls it stays a few lines long.
 *
 * Deliberately never claimed: Space (the panic mute), plain arrows (the
 * sliders use them), Alt combinations (browser Back and Forward, and Alt-drag
 * pans the chain), and Ctrl+arrows (desktop switching on some systems).
 */

export type PresetAction =
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'jump'; index: number }
  | { type: 'openList' }
  | { type: 'save' }
  | { type: 'saveAs' };

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

export interface ShortcutContext {
  /** Focus is in something you type into (or a select, which type-ahead uses). */
  inTextField: boolean;
  /** A modal dialog is open — the tuner. */
  modalOpen: boolean;
}

export function resolveShortcut(event: ShortcutEvent, context: ShortcutContext): PresetAction | null {
  if (context.modalOpen || event.isComposing || event.repeat) return null;

  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;

  if (mod && !event.altKey) {
    const lower = key.toLowerCase();
    if (lower === 's') return event.shiftKey ? { type: 'saveAs' } : { type: 'save' };
    if (lower === 'k') return { type: 'openList' };
    return null;
  }

  if (context.inTextField || event.altKey || mod) return null;

  if (key === '[') return { type: 'previous' };
  if (key === ']') return { type: 'next' };
  if (key === '/') return { type: 'openList' };
  if (key >= '1' && key <= '9') return { type: 'jump', index: Number(key) - 1 };
  return null;
}

/** Shown in the ⋯ menu's shortcut list. */
export const SHORTCUT_HELP: ReadonlyArray<readonly [keys: string, does: string]> = [
  ['[  ]', 'Previous or next preset'],
  ['1 – 9', 'Jump to that preset'],
  ['/  or  Ctrl K', 'Open the preset list'],
  ['Ctrl S', 'Save'],
  ['Ctrl Shift S', 'Save as new'],
  ['Esc', 'Close the list'],
];
