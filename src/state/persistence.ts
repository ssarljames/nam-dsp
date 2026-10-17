/**
 * Restores knob positions and device choices across a page refresh.
 *
 * Deliberately absent: engage state. Spec §7 requires the engine to start
 * muted and pass audio only after an explicit Engage press — a reload is
 * exactly what happens after something has gone wrong, and restoring
 * "engaged" there is how that becomes a feedback loop with headphones on.
 * Do not add `engaged` to StoredControls.
 */

import { POST_EFFECTS, isPostOrder, type PostEffectId } from '../audio/engineMessages';
import {
  CHORUS_PARAMS,
  CORE_PARAMS,
  DELAY_PARAMS,
  DEFAULT_DRIVE_TYPE,
  DEFAULT_REVERB_TYPE,
  DEFAULT_TREMOLO_WAVE,
  DRIVE_PARAMS,
  REVERB_PARAMS,
  SLOT_COUNT,
  TREMOLO_PARAMS,
  levelSpec,
  type CoreParamId,
  type DriveType,
  type ReverbParamId,
  type ReverbType,
  type TremoloParamId,
  type TremoloWave,
} from '../audio/params';

export const STORAGE_KEY = 'nam-pwa.controls.v1';

/**
 * Persistence validates against SLOT_COUNT — the pre-declared slot pool's
 * size — rather than against however many NAM stages the engine currently has
 * (NAM_SLOT_COUNT), so a stored record stays readable when the NAM count grows.
 */
const MAX_NAM_SLOTS = SLOT_COUNT;

/** The range every engaged level shares; stored levels are clamped to it. */
const LEVEL = levelSpec('storedLevel');

export interface StoredNamSlot {
  /**
   * A preset URL, or `upload:<name>` for a file saved in IndexedDB (see
   * uploadStore.ts). Never a `custom:` marker — that was the old in-memory
   * upload, whose bytes were never stored.
   */
  url: string | null;
  bypassed: boolean;
  /**
   * Engaged level in dB. Optional: absent means unity, so a record written
   * before levels existed is still valid.
   */
  level?: number;
}

/**
 * The delay effect: whether it is in the POST slot, its power, and its three
 * values in their own units (percent, milliseconds, percent). The working state
 * keeps the values while the delay is removed, so dropping it in again restores
 * what it was; applying a preset without a delay (or undoing one) replaces them
 * with the defaults.
 */
export interface StoredDelay {
  present: boolean;
  bypassed: boolean;
  level: number;
  time: number;
  feedback: number;
}

/** No delay in the slot, at the spec's default values. */
export const DEFAULT_DELAY: StoredDelay = {
  present: false,
  bypassed: false,
  level: DELAY_PARAMS.level.default,
  time: DELAY_PARAMS.time.default,
  feedback: DELAY_PARAMS.feedback.default,
};

/**
 * The chorus effect, stored like the delay: whether it is in POST, its power,
 * and its three values in their own units (percent, hertz, percent). Kept
 * while it is removed, so dropping it in again restores what it was.
 */
export interface StoredChorus {
  present: boolean;
  bypassed: boolean;
  level: number;
  rate: number;
  depth: number;
}

/** No chorus in POST, at the spec's default values. */
export const DEFAULT_CHORUS: StoredChorus = {
  present: false,
  bypassed: false,
  level: CHORUS_PARAMS.level.default,
  rate: CHORUS_PARAMS.rate.default,
  depth: CHORUS_PARAMS.depth.default,
};

/**
 * The drive effect in PRE, stored like the delay and chorus: whether it is
 * placed, its power, its three knob values in their own units (dB, dB,
 * percent) and its clipping type. Kept while it is removed.
 */
export interface StoredDrive {
  present: boolean;
  bypassed: boolean;
  level: number;
  gain: number;
  tone: number;
  type: DriveType;
}

/** No drive in PRE, at the spec's defaults. */
export const DEFAULT_DRIVE: StoredDrive = {
  present: false,
  bypassed: false,
  level: DRIVE_PARAMS.level.default,
  gain: DRIVE_PARAMS.gain.default,
  tone: DRIVE_PARAMS.tone.default,
  type: DEFAULT_DRIVE_TYPE,
};

