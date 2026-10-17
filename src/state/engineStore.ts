import { useSyncExternalStore } from 'react';
import type { DeviceInfoLike } from '../audio/deviceSelection';

export interface EngineState {
  phase: 'idle' | 'requesting' | 'ready' | 'error';
  devices: { inputs: DeviceInfoLike[]; outputs: DeviceInfoLike[] };
  inputId: string | null;
  outputId: string | null;
  engaged: boolean;
  latencyMs: number;
  /**
   * A capability of this browser that will not change for the life of the
   * session, such as output routing being unavailable outside Chromium. It is
   * logged once like anything else, but it also stays here because it explains
   * why a control is disabled — that belongs on the control, as its tooltip,
   * not only in a log someone may never open.
   */
  outputNotice: string;
  outputSelectable: boolean;
}

const initial: EngineState = {
  phase: 'idle',
  devices: { inputs: [], outputs: [] },
  inputId: null,
  outputId: null,
  engaged: false,
  latencyMs: 0,
  outputNotice: '',
  outputSelectable: false,
};

let state: EngineState = initial;
const listeners = new Set<() => void>();

export const engineStore = {
  getSnapshot: (): EngineState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setState(partial: Partial<EngineState>): void {
    state = { ...state, ...partial };
    for (const listener of listeners) listener();
  },
};

export function useEngineState(): EngineState {
  return useSyncExternalStore(engineStore.subscribe, engineStore.getSnapshot, engineStore.getSnapshot);
}
