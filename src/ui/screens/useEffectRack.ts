import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import {
  applyReverbState,
  writeChorusParams,
  writeDelayParams,
  writeDriveParams,
  writeReverbParams,
  writeTremoloParams,
} from '../../audio/applyControls';
import { type PostEffectId } from '../../audio/engineMessages';
import {
  DRIVE_SLOT,
  DRIVE_TYPE_INDEX,
  REVERB_SLOT,
  REVERB_TYPE_INDEX,
  TREMOLO_SLOT,
  TREMOLO_WAVE_INDEX,
  type ChorusParamId,
  type DelayParamId,
  type DriveParamId,
  type DriveType,
  type ReverbParamId,
  type ReverbType,
  type TremoloParamId,
  type TremoloWave,
} from '../../audio/params';
import {
  DEFAULT_CHORUS,
  DEFAULT_DELAY,
  DEFAULT_DRIVE,
  DEFAULT_EFFECT_ORDER,
  DEFAULT_REVERB,
  DEFAULT_TREMOLO,
  updateChorus,
  updateDelay,
  updateDrive,
  updateEffectOrder,
  updateReverb,
  updateTremolo,
  type StoredChorus,
  type StoredControls,
  type StoredDelay,
  type StoredDrive,
  type StoredReverb,
  type StoredTremolo,
} from '../../state/persistence';
import { EFFECTS, type EffectId } from '../panel/effectDrag';
import { dropBeside, moveBy, placeAt, sameOrder, type DropPoint, type DropSide } from '../panel/effectOrder';
import type { AddVia } from '../panel/useEffectDrag';

/** The effects' records as the screen last wrote them. */
export interface EffectRecords {
  drive: StoredDrive;
  chorus: StoredChorus;
  tremolo: StoredTremolo;
  delay: StoredDelay;
  reverb: StoredReverb;
}

/** What every effect record has: whether it is in the chain, and its power. */
type Placement = Pick<StoredDelay, 'present' | 'bypassed'>;

function withPlacement(records: EffectRecords, effect: EffectId, patch: Partial<Placement>): EffectRecords {
  switch (effect) {
    case 'drive':
      return { ...records, drive: { ...records.drive, ...patch } };
    case 'chorus':
      return { ...records, chorus: { ...records.chorus, ...patch } };
    case 'tremolo':
      return { ...records, tremolo: { ...records.tremolo, ...patch } };
    case 'delay':
      return { ...records, delay: { ...records.delay, ...patch } };
    case 'reverb':
      return { ...records, reverb: { ...records.reverb, ...patch } };
  }
}

function storePlacement(effect: EffectId, patch: Partial<Placement>): void {
  if (effect === 'drive') updateDrive(patch);
  else if (effect === 'chorus') updateChorus(patch);
  else if (effect === 'tremolo') updateTremolo(patch);
  else if (effect === 'reverb') updateReverb(patch);
  else updateDelay(patch);
}

/** Writes an effect's values to its slot, before its stage is switched on. */
function writeParams(engine: AudioEngine, effect: EffectId, records: EffectRecords): void {
  if (effect === 'drive') writeDriveParams(engine, records.drive);
  else if (effect === 'chorus') writeChorusParams(engine, records.chorus);
  else if (effect === 'tremolo') writeTremoloParams(engine, records.tremolo);
  else if (effect === 'reverb') writeReverbParams(engine, records.reverb);
  else writeDelayParams(engine, records.delay);
}

/**
 * Tells the engine an effect's power from its record. Every effect runs while
 * placed and on; the reverb also runs, deaf, while it rings out with trails
 * (spec 2026-10-01-reverb-effect §3.4).
 */
function sendPower(engine: AudioEngine, effect: EffectId, records: EffectRecords): void {
  if (effect === 'reverb') {
    applyReverbState(engine, records.reverb);
    return;
  }
  const record = records[effect];
  engine.setStageEnabled(effect, record.present && !record.bypassed);
}

function placedOf(records: EffectRecords): ReadonlySet<EffectId> {
  return new Set(EFFECTS.filter((effect) => records[effect].present));
}

/** Where focus goes after a keyboard action re-renders the POST area. */
type FocusTarget = 'power' | 'handle';

const FOCUS_SELECTOR: Record<FocusTarget, string> = {
  power: '[role="switch"]',
  handle: '.panel__handle',
};

