import { beforeEach, describe, expect, it } from 'vitest';
import { addSetting, captureSettings, emptyData } from './savedSettings';
import { SAVED_SETTINGS_KEY, readSavedSettings, savedSettingsStore } from './savedSettingsStore';

function installStorage(options: { failWrites?: boolean } = {}): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (options.failWrites) throw new Error('quota');
        store.set(key, String(value));
      },
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

const snap = () => captureSettings({ params: { inputGain: 3 } });

describe('savedSettingsStore', () => {
  beforeEach(() => {
    savedSettingsStore.reset();
  });

  it('starts empty', () => {
    installStorage();
    expect(savedSettingsStore.get()).toEqual(emptyData());
  });

  it('persists what is set and reads it back after a reset', () => {
    const backing = installStorage();
    const { data } = addSetting(emptyData(), 'Clean', snap(), 'a');
    savedSettingsStore.set(data);
    expect(backing.has(SAVED_SETTINGS_KEY)).toBe(true);

    savedSettingsStore.reset();
    expect(savedSettingsStore.get()).toEqual(data);
  });

  it('gives the same object until something is set', () => {
    installStorage();
    const a = savedSettingsStore.get();
    expect(savedSettingsStore.get()).toBe(a);
    savedSettingsStore.set(addSetting(a, 'X', snap(), 'x').data);
    expect(savedSettingsStore.get()).not.toBe(a);
  });

  it('notifies subscribers, and stops after they unsubscribe', () => {
    installStorage();
    let calls = 0;
    const off = savedSettingsStore.subscribe(() => {
      calls += 1;
    });
    savedSettingsStore.set(addSetting(emptyData(), 'A', snap(), 'a').data);
    expect(calls).toBe(1);
    off();
    savedSettingsStore.set(addSetting(emptyData(), 'B', snap(), 'b').data);
    expect(calls).toBe(1);
  });

  it('reads corrupt storage as empty rather than throwing', () => {
    const backing = installStorage();
    backing.set(SAVED_SETTINGS_KEY, '{not json');
    expect(readSavedSettings()).toEqual(emptyData());
  });

  it('keeps working in memory when the browser refuses the write', () => {
    installStorage({ failWrites: true });
    const { data } = addSetting(emptyData(), 'Kept', snap(), 'k');
    expect(() => savedSettingsStore.set(data)).not.toThrow();
    expect(savedSettingsStore.get().byId.k.name).toBe('Kept');
  });
});
