/**
 * Saved settings: named snapshots of the rack. Everything here is pure — no
 * storage, no React, no engine — so the whole surface can be tested directly.
 * `savedSettingsStore.ts` persists it and `PresetBar` shows it.
 *
 * A snapshot is the slice of `StoredControls` that a player would call "the
 * sound". It never holds the audio devices or whether the app is live, and it
 * holds models and IRs by reference, never as bytes (spec §3).
 */

import type { CoreParamId } from '../audio/params';
import type { PostEffectId } from '../audio/engineMessages';
import {
  DEFAULT_CHORUS,
  DEFAULT_DELAY,
  DEFAULT_DRIVE,
  DEFAULT_EFFECT_ORDER,
  DEFAULT_REVERB,
  DEFAULT_TREMOLO,
  sanitiseControls,
  type StoredChorus,
  type StoredControls,
  type StoredDelay,
  type StoredDrive,
  type StoredNamSlot,
  type StoredReverb,
  type StoredTremolo,
} from './persistence';
import { isUploadId, uploadName } from './uploadStore';

export const MAX_NAME_LENGTH = 40;

export interface SettingsSnapshot {
  params: Partial<Record<CoreParamId, number>>;
  nam: Record<number, StoredNamSlot>;
  cabIr: string | null;
  cabBypassed: boolean;
  gateBypassed: boolean;
  eqBypassed: boolean;
  delay: StoredDelay;
  chorus: StoredChorus;
  drive: StoredDrive;
  reverb: StoredReverb;
  tremolo: StoredTremolo;
  /**
   * Canonical (canonicalEffectOrder): the placed effects in their order, in the
   * places the default order gives them. Where a missing effect sits is not
   * part of the sound.
   */
  effectOrder: PostEffectId[];
}

export interface SavedSetting {
  /** Stable for the life of the preset; names may change, ids do not. */
  id: string;
  name: string;
  settings: SettingsSnapshot;
}

export interface SavedSettingsData {
  version: 1;
  activeId: string | null;
  /** Creation order, which is what next, previous and 1–9 follow. */
  order: string[];
  byId: Record<string, SavedSetting>;
}

