import type { StoredChorus, StoredControls, StoredDelay, StoredDrive, StoredReverb, StoredTremolo } from '../state/persistence';
import type { PostEffectId, StageId } from './engineMessages';
import {
  CHORUS_PARAM_INDEX,
  CHORUS_SLOT,
  CORE_PARAMS,
  DELAY_PARAM_INDEX,
  DELAY_SLOT,
  DRIVE_PARAM_INDEX,
  DRIVE_SLOT,
  DRIVE_TYPE_INDEX,
  NAM_SLOT_COUNT,
  REVERB_PARAM_INDEX,
  REVERB_SLOT,
  REVERB_TYPE_INDEX,
  TREMOLO_PARAM_INDEX,
  TREMOLO_SLOT,
  TREMOLO_WAVE_INDEX,
  type CoreParamId,
} from './params';

/** The part of `AudioEngine` a working state is pushed through. */
export interface EngineTarget {
  param(id: CoreParamId): { value: number };
  slotParam(slot: number, index: number): { value: number };
  setNamEnabled(slot: number, enabled: boolean): void;
  setStageEnabled(stage: StageId, enabled: boolean): void;
  setPostOrder(order: readonly PostEffectId[]): void;
  setReverbInput(open: boolean): void;
}

/**
 * Writes the delay's three values to its pooled slot. Separate from the stage
 * switch because the screen writes them on their own too: when the delay is
 * dropped into the slot, and once at start.
 */
export function writeDelayParams(engine: Pick<EngineTarget, 'slotParam'>, delay: StoredDelay): void {
  engine.slotParam(DELAY_SLOT, DELAY_PARAM_INDEX.level).value = delay.level;
  engine.slotParam(DELAY_SLOT, DELAY_PARAM_INDEX.time).value = delay.time;
  engine.slotParam(DELAY_SLOT, DELAY_PARAM_INDEX.feedback).value = delay.feedback;
}

/** Writes the chorus's three values to its pooled slot, like writeDelayParams. */
export function writeChorusParams(engine: Pick<EngineTarget, 'slotParam'>, chorus: StoredChorus): void {
  engine.slotParam(CHORUS_SLOT, CHORUS_PARAM_INDEX.level).value = chorus.level;
  engine.slotParam(CHORUS_SLOT, CHORUS_PARAM_INDEX.rate).value = chorus.rate;
  engine.slotParam(CHORUS_SLOT, CHORUS_PARAM_INDEX.depth).value = chorus.depth;
}

/** Writes the drive's four values to its pooled slot, like writeDelayParams. */
export function writeDriveParams(engine: Pick<EngineTarget, 'slotParam'>, drive: StoredDrive): void {
  engine.slotParam(DRIVE_SLOT, DRIVE_PARAM_INDEX.level).value = drive.level;
  engine.slotParam(DRIVE_SLOT, DRIVE_PARAM_INDEX.gain).value = drive.gain;
  engine.slotParam(DRIVE_SLOT, DRIVE_PARAM_INDEX.tone).value = drive.tone;
  engine.slotParam(DRIVE_SLOT, DRIVE_TYPE_INDEX).value = drive.type;
}

/** Writes the reverb's six values to its pooled slot, like writeDelayParams. */
export function writeReverbParams(engine: Pick<EngineTarget, 'slotParam'>, reverb: StoredReverb): void {
  engine.slotParam(REVERB_SLOT, REVERB_PARAM_INDEX.mix).value = reverb.mix;
  engine.slotParam(REVERB_SLOT, REVERB_PARAM_INDEX.decay).value = reverb.decay;
  engine.slotParam(REVERB_SLOT, REVERB_PARAM_INDEX.tone).value = reverb.tone;
  engine.slotParam(REVERB_SLOT, REVERB_PARAM_INDEX.preDelay).value = reverb.preDelay;
  engine.slotParam(REVERB_SLOT, REVERB_PARAM_INDEX.character).value = reverb.character;
  engine.slotParam(REVERB_SLOT, REVERB_TYPE_INDEX).value = reverb.type;
}