/**
 * The reverb in POST, stored like the other effects: whether it is placed, its
 * power, whether its tail rings out when it is switched off (trails), its five
 * knob values in their own units (percent, percent, percent, milliseconds,
 * percent) and its type. Kept while it is removed.
 */
export interface StoredReverb {
  present: boolean;
  bypassed: boolean;
  trails: boolean;
  mix: number;
  decay: number;
  tone: number;
  preDelay: number;
  character: number;
  type: ReverbType;
}

/** No reverb in POST, at the spec's defaults. Trails are on. */
export const DEFAULT_REVERB: StoredReverb = {
  present: false,
  bypassed: false,
  trails: true,
  mix: REVERB_PARAMS.mix.default,
  decay: REVERB_PARAMS.decay.default,
  tone: REVERB_PARAMS.tone.default,
  preDelay: REVERB_PARAMS.preDelay.default,
  character: REVERB_PARAMS.character.default,
  type: DEFAULT_REVERB_TYPE,
};

/**
 * The tremolo in POST, stored like the other effects: whether it is placed, its
 * power, its three knob values in their own units (dB, Hz, percent) and its
 * wave. Kept while it is removed.
 */
export interface StoredTremolo {
  present: boolean;
  bypassed: boolean;
  level: number;
  rate: number;
  depth: number;
  wave: TremoloWave;
}

/** No tremolo in POST, at the spec's defaults. */
export const DEFAULT_TREMOLO: StoredTremolo = {
  present: false,
  bypassed: false,
  level: TREMOLO_PARAMS.level.default,
  rate: TREMOLO_PARAMS.rate.default,
  depth: TREMOLO_PARAMS.depth.default,
  wave: DEFAULT_TREMOLO_WAVE,
};

/**
 * Chorus, tremolo, delay, reverb: modulation before the time effects, so the
 * echoes repeat the chorused, pulsing sound, and the reverb tails the lot.
 */
export const DEFAULT_EFFECT_ORDER: readonly PostEffectId[] = Object.freeze([...POST_EFFECTS]);

export interface StoredControls {
  params: Partial<Record<CoreParamId, number>>;
  inputId: string | null;
  outputId: string | null;
  /** Keyed by chain slot, so several NAM stages persist without a shape change. */
  nam: Record<number, StoredNamSlot>;
  /** The EQ's power button. False — the EQ on — is how it has always run. */
  eqBypassed: boolean;
  /**
   * The noise gate's power button. True — the gate off — by default, as the
   * panel has always started, so nothing stored cannot surprise anyone with
   * a gated signal.
   */
  gateBypassed: boolean;
  /**
   * The cab simulator's power button. True — the cab off — by default, like the
   * gate. The loaded IR itself is not stored: uploaded bytes are not
   * persisted, so after a reload the panel starts with no IR.
   */
  cabBypassed: boolean;
  /**
   * The cab's selected IR: a preset URL or `upload:<name>`, null for none.
   * Restored on start by reading the upload back from IndexedDB.
   */
  cabIr: string | null;
  /**
   * The delay effect (spec 2026-09-25-delay-effect §5). Optional in stored
   * JSON — a record written before it existed reads as no delay — but always
   * present once sanitised.
   */
  delay: StoredDelay;
  /**
   * The chorus effect (spec 2026-09-25-chorus-effect §5). Optional in stored
   * JSON — a record written before it existed reads as no chorus — but always
   * present once sanitised.
   */
  chorus: StoredChorus;
  /**
   * The drive effect in PRE (spec 2026-09-25-drive-effect §5). Optional in
   * stored JSON — a record written before it existed reads as no drive — but
   * always present once sanitised.
   */
  drive: StoredDrive;
  /**
   * The reverb in POST (spec 2026-10-01-reverb-effect §5). Optional in stored
   * JSON — a record written before it existed reads as no reverb — but always
   * present once sanitised.
   */
  reverb: StoredReverb;
  /**
   * The tremolo in POST (spec 2026-10-06-tremolo-effect §5). Optional in stored
   * JSON — a record written before it existed reads as no tremolo — but always
   * present once sanitised.
   */
  tremolo: StoredTremolo;
  /**
   * The POST effects, first to last. Always a permutation of all of them,
   * whether or not they are placed. An order written before the reverb or the
   * tremolo keeps its meaning, with the missing effects after it in default
   * order; anything else reads as the default order.
   */
  effectOrder: PostEffectId[];
}