export function emptyData(): SavedSettingsData {
  return { version: 1, activeId: null, order: [], byId: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** Ids become object keys; these two can never be safe ones. */
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------- snapshots

/**
 * The order with only the sound left in it: the placed effects keep their
 * relative order, in the positions the default order gives them, and every
 * missing effect keeps its default position. Two orders that run the placed
 * effects the same way come out equal. With one effect placed or none, it is
 * the default order.
 */
export function canonicalEffectOrder(
  order: readonly PostEffectId[],
  placed: { has(effect: PostEffectId): boolean },
): PostEffectId[] {
  const running = order.filter((effect) => placed.has(effect));
  let next = 0;
  return DEFAULT_EFFECT_ORDER.map((effect) => (placed.has(effect) ? running[next++] : effect));
}

/**
 * Reads the sound out of a working state, or out of a stored preset's
 * `settings`. Goes through `sanitiseControls`, so anything untrusted is clamped
 * or dropped exactly as it is when the app starts.
 */
export function captureSettings(raw: unknown): SettingsSnapshot {
  const c = sanitiseControls(raw);
  const nam: Record<number, StoredNamSlot> = {};
  for (const [slot, entry] of Object.entries(c.nam)) {
    // A level is always written out, so a rack whose NAM was never touched and
    // one saved with level 0 do not look different.
    nam[Number(slot)] = { url: entry.url, bypassed: entry.bypassed, level: entry.level ?? 0 };
  }
  return {
    params: { ...c.params },
    nam,
    cabIr: c.cabIr,
    cabBypassed: c.cabBypassed,
    gateBypassed: c.gateBypassed,
    eqBypassed: c.eqBypassed,
    // A delay that is not in the slot carries no values: whatever it was last
    // set to is not part of the sound, and must not make two presets differ.
    delay: c.delay.present ? { ...c.delay } : { ...DEFAULT_DELAY },
    chorus: c.chorus.present ? { ...c.chorus } : { ...DEFAULT_CHORUS },
    drive: c.drive.present ? { ...c.drive } : { ...DEFAULT_DRIVE },
    reverb: c.reverb.present ? { ...c.reverb } : { ...DEFAULT_REVERB },
    tremolo: c.tremolo.present ? { ...c.tremolo } : { ...DEFAULT_TREMOLO },
    effectOrder: canonicalEffectOrder(c.effectOrder, new Set(c.effectOrder.filter((effect) => c[effect].present))),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Deep equality that does not care what order keys were written in. */
export function settingsEqual(a: SettingsSnapshot, b: SettingsSnapshot): boolean {
  return canonical(a) === canonical(b);
}

/** A working state with this preset's sound in it and the current devices kept. */
export function settingsToControls(current: StoredControls, settings: SettingsSnapshot): StoredControls {
  const nam: Record<number, StoredNamSlot> = {};
  for (const [slot, entry] of Object.entries(settings.nam)) nam[Number(slot)] = { ...entry };
  return {
    ...current,
    params: { ...settings.params },
    nam,
    cabIr: settings.cabIr,
    cabBypassed: settings.cabBypassed,
    gateBypassed: settings.gateBypassed,
    eqBypassed: settings.eqBypassed,
    delay: { ...settings.delay },
    chorus: { ...settings.chorus },
    drive: { ...settings.drive },
    reverb: { ...settings.reverb },
    tremolo: { ...settings.tremolo },
    effectOrder: [...settings.effectOrder],
  };
}

// -------------------------------------------------------------------- names

export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim();
}

export function isValidName(raw: string): boolean {
  return cleanName(raw) !== '';
}

/** `desired` cleaned, and suffixed with ` 2`, ` 3`, … until no name in `taken` matches it. */
export function uniqueName(desired: string, taken: readonly string[]): string {
  const base = cleanName(desired);
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export function settingNames(data: SavedSettingsData, exceptId?: string): string[] {
  return data.order.filter((id) => id !== exceptId).map((id) => data.byId[id].name);
}

// --------------------------------------------------------------- operations

/** Appended, and made active: you have just saved it, so you are on it. */
export function addSetting(
  data: SavedSettingsData,
  name: string,
  settings: SettingsSnapshot,
  id: string,
): { data: SavedSettingsData; id: string } {
  const setting: SavedSetting = { id, name: uniqueName(name, settingNames(data)), settings };
  return {
    id,
    data: { ...data, activeId: id, order: [...data.order, id], byId: { ...data.byId, [id]: setting } },
  };
}

export function updateSetting(data: SavedSettingsData, id: string, settings: SettingsSnapshot): SavedSettingsData {
  const existing = data.byId[id];
  if (!existing) return data;
  return { ...data, byId: { ...data.byId, [id]: { ...existing, settings } } };
}

/** An empty name changes nothing. A preset may keep its own name in another case. */
export function renameSetting(data: SavedSettingsData, id: string, name: string): SavedSettingsData {
  const existing = data.byId[id];
  if (!existing || !isValidName(name)) return data;
  const renamed = uniqueName(name, settingNames(data, id));
  return { ...data, byId: { ...data.byId, [id]: { ...existing, name: renamed } } };
}

export function duplicateSetting(
  data: SavedSettingsData,
  id: string,
  newId: string,
): { data: SavedSettingsData; id: string } | null {
  const original = data.byId[id];
  if (!original) return null;
  const copy: SavedSetting = {
    id: newId,
    name: uniqueName(`${original.name} copy`, settingNames(data)),
    settings: captureSettings(original.settings),
  };
  const at = data.order.indexOf(id) + 1;
  const order = [...data.order.slice(0, at), newId, ...data.order.slice(at)];
  return { id: newId, data: { ...data, activeId: newId, order, byId: { ...data.byId, [newId]: copy } } };
}

export function deleteSetting(data: SavedSettingsData, id: string): SavedSettingsData {
  if (!data.byId[id]) return data;
  const byId = { ...data.byId };
  delete byId[id];
  return {
    ...data,
    activeId: data.activeId === id ? null : data.activeId,
    order: data.order.filter((x) => x !== id),
    byId,
  };
}

/** Undoes a delete: back at its old position, active again if it was. */
export function restoreSetting(
  data: SavedSettingsData,
  setting: SavedSetting,
  index: number,
  makeActive: boolean,
): SavedSettingsData {
  const at = Math.max(0, Math.min(index, data.order.length));
  const order = [...data.order.slice(0, at), setting.id, ...data.order.slice(at)];
  return {
    ...data,
    activeId: makeActive ? setting.id : data.activeId,
    order,
    byId: { ...data.byId, [setting.id]: setting },
  };
}

// --------------------------------------------------------------- navigation

/** The next or previous preset, wrapping. With nothing to step from, next is the first and previous the last. */
export function neighbour(data: SavedSettingsData, fromId: string | null, delta: 1 | -1): string | null {
  const n = data.order.length;
  if (n === 0) return null;
  const from = fromId === null ? -1 : data.order.indexOf(fromId);
  if (from === -1) return delta > 0 ? data.order[0] : data.order[n - 1];
  return data.order[(from + delta + n) % n];
}

export function idAtPosition(data: SavedSettingsData, index: number): string | null {
  return index >= 0 && index < data.order.length ? data.order[index] : null;
}

export function positionOf(data: SavedSettingsData, id: string): number {
  return data.order.indexOf(id);
}

// ------------------------------------------------------------------ display

/** "Slo 100" from `upload:Slo 100.nam` or `/models/Slo%20100.nam`. */
export function referenceName(ref: string): string {
  if (isUploadId(ref)) return uploadName(ref);
  const last = ref.split('/').pop() ?? ref;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    /* a malformed escape: show it as it is */
  }
  return name.replace(/\.(nam|wav)$/i, '');
}

/** How each POST effect is named in the list summary. */
const EFFECT_NAMES: Record<PostEffectId, string> = { chorus: 'Chorus', tremolo: 'Tremolo', delay: 'Delay', reverb: 'Reverb' };

/** A one-line description for the list, in chain order: the drive, the model, the IR, then each placed POST effect. */
export function summarise(settings: SettingsSnapshot): string {
  const parts: string[] = [];
  if (settings.drive.present) parts.push('Drive');
  const model = settings.nam[0]?.url;
  if (model) parts.push(referenceName(model));
  if (settings.cabIr) parts.push(referenceName(settings.cabIr));
  for (const effect of settings.effectOrder) {
    if (settings[effect].present) parts.push(EFFECT_NAMES[effect]);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Default sounds';
}

/**
 * Presets that point at an upload which is no longer saved. Bundled urls are
 * not checked here — that would mean a fetch per preset.
 */
export function missingUploadIds(
  data: SavedSettingsData,
  namNames: Iterable<string>,
  irNames: Iterable<string>,
): Set<string> {
  const nam = new Set(namNames);
  const ir = new Set(irNames);
  const missing = new Set<string>();
  for (const id of data.order) {
    const s = data.byId[id].settings;
    const modelGone = Object.values(s.nam).some((e) => e.url !== null && isUploadId(e.url) && !nam.has(uploadName(e.url)));
    const irGone = s.cabIr !== null && isUploadId(s.cabIr) && !ir.has(uploadName(s.cabIr));
    if (modelGone || irGone) missing.add(id);
  }
  return missing;
}

/** The uploads one snapshot names that are no longer saved: models in slot order, then the IR. */
export function missingReferences(
  settings: SettingsSnapshot,
  namNames: Iterable<string>,
  irNames: Iterable<string>,
): string[] {
  const nam = new Set(namNames);
  const ir = new Set(irNames);
  const gone: string[] = [];
  for (const slot of Object.keys(settings.nam).sort()) {
    const url = settings.nam[Number(slot)].url;
    if (url !== null && isUploadId(url) && !nam.has(uploadName(url))) gone.push(uploadName(url));
  }
  const cab = settings.cabIr;
  if (cab !== null && isUploadId(cab) && !ir.has(uploadName(cab))) gone.push(uploadName(cab));
  return gone;
}

// --------------------------------------------------------------------- read

/** Anything found in storage or an import goes through here. It never throws. */
export function sanitiseData(raw: unknown): SavedSettingsData {
  if (!isRecord(raw)) return emptyData();

  const byId: Record<string, SavedSetting> = {};
  if (isRecord(raw.byId)) {
    for (const [id, value] of Object.entries(raw.byId)) {
      if (UNSAFE_IDS.has(id) || !ID_PATTERN.test(id) || !isRecord(value)) continue;
      const name = typeof value.name === 'string' ? cleanName(value.name) : '';
      if (name === '') continue;
      byId[id] = { id, name, settings: captureSettings(value.settings) };
    }
  }

  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id === 'string' && has(byId, id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  if (Array.isArray(raw.order)) raw.order.forEach(add);
  Object.keys(byId).forEach(add); // anything the order forgot goes on the end

  const activeId = typeof raw.activeId === 'string' && has(byId, raw.activeId) ? raw.activeId : null;
  return { version: 1, activeId, order, byId };
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
