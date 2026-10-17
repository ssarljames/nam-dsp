import { useEffect } from 'react';
import { resolveShortcut, type PresetAction } from './presetShortcuts';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * Something you type into. A select counts, because its type-ahead uses the same
 * keys; a slider does not, since none of these keys mean anything to it.
 */
function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}

/**
 * One window listener for the preset shortcuts, beside the panic key. The
 * decisions are all in `resolveShortcut`; this only reads the page.
 */
export function usePresetShortcuts(onAction: (action: PresetAction) => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, {
        inTextField: isTextField(event.target),
        modalOpen: document.querySelector('dialog[open]') !== null,
      });
      if (!action) return;
      // Ctrl+S would otherwise open the browser's Save page.
      event.preventDefault();
      onAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAction]);
}