const EMPTY: StoredControls = {
  params: {},
  inputId: null,
  outputId: null,
  nam: {},
  eqBypassed: false,
  gateBypassed: true,
  cabBypassed: true,
  cabIr: null,
  delay: { ...DEFAULT_DELAY },
  chorus: { ...DEFAULT_CHORUS },
  drive: { ...DEFAULT_DRIVE },
  reverb: { ...DEFAULT_REVERB },
  tremolo: { ...DEFAULT_TREMOLO },
  effectOrder: [...DEFAULT_EFFECT_ORDER],
};

/** A fresh empty record; every nested object and array is new every time. */
function emptyControls(): StoredControls {
  return {
    ...EMPTY,
    params: {},
    nam: {},
    delay: { ...DEFAULT_DELAY },
    chorus: { ...DEFAULT_CHORUS },
    drive: { ...DEFAULT_DRIVE },
    reverb: { ...DEFAULT_REVERB },
    tremolo: { ...DEFAULT_TREMOLO },
    effectOrder: [...DEFAULT_EFFECT_ORDER],
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Pure — no localStorage access, so it is exported for testing on its own.
 * `raw` is whatever JSON.parse handed back from user-editable text, so
 * nothing about its shape is trusted.
 *
 * The clamp matters beyond cosmetics: a hand-edited (or corrupted) NaN
 * reaching a gain target would latch there permanently — both of
 * SmoothedValue's convergence guards compare false against a NaN delta, so
 * the smoothed value never moves again for the life of the engine and only a
 * reload clears it. Validating at this boundary is what keeps a bad storage
 * value from ever reaching an AudioParam.
 */
function sanitiseNam(raw: unknown): Record<number, StoredNamSlot> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const out: Record<number, StoredNamSlot> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const slot = Number(key);
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_NAM_SLOTS) continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;

    const entry = value as Record<string, unknown>;
    const url = sanitiseSelection(entry.url);

    const state: StoredNamSlot = { url, bypassed: typeof entry.bypassed === 'boolean' ? entry.bypassed : true };
    // A level that is not a finite number is dropped rather than defaulted, so
    // the reader applies unity — the same as a record that never had one.
    if (typeof entry.level === 'number' && Number.isFinite(entry.level)) {
      state.level = clamp(entry.level, LEVEL.min, LEVEL.max);
    }
    out[slot] = state;
  }
  return out;
}

/**
 * A stored selection is a preset URL or an `upload:` id; anything else reads as
 * none. A legacy `custom:` id named an uploaded file whose bytes were never
 * stored, so restoring it would show a selection that is not loaded.
 */
function sanitiseSelection(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && !raw.startsWith('custom:') ? raw : null;
}

function sanitiseDelay(raw: unknown): StoredDelay {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_DELAY };
  const record = raw as Record<string, unknown>;
  const value = (key: 'level' | 'time' | 'feedback'): number => {
    const v = record[key];
    const spec = DELAY_PARAMS[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
  };
  return {
    // Only an explicit true places it or bypasses it; anything else is the default.
    present: record.present === true,
    bypassed: record.bypassed === true,
    level: value('level'),
    time: value('time'),
    feedback: value('feedback'),
  };
}

function sanitiseChorus(raw: unknown): StoredChorus {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_CHORUS };
  const record = raw as Record<string, unknown>;
  const value = (key: 'level' | 'rate' | 'depth'): number => {
    const v = record[key];
    const spec = CHORUS_PARAMS[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
  };
  return {
    // Only an explicit true places it or bypasses it; anything else is the default.
    present: record.present === true,
    bypassed: record.bypassed === true,
    level: value('level'),
    rate: value('rate'),
    depth: value('depth'),
  };
}

function sanitiseDriveType(raw: unknown): DriveType {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_DRIVE_TYPE;
  return clamp(Math.round(raw), 0, 2) as DriveType;
}

