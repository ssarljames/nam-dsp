import { useSyncExternalStore } from 'react';
import { getControlsSnapshot, subscribeControls, type StoredControls } from './persistence';

/** The working state, re-read whenever anything writes it. */
export function useWorkingControls(): StoredControls {
  return useSyncExternalStore(subscribeControls, getControlsSnapshot);
}
