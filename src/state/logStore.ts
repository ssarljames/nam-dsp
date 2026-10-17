import { useSyncExternalStore } from 'react';

/**
 * The app's message log. Everything that used to be printed onto the control
 * panel — constraint violations, device errors, hotplug fallbacks, worklet
 * failures — lands here instead, and the terminal drawer is the only thing
 * that renders it.
 *
 * Keeping it out of the panel is not only cosmetic. The panel is the surface
 * someone looks at while playing, and a transient string appearing next to
 * the knobs is both a distraction and a layout shift. A log, by contrast,
 * keeps its history: "the browser did not honour the input constraints" is
 * worth reading ten minutes later, which a message that the next event
 * overwrites never was.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  /** Epoch ms of the most recent occurrence. */
  at: number;
  level: LogLevel;
  text: string;
  /** Consecutive identical entries coalesce into one and count up. */
  count: number;
}

/**
 * Bounded so a device that fails in a loop cannot grow the array without end.
 * The oldest entries go first; the newest are the ones worth keeping, since
 * whatever is wrong now is what someone is reading the log to find.
 */
export const MAX_ENTRIES = 500;

let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function pushLog(level: LogLevel, text: string): void {
  const trimmed = text.trim();
  // Several call sites clear their old state by writing an empty string. That
  // means "nothing to say", which is not an event and does not belong in a log.
  if (trimmed === '') return;

  const last = entries[entries.length - 1];
  if (last && last.level === level && last.text === trimmed) {
    // A device that keeps failing the same way produces the same line over and
    // over; a hundred copies push the useful history off the top. Coalesce
    // consecutive repeats and count them instead.
    entries = [...entries.slice(0, -1), { ...last, at: Date.now(), count: last.count + 1 }];
  } else {
    entries = [...entries, { id: nextId++, at: Date.now(), level, text: trimmed, count: 1 }];
    if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  emit();
}

export const log = {
  info: (text: string) => pushLog('info', text),
  warn: (text: string) => pushLog('warn', text),
  error: (text: string) => pushLog('error', text),
  /**
   * The shape almost every catch block needs. Returns the text it logged so a
   * caller that also wants the string does not have to unwrap the error twice.
   */
  exception(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    pushLog('error', text);
    return text;
  },
};

export const logStore = {
  getSnapshot: (): LogEntry[] => entries,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  clear(): void {
    if (entries.length === 0) return;
    entries = [];
    emit();
  },
};

export function useLogEntries(): LogEntry[] {
  return useSyncExternalStore(logStore.subscribe, logStore.getSnapshot, logStore.getSnapshot);
}