function sanitiseDrive(raw: unknown): StoredDrive {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_DRIVE };
  const record = raw as Record<string, unknown>;
  const value = (key: 'level' | 'gain' | 'tone'): number => {
    const v = record[key];
    const spec = DRIVE_PARAMS[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
  };
  return {
    // Only an explicit true places it or bypasses it; anything else is the default.
    present: record.present === true,
    bypassed: record.bypassed === true,
    level: value('level'),
    gain: value('gain'),
    tone: value('tone'),
    type: sanitiseDriveType(record.type),
  };
}

function sanitiseReverbType(raw: unknown): ReverbType {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_REVERB_TYPE;
  return clamp(Math.round(raw), 0, 5) as ReverbType;
}

function sanitiseReverb(raw: unknown): StoredReverb {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_REVERB };
  const record = raw as Record<string, unknown>;
  const value = (key: ReverbParamId): number => {
    const v = record[key];
    const spec = REVERB_PARAMS[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
  };
  return {
    // Only an explicit true places it or bypasses it; anything else is the default.
    present: record.present === true,
    bypassed: record.bypassed === true,
    // Only an explicit false turns trails off.
    trails: record.trails !== false,
    mix: value('mix'),
    decay: value('decay'),
    tone: value('tone'),
    preDelay: value('preDelay'),
    character: value('character'),
    type: sanitiseReverbType(record.type),
  };
}

function sanitiseTremoloWave(raw: unknown): TremoloWave {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_TREMOLO_WAVE;
  return clamp(Math.round(raw), 0, 3) as TremoloWave;
}

function sanitiseTremolo(raw: unknown): StoredTremolo {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_TREMOLO };
  const record = raw as Record<string, unknown>;
  const value = (key: TremoloParamId): number => {
    const v = record[key];
    const spec = TREMOLO_PARAMS[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
  };
  return {
    // Only an explicit true places it or bypasses it; anything else is the default.
    present: record.present === true,
    bypassed: record.bypassed === true,
    level: value('level'),
    rate: value('rate'),
    depth: value('depth'),
    wave: sanitiseTremoloWave(record.wave),
  };
}

/**
 * The sets of POST effects earlier versions stored: chorus and delay before
 * the reverb, then those and the reverb before the tremolo.
 */
const EARLIER_EFFECTS: ReadonlyArray<readonly PostEffectId[]> = [
  ['chorus', 'delay'],
  ['chorus', 'delay', 'reverb'],
];

/**
 * Kept when it names every POST effect exactly once. An order written by an
 * earlier version (each effect it knew, once) keeps its order with the effects
 * added since appended in default order. Anything else reads as the default.
 */
function sanitiseEffectOrder(raw: unknown): PostEffectId[] {
  if (isPostOrder(raw)) return raw.slice();
  if (Array.isArray(raw)) {
    const known = EARLIER_EFFECTS.find(
      (effects) => raw.length === effects.length && effects.every((effect) => raw.filter((v) => v === effect).length === 1),
    );
    if (known) {
      const order = raw as PostEffectId[];
      return [...order, ...DEFAULT_EFFECT_ORDER.filter((effect) => !order.includes(effect))];
    }
  }
  return [...DEFAULT_EFFECT_ORDER];
}

export function sanitiseControls(raw: unknown): StoredControls {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyControls();

  const record = raw as Record<string, unknown>;
  const params: Partial<Record<CoreParamId, number>> = {};

  const rawParams =
    typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : {};

  for (const id of Object.keys(CORE_PARAMS) as CoreParamId[]) {
    const value = rawParams[id];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const spec = CORE_PARAMS[id];
      params[id] = clamp(value, spec.min, spec.max);
    }
  }

  const inputId = typeof record.inputId === 'string' && record.inputId.length > 0 ? record.inputId : null;
  const outputId = typeof record.outputId === 'string' && record.outputId.length > 0 ? record.outputId : null;

  return {
    params,
    inputId,
    outputId,
    nam: sanitiseNam(record.nam),
    eqBypassed: record.eqBypassed === true,
    // Only an explicit false engages it; anything else reads as the default.
    gateBypassed: record.gateBypassed !== false,
    // Only an explicit false engages it; anything else reads as the default.
    cabBypassed: record.cabBypassed !== false,
    cabIr: sanitiseSelection(record.cabIr),
    delay: sanitiseDelay(record.delay),
    chorus: sanitiseChorus(record.chorus),
    drive: sanitiseDrive(record.drive),
    reverb: sanitiseReverb(record.reverb),
    tremolo: sanitiseTremolo(record.tremolo),
    effectOrder: sanitiseEffectOrder(record.effectOrder),
  };
}