/** Writes the tremolo's four values to its pooled slot, like writeDelayParams. */
export function writeTremoloParams(engine: Pick<EngineTarget, 'slotParam'>, tremolo: StoredTremolo): void {
  engine.slotParam(TREMOLO_SLOT, TREMOLO_PARAM_INDEX.level).value = tremolo.level;
  engine.slotParam(TREMOLO_SLOT, TREMOLO_PARAM_INDEX.rate).value = tremolo.rate;
  engine.slotParam(TREMOLO_SLOT, TREMOLO_PARAM_INDEX.depth).value = tremolo.depth;
  engine.slotParam(TREMOLO_SLOT, TREMOLO_WAVE_INDEX).value = tremolo.wave;
}

/**
 * The two facts the engine gets about the reverb (spec
 * 2026-10-01-reverb-effect §3.4): it runs while placed and either powered or
 * ringing out with trails, and it listens only while powered. So switching it
 * off with trails closes its input and lets the tail ring; without trails, or
 * removed, it stops at once.
 */
export function reverbEngineState(reverb: Pick<StoredReverb, 'present' | 'bypassed' | 'trails'>): {
  enabled: boolean;
  inputOpen: boolean;
} {
  return {
    enabled: reverb.present && (!reverb.bypassed || reverb.trails),
    inputOpen: !reverb.bypassed,
  };
}

/**
 * Tells the engine the reverb's state. The input goes first, so a stage that
 * is being switched on resets with its input already right.
 */
export function applyReverbState(
  engine: Pick<EngineTarget, 'setStageEnabled' | 'setReverbInput'>,
  reverb: Pick<StoredReverb, 'present' | 'bypassed' | 'trails'>,
): void {
  const { enabled, inputOpen } = reverbEngineState(reverb);
  engine.setReverbInput(inputOpen);
  engine.setStageEnabled('reverb', enabled);
}

/**
 * The effects: the PRE drive, and the POST effects with their order. Each
 * one's values and its power (placed and not bypassed; the reverb's by
 * reverbEngineState). On its own so the screen can push it at start, beside
 * the other stored stage states.
 */
export function applyEffectsToEngine(
  engine: Pick<EngineTarget, 'slotParam' | 'setStageEnabled' | 'setPostOrder' | 'setReverbInput'>,
  controls: Pick<StoredControls, 'chorus' | 'tremolo' | 'delay' | 'drive' | 'reverb' | 'effectOrder'>,
): void {
  writeDriveParams(engine, controls.drive);
  engine.setStageEnabled('drive', controls.drive.present && !controls.drive.bypassed);
  writeChorusParams(engine, controls.chorus);
  engine.setStageEnabled('chorus', controls.chorus.present && !controls.chorus.bypassed);
  writeTremoloParams(engine, controls.tremolo);
  engine.setStageEnabled('tremolo', controls.tremolo.present && !controls.tremolo.bypassed);
  writeDelayParams(engine, controls.delay);
  engine.setStageEnabled('delay', controls.delay.present && !controls.delay.bypassed);
  writeReverbParams(engine, controls.reverb);
  applyReverbState(engine, controls.reverb);
  engine.setPostOrder(controls.effectOrder);
}

/**
 * Puts a working state onto the running engine: every core parameter (the
 * default for one the state does not name), each NAM stage's level and power,
 * each core stage's power, the PRE drive, and the POST effects with their
 * order.
 *
 * Deliberately not here: models and IRs, which the panels load, and the live
 * state, which applying a preset must never change. There is no call on
 * `EngineTarget` that could.
 */
export function applyControlsToEngine(engine: EngineTarget, controls: StoredControls): void {
  for (const id of Object.keys(CORE_PARAMS) as CoreParamId[]) {
    engine.param(id).value = controls.params[id] ?? CORE_PARAMS[id].default;
  }
  for (let slot = 0; slot < NAM_SLOT_COUNT; slot++) {
    const state = controls.nam[slot];
    engine.slotParam(slot, 0).value = state?.level ?? 0;
    engine.setNamEnabled(slot, state ? !state.bypassed : false);
  }
  engine.setStageEnabled('eq', !controls.eqBypassed);
  engine.setStageEnabled('gate', !controls.gateBypassed);
  engine.setStageEnabled('cab', !controls.cabBypassed);
  applyEffectsToEngine(engine, controls);
}
