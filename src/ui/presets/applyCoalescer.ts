/** How long stepping has to go quiet before a preset is applied to the engine. */
export const APPLY_DELAY_MS = 200;

export interface Coalescer<T> {
  push(value: T): void;
  cancel(): void;
  pending(): boolean;
}

/**
 * Applies only the last value pushed in a burst. A NAM load runs on the audio
 * thread and is heavy, so stepping `]` four times must load one model, not four:
 * the screen follows every step at once, and the engine follows the final one.
 */
export function createCoalescer<T>(apply: (value: T) => void, delayMs: number = APPLY_DELAY_MS): Coalescer<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: T | undefined;
  let waiting = false;

  return {
    push(value) {
      latest = value;
      waiting = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        waiting = false;
        apply(latest as T);
      }, delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      waiting = false;
    },
    pending() {
      return waiting;
    },
  };
}