/**
 * Reads and validates the persisted controls. Never throws — private
 * browsing, disabled storage, or corrupt JSON all fall back to defaults, the
 * same pattern as `src/ui/panel/HeadphonesAdvisory.tsx`.
 */
export function loadControls(): StoredControls {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyControls();
    return sanitiseControls(JSON.parse(raw));
  } catch {
    return emptyControls();
  }
}

const listeners = new Set<() => void>();

/** Called after every write of the working state, from any writer. */
export function subscribeControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Writes synchronously; a storage failure is silently ignored. */
export function saveControls(next: StoredControls): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode, quota exceeded, etc. — the values simply won't survive a reload */
  }
  for (const listener of listeners) listener();
}

let snapshotCache: { raw: string | null; value: StoredControls } | null = null;

/**
 * The working state as one object that stays the same reference until storage
 * changes — what `useSyncExternalStore` needs from a snapshot.
 */
export function getControlsSnapshot(): StoredControls {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (snapshotCache && snapshotCache.raw === raw) return snapshotCache.value;
  const value = loadControls();
  snapshotCache = { raw, value };
  return value;
}

/** Read, merge, write. The only safe way to write when there are two writers. */
export function updateControls(partial: Partial<StoredControls>): void {
  const current = loadControls();
  saveControls({
    ...current,
    ...partial,
    // nam is keyed by slot and each writer owns exactly one slot, so a
    // top-level spread would erase every slot the caller did not mention.
    nam: partial.nam ? { ...current.nam, ...partial.nam } : current.nam,
  });
}

/**
 * Merges into the stored delay record. `updateControls` replaces a whole
 * top-level field, so several writers (the panel's power, the sliders, the
 * slot) must each go through here rather than write a partial record.
 */
export function updateDelay(patch: Partial<StoredDelay>): void {
  updateControls({ delay: { ...loadControls().delay, ...patch } });
}

/** Merges into the stored chorus record, for the same reason as updateDelay. */
export function updateChorus(patch: Partial<StoredChorus>): void {
  updateControls({ chorus: { ...loadControls().chorus, ...patch } });
}

/** Merges into the stored drive record, for the same reason as updateDelay. */
export function updateDrive(patch: Partial<StoredDrive>): void {
  updateControls({ drive: { ...loadControls().drive, ...patch } });
}

/** Merges into the stored reverb record, for the same reason as updateDelay. */
export function updateReverb(patch: Partial<StoredReverb>): void {
  updateControls({ reverb: { ...loadControls().reverb, ...patch } });
}

/** Merges into the stored tremolo record, for the same reason as updateDelay. */
export function updateTremolo(patch: Partial<StoredTremolo>): void {
  updateControls({ tremolo: { ...loadControls().tremolo, ...patch } });
}

/**
 * Stores the order of the POST effects. A copy is written, so the caller's
 * array can change afterwards without reaching storage.
 */
export function updateEffectOrder(order: readonly PostEffectId[]): void {
  updateControls({ effectOrder: [...order] });
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pending: Partial<StoredControls> = {};

/**
 * Coalesces rapid commits (a wheel spin, held arrow key) onto one write per
 * ~250 ms. Partials accumulate, so a knob commit and a NAM change inside the
 * same window both land.
 */
export function updateControlsDebounced(partial: Partial<StoredControls>): void {
  pending = {
    ...pending,
    ...partial,
    // Same per-slot merge as updateControls: two different NAM slots
    // committed inside one debounce window must both survive the flush,
    // not have the second overwrite the first's slot map wholesale.
    nam: partial.nam ? { ...pending.nam, ...partial.nam } : pending.nam,
  };
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    const toWrite = pending;
    pending = {};
    updateControls(toWrite);
  }, 250);
}

/**
 * Drops a debounced write that has not landed. Applying a preset replaces the
 * working state wholesale; a knob commit still waiting in the debounce window
 * would otherwise overwrite it with the old values a quarter of a second later.
 */
export function cancelPendingControls(): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = undefined;
  pending = {};
}
