import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  message: string;
  undo: (() => void) | null;
}

/** One short message at a time, with an optional Undo. It clears itself. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((message: string, undo?: () => void) => {
    clearTimeout(timer.current);
    setToast({ message, undo: undo ?? null });
    // Longer when there is something to click.
    timer.current = setTimeout(() => setToast(null), undo ? 6000 : 3500);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show, dismiss };
}
