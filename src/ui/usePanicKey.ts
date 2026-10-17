import { useEffect } from 'react';

/**
 * Spacebar cuts the audio from any focus state. Registered on window with
 * capture so a focused button cannot swallow it first.
 */
export function usePanicKey(onPanic: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onPanic();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [onPanic]);
}
