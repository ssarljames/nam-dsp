import { useSyncExternalStore } from 'react';
import { log } from './logStore';
import { emptyData, sanitiseData, type SavedSettingsData } from './savedSettings';

export const SAVED_SETTINGS_KEY = 'nam-pwa.saved-settings.v1';

/** Never throws: corrupt or unavailable storage reads as "no presets". */
export function readSavedSettings(): SavedSettingsData {
  try {
    const raw = localStorage.getItem(SAVED_SETTINGS_KEY);
    return raw === null ? emptyData() : sanitiseData(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

let current: SavedSettingsData | null = null;
let warned = false;
const listeners = new Set<() => void>();

function write(data: SavedSettingsData): void {
  try {
    localStorage.setItem(SAVED_SETTINGS_KEY, JSON.stringify(data));
  } catch {
    // Private mode or a full quota. Say so once; the presets keep working for
    // this session from memory.
    if (!warned) {
      warned = true;
      log.warn('Presets could not be saved in this browser, so they will last only until you close the page.');
    }
  }
}

/**
 * One in-memory copy, persisted on every change. `get()` returns the same
 * object until `set()` is called, which is what `useSyncExternalStore` needs.
 */
export const savedSettingsStore = {
  get(): SavedSettingsData {
    if (current === null) current = readSavedSettings();
    return current;
  },
  set(next: SavedSettingsData): void {
    current = next;
    write(next);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** Forgets the in-memory copy so the next `get()` reads storage again. For tests. */
  reset(): void {
    current = null;
    warned = false;
  },
};

export function useSavedSettings(): SavedSettingsData {
  return useSyncExternalStore(savedSettingsStore.subscribe, savedSettingsStore.get);
}