/**
 * The screen logic every effect shares, written once (spec
 * 2026-09-25-chorus-effect §2, §6; extended for the drive by spec
 * 2026-09-25-drive-effect §4.1): placing, removing, power, knob values and
 * the order, each told to the engine and to storage.
 *
 * Which effects are placed, and their order, are state: the layout changes.
 * The values live in a ref, like the knobs, so a knob release never
 * re-renders the screen.
 */
export function useEffectRack(engineRef: RefObject<AudioEngine | null>) {
  const recordsRef = useRef<EffectRecords>({
    drive: { ...DEFAULT_DRIVE },
    chorus: { ...DEFAULT_CHORUS },
    tremolo: { ...DEFAULT_TREMOLO },
    delay: { ...DEFAULT_DELAY },
    reverb: { ...DEFAULT_REVERB },
  });
  const orderRef = useRef<readonly PostEffectId[]>(DEFAULT_EFFECT_ORDER);
  const [placed, setPlaced] = useState<ReadonlySet<EffectId>>(() => new Set());
  const [order, setOrder] = useState<readonly PostEffectId[]>(DEFAULT_EFFECT_ORDER);
  const focusRef = useRef<{ effect: EffectId; target: FocusTarget } | null>(null);

  // After a render caused by a keyboard action, put focus where the user
  // expects it. A chip added with Enter becomes disabled and a panel moved in
  // the DOM loses focus; either way it would otherwise fall to the page.
  useEffect(() => {
    const request = focusRef.current;
    if (!request) return;
    focusRef.current = null;
    document
      .querySelector<HTMLElement>(`[data-effect-panel="${request.effect}"] ${FOCUS_SELECTOR[request.target]}`)
      ?.focus();
  });

  /** Stores and sends a new order. False, and nothing happens, if it is the same. */
  const applyOrder = useCallback(
    (next: readonly PostEffectId[]): boolean => {
      if (sameOrder(next, orderRef.current)) return false;
      orderRef.current = next;
      updateEffectOrder(next);
      // A real change restarts the effects that moved (spec 2026-10-01-reverb-effect §3.3).
      engineRef.current?.setPostOrder(next);
      setOrder(next);
      return true;
    },
    [engineRef],
  );

  /** Takes a working state (at start, or from a preset). Tells nothing to the engine. */
  const load = useCallback((controls: StoredControls) => {
    recordsRef.current = {
      drive: { ...controls.drive },
      chorus: { ...controls.chorus },
      tremolo: { ...controls.tremolo },
      delay: { ...controls.delay },
      reverb: { ...controls.reverb },
    };
    orderRef.current = [...controls.effectOrder];
    setPlaced(placedOf(recordsRef.current));
    setOrder(orderRef.current);
  }, []);

  // Dropped on its slot, or Enter on the chip: in the chain and powered. A POST
  // effect goes at the gap it was dropped in (`at`), or last when there is
  // none; the drive is alone in PRE. The values
  // are written before the stage is enabled, and enabling resets it, so it
  // starts clean on them.
  const place = useCallback(
    (effect: EffectId, via: AddVia, at: DropPoint | null = null) => {
      if (recordsRef.current[effect].present) return;
      recordsRef.current = withPlacement(recordsRef.current, effect, { present: true, bypassed: false });
      storePlacement(effect, { present: true, bypassed: false });
      const engine = engineRef.current;
      if (engine) {
        writeParams(engine, effect, recordsRef.current);
        sendPower(engine, effect, recordsRef.current);
      }
      if (effect !== 'drive') applyOrder(placeAt(orderRef.current, effect, at));
      if (via === 'keyboard') focusRef.current = { effect, target: 'power' };
      setPlaced(placedOf(recordsRef.current));
    },
    [engineRef, applyOrder],
  );

  // The cross on the panel. The stage is switched off, which cuts its tail
  // (the reverb's too, trails or not); the values (and a POST effect's order)
  // are kept for the next time.
  const remove = useCallback(
    (effect: EffectId) => {
      recordsRef.current = withPlacement(recordsRef.current, effect, { present: false });
      storePlacement(effect, { present: false });
      engineRef.current?.setStageEnabled(effect, false);
      setPlaced(placedOf(recordsRef.current));
    },
    [engineRef],
  );

  const setPower = useCallback(
    (effect: EffectId, on: boolean) => {
      recordsRef.current = withPlacement(recordsRef.current, effect, { bypassed: !on });
      storePlacement(effect, { bypassed: !on });
      const engine = engineRef.current;
      if (engine) sendPower(engine, effect, recordsRef.current);
    },
    [engineRef],
  );

  const commitChorus = useCallback((key: ChorusParamId, value: number) => {
    recordsRef.current = { ...recordsRef.current, chorus: { ...recordsRef.current.chorus, [key]: value } };
    updateChorus({ [key]: value });
  }, []);

  const commitDelay = useCallback((key: DelayParamId, value: number) => {
    recordsRef.current = { ...recordsRef.current, delay: { ...recordsRef.current.delay, [key]: value } };
    updateDelay({ [key]: value });
  }, []);

  const commitDrive = useCallback((key: DriveParamId, value: number) => {
    recordsRef.current = { ...recordsRef.current, drive: { ...recordsRef.current.drive, [key]: value } };
    updateDrive({ [key]: value });
  }, []);

  // The clipping switch has no AudioParam of its own to write, so the type
  // goes to the engine here, then to the record and storage.
  const setDriveType = useCallback(
    (type: DriveType) => {
      const engine = engineRef.current;
      if (engine) engine.slotParam(DRIVE_SLOT, DRIVE_TYPE_INDEX).value = type;
      recordsRef.current = { ...recordsRef.current, drive: { ...recordsRef.current.drive, type } };
      updateDrive({ type });
    },
    [engineRef],
  );

  const commitReverb = useCallback((key: ReverbParamId, value: number) => {
    recordsRef.current = { ...recordsRef.current, reverb: { ...recordsRef.current.reverb, [key]: value } };
    updateReverb({ [key]: value });
  }, []);

  // Like the drive's switch: the type has no AudioParam of its own to write.
  const setReverbType = useCallback(
    (type: ReverbType) => {
      const engine = engineRef.current;
      if (engine) engine.slotParam(REVERB_SLOT, REVERB_TYPE_INDEX).value = type;
      recordsRef.current = { ...recordsRef.current, reverb: { ...recordsRef.current.reverb, type } };
      updateReverb({ type });
    },
    [engineRef],
  );

  const commitTremolo = useCallback((key: TremoloParamId, value: number) => {
    recordsRef.current = { ...recordsRef.current, tremolo: { ...recordsRef.current.tremolo, [key]: value } };
    updateTremolo({ [key]: value });
  }, []);

  // Like the drive's switch: the wave has no AudioParam of its own to write.
  const setTremoloWave = useCallback(
    (wave: TremoloWave) => {
      const engine = engineRef.current;
      if (engine) engine.slotParam(TREMOLO_SLOT, TREMOLO_WAVE_INDEX).value = wave;
      recordsRef.current = { ...recordsRef.current, tremolo: { ...recordsRef.current.tremolo, wave } };
      updateTremolo({ wave });
    },
    [engineRef],
  );

  // Switching trails off while the reverb is off and ringing cuts the tail:
  // the stage goes off with it.
  const setReverbTrails = useCallback(
    (trails: boolean) => {
      recordsRef.current = { ...recordsRef.current, reverb: { ...recordsRef.current.reverb, trails } };
      updateReverb({ trails });
      const engine = engineRef.current;
      if (engine) applyReverbState(engine, recordsRef.current.reverb);
    },
    [engineRef],
  );

  const dropPanel = useCallback(
    (effect: PostEffectId, target: PostEffectId, side: DropSide) => {
      applyOrder(dropBeside(orderRef.current, effect, target, side));
    },
    [applyOrder],
  );

  const step = useCallback(
    (effect: PostEffectId, delta: -1 | 1) => {
      if (applyOrder(moveBy(orderRef.current, placedOf(recordsRef.current), effect, delta))) {
        focusRef.current = { effect, target: 'handle' };
      }
    },
    [applyOrder],
  );

  return {
    placed,
    order,
    records: recordsRef,
    load,
    place,
    remove,
    setPower,
    commitChorus,
    commitDelay,
    commitDrive,
    setDriveType,
    commitReverb,
    setReverbType,
    setReverbTrails,
    commitTremolo,
    setTremoloWave,
    dropPanel,
    step,
  };
}
