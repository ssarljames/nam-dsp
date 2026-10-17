import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE_PARAMS } from '../audio/params';
import {
  cancelPendingControls,
  getControlsSnapshot,
  loadControls,
  sanitiseControls,
  saveControls,
  subscribeControls,
  updateControls,
  updateControlsDebounced,
  STORAGE_KEY,
  DEFAULT_DELAY,
  updateDelay,
  DEFAULT_CHORUS,
  DEFAULT_EFFECT_ORDER,
  updateChorus,
  updateEffectOrder,
  DEFAULT_DRIVE,
  updateDrive,
  DEFAULT_REVERB,
  updateReverb,
  DEFAULT_TREMOLO,
  updateTremolo,
} from './persistence';

describe('sanitiseControls', () => {
  it('round-trips a fully valid payload', () => {
    const raw = {
      params: { inputGain: 6, bass: 0, mid: -3, treble: 2, outputVolume: -6 },
      inputId: 'device-in-1',
      outputId: 'device-out-1',
      nam: { 0: { url: 'https://example.com/a.nam', bypassed: false } },
      eqBypassed: false,
      gateBypassed: false,
      cabBypassed: false,
      cabIr: 'upload:cab.wav',
    };

    expect(sanitiseControls(raw)).toEqual({
      ...raw,
      delay: DEFAULT_DELAY,
      chorus: DEFAULT_CHORUS,
      drive: DEFAULT_DRIVE,
      reverb: DEFAULT_REVERB,
      tremolo: DEFAULT_TREMOLO,
      effectOrder: DEFAULT_EFFECT_ORDER,
    });
  });

  it('drops a NaN parameter value', () => {
    const result = sanitiseControls({ params: { inputGain: Number.NaN } });
    expect(result.params.inputGain).toBeUndefined();
  });

  it('clamps a value above max to max', () => {
    const spec = CORE_PARAMS.inputGain;
    const result = sanitiseControls({ params: { inputGain: spec.max + 100 } });
    expect(result.params.inputGain).toBe(spec.max);
  });

  it('clamps a value below min to min', () => {
    const spec = CORE_PARAMS.inputGain;
    const result = sanitiseControls({ params: { inputGain: spec.min - 100 } });
    expect(result.params.inputGain).toBe(spec.min);
  });

  it('drops an unknown parameter id', () => {
    const result = sanitiseControls({ params: { notARealParam: 5 } });
    expect(result.params).toEqual({});
  });

  it('falls back inputId to null when it is not a string', () => {
    expect(sanitiseControls({ inputId: 42 }).inputId).toBeNull();
    expect(sanitiseControls({ inputId: ['device-1'] }).inputId).toBeNull();
  });

  it('yields empty defaults for null raw input', () => {
    expect(sanitiseControls(null)).toEqual({ params: {}, inputId: null, outputId: null, nam: {}, eqBypassed: false, gateBypassed: true, cabBypassed: true, cabIr: null, delay: DEFAULT_DELAY, chorus: DEFAULT_CHORUS, drive: DEFAULT_DRIVE, reverb: DEFAULT_REVERB, tremolo: DEFAULT_TREMOLO, effectOrder: DEFAULT_EFFECT_ORDER });
  });

  it('yields empty defaults for a string raw input', () => {
    expect(sanitiseControls('not an object')).toEqual({ params: {}, inputId: null, outputId: null, nam: {}, eqBypassed: false, gateBypassed: true, cabBypassed: true, cabIr: null, delay: DEFAULT_DELAY, chorus: DEFAULT_CHORUS, drive: DEFAULT_DRIVE, reverb: DEFAULT_REVERB, tremolo: DEFAULT_TREMOLO, effectOrder: DEFAULT_EFFECT_ORDER });
  });

  it('yields empty defaults for an array raw input', () => {
    expect(sanitiseControls([1, 2, 3])).toEqual({ params: {}, inputId: null, outputId: null, nam: {}, eqBypassed: false, gateBypassed: true, cabBypassed: true, cabIr: null, delay: DEFAULT_DELAY, chorus: DEFAULT_CHORUS, drive: DEFAULT_DRIVE, reverb: DEFAULT_REVERB, tremolo: DEFAULT_TREMOLO, effectOrder: DEFAULT_EFFECT_ORDER });
  });
});

describe('sanitiseControls — nam slots', () => {
  it('defaults nam to an empty record when absent', () => {
    expect(sanitiseControls({ params: {} }).nam).toEqual({});
  });

  it('drops a nam field that is not an object', () => {
    expect(sanitiseControls({ nam: 'nope' }).nam).toEqual({});
    expect(sanitiseControls({ nam: [1, 2] }).nam).toEqual({});
  });

  it('drops a slot key that is not a non-negative integer in range', () => {
    const result = sanitiseControls({
      nam: {
        '-1': { url: null, bypassed: true },
        '1.5': { url: null, bypassed: true },
        '8': { url: null, bypassed: true },
        notANumber: { url: null, bypassed: true },
      },
    });
    expect(result.nam).toEqual({});
  });

  it('defaults bypassed to true when it is not a boolean', () => {
    const result = sanitiseControls({ nam: { 0: { url: null, bypassed: 'yes' } } });
    expect(result.nam[0]).toEqual({ url: null, bypassed: true });
  });

  it('drops a custom: url because its bytes were never stored', () => {
    const result = sanitiseControls({
      nam: { 0: { url: 'custom:my-model.nam', bypassed: false } },
    });
    expect(result.nam[0]).toEqual({ url: null, bypassed: false });
  });

  it('keeps an upload: url, because its bytes are stored', () => {
    const result = sanitiseControls({
      nam: { 0: { url: 'upload:my-model.nam', bypassed: false } },
    });
    expect(result.nam[0]).toEqual({ url: 'upload:my-model.nam', bypassed: false });
  });

  it('drops a url that is not a string', () => {
    const result = sanitiseControls({ nam: { 0: { url: 42, bypassed: false } } });
    expect(result.nam[0]).toEqual({ url: null, bypassed: false });
  });
});

// vite.config.ts runs Vitest with `environment: 'node'`, which has no
// localStorage. These tests are about merge semantics, not about the browser
// API, so stub the four methods persistence.ts actually calls rather than
// pulling the whole suite into jsdom.
function installStorageStub(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
}

describe('updateControls', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('writes a partial without clobbering sibling fields', () => {
    updateControls({ params: { inputGain: 3 }, inputId: 'in-1' });
    updateControls({ nam: { 0: { url: 'https://example.com/a.nam', bypassed: false } } });

    const stored = loadControls();
    expect(stored.params.inputGain).toBe(3);
    expect(stored.inputId).toBe('in-1');
    expect(stored.nam[0]).toEqual({ url: 'https://example.com/a.nam', bypassed: false });
  });

  it('overwrites only the keys present in the partial', () => {
    updateControls({ inputId: 'in-1', outputId: 'out-1' });
    updateControls({ inputId: 'in-2' });

    const stored = loadControls();
    expect(stored.inputId).toBe('in-2');
    expect(stored.outputId).toBe('out-1');
  });

  it('sanitises on the way back out, so a bad stored record cannot resurface', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ params: { inputGain: 'loud' }, nam: 7 }));
    updateControls({ inputId: 'in-1' });

    const stored = loadControls();
    expect(stored.params.inputGain).toBeUndefined();
    expect(stored.nam).toEqual({});
    expect(stored.inputId).toBe('in-1');
  });

  it('merges independent nam slots instead of one write replacing the other', () => {
    updateControls({ nam: { 0: { url: 'https://example.com/a.nam', bypassed: false } } });
    updateControls({ nam: { 1: { url: 'https://example.com/b.nam', bypassed: true } } });

    const stored = loadControls();
    expect(stored.nam[0]).toEqual({ url: 'https://example.com/a.nam', bypassed: false });
    expect(stored.nam[1]).toEqual({ url: 'https://example.com/b.nam', bypassed: true });
  });

  it('rewriting one slot replaces that slot but leaves the other intact', () => {
    updateControls({ nam: { 0: { url: 'https://example.com/a.nam', bypassed: false } } });
    updateControls({ nam: { 1: { url: 'https://example.com/b.nam', bypassed: true } } });
    updateControls({ nam: { 0: { url: 'https://example.com/a2.nam', bypassed: true } } });

    const stored = loadControls();
    expect(stored.nam[0]).toEqual({ url: 'https://example.com/a2.nam', bypassed: true });
    expect(stored.nam[1]).toEqual({ url: 'https://example.com/b.nam', bypassed: true });
  });
});

describe('updateControlsDebounced', () => {
  beforeEach(() => {
    installStorageStub();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accumulates two different nam slots inside one debounce window and lands both', () => {
    updateControlsDebounced({ nam: { 0: { url: 'https://example.com/a.nam', bypassed: false } } });
    updateControlsDebounced({ nam: { 1: { url: 'https://example.com/b.nam', bypassed: true } } });

    vi.advanceTimersByTime(250);

    const stored = loadControls();
    expect(stored.nam[0]).toEqual({ url: 'https://example.com/a.nam', bypassed: false });
    expect(stored.nam[1]).toEqual({ url: 'https://example.com/b.nam', bypassed: true });
  });
});

describe('sanitiseControls — levels and EQ bypass', () => {
  it('keeps a finite NAM level', () => {
    const result = sanitiseControls({ nam: { 0: { url: null, bypassed: false, level: -4.5 } } });
    expect(result.nam[0]).toEqual({ url: null, bypassed: false, level: -4.5 });
  });

  it('clamps an out-of-range NAM level to the level range', () => {
    expect(sanitiseControls({ nam: { 0: { url: null, bypassed: false, level: 99 } } }).nam[0]?.level).toBe(24);
    expect(sanitiseControls({ nam: { 0: { url: null, bypassed: false, level: -99 } } }).nam[0]?.level).toBe(-24);
  });

  it('drops a level that is not a finite number, leaving unity to the reader', () => {
    expect(sanitiseControls({ nam: { 0: { url: null, bypassed: false, level: 'loud' } } }).nam[0]).toEqual({
      url: null,
      bypassed: false,
    });
    expect(sanitiseControls({ nam: { 0: { url: null, bypassed: false, level: Number.NaN } } }).nam[0]).toEqual({
      url: null,
      bypassed: false,
    });
  });

  it('defaults eqBypassed to false and accepts only a real true', () => {
    expect(sanitiseControls({}).eqBypassed).toBe(false);
    expect(sanitiseControls({ eqBypassed: 'yes' }).eqBypassed).toBe(false);
    expect(sanitiseControls({ eqBypassed: true }).eqBypassed).toBe(true);
  });

  it('carries eqLevel through params like any core parameter', () => {
    expect(sanitiseControls({ params: { eqLevel: 3 } }).params.eqLevel).toBe(3);
  });

  it('defaults gateBypassed to true and accepts only a real false', () => {
    expect(sanitiseControls({}).gateBypassed).toBe(true);
    expect(sanitiseControls({ gateBypassed: 'no' }).gateBypassed).toBe(true);
    expect(sanitiseControls({ gateBypassed: 0 }).gateBypassed).toBe(true);
    expect(sanitiseControls({ gateBypassed: false }).gateBypassed).toBe(false);
  });

  it('carries gateThreshold through params and clamps it to its range', () => {
    expect(sanitiseControls({ params: { gateThreshold: -50 } }).params.gateThreshold).toBe(-50);
    expect(sanitiseControls({ params: { gateThreshold: -200 } }).params.gateThreshold).toBe(-80);
  });

  it('defaults cabBypassed to true and accepts only a real false', () => {
    expect(sanitiseControls({}).cabBypassed).toBe(true);
    expect(sanitiseControls({ cabBypassed: 'no' }).cabBypassed).toBe(true);
    expect(sanitiseControls({ cabBypassed: 0 }).cabBypassed).toBe(true);
    expect(sanitiseControls({ cabBypassed: false }).cabBypassed).toBe(false);
  });

  it('carries cabLevel through params and clamps it to its range', () => {
    expect(sanitiseControls({ params: { cabLevel: 6 } }).params.cabLevel).toBe(6);
    expect(sanitiseControls({ params: { cabLevel: 99 } }).params.cabLevel).toBe(24);
    expect(sanitiseControls({ params: { cabLevel: Number.NaN } }).params.cabLevel).toBeUndefined();
  });

  it('defaults cabIr to null', () => {
    expect(sanitiseControls({}).cabIr).toBeNull();
  });

  it('keeps a cabIr that names an upload or a preset url', () => {
    expect(sanitiseControls({ cabIr: 'upload:cab.wav' }).cabIr).toBe('upload:cab.wav');
    expect(sanitiseControls({ cabIr: 'https://example.com/a.wav' }).cabIr).toBe('https://example.com/a.wav');
  });

  it('drops a cabIr that is empty, not a string, or a legacy custom: marker', () => {
    expect(sanitiseControls({ cabIr: '' }).cabIr).toBeNull();
    expect(sanitiseControls({ cabIr: 42 }).cabIr).toBeNull();
    expect(sanitiseControls({ cabIr: 'custom:cab.wav' }).cabIr).toBeNull();
  });
});

describe('subscribeControls', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('tells a subscriber when the working state is written', () => {
    let calls = 0;
    const off = subscribeControls(() => {
      calls += 1;
    });
    updateControls({ inputId: 'in-1' });
    expect(calls).toBe(1);
    off();
    updateControls({ inputId: 'in-2' });
    expect(calls).toBe(1);
  });
});

describe('getControlsSnapshot', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('returns the same object until something is written', () => {
    updateControls({ inputId: 'in-1' });
    const a = getControlsSnapshot();
    expect(getControlsSnapshot()).toBe(a);
    updateControls({ inputId: 'in-2' });
    const b = getControlsSnapshot();
    expect(b).not.toBe(a);
    expect(b.inputId).toBe('in-2');
  });

  it('reflects a whole-state save', () => {
    saveControls({ ...loadControls(), inputId: 'saved' });
    expect(getControlsSnapshot().inputId).toBe('saved');
  });
});

describe('cancelPendingControls', () => {
  beforeEach(() => {
    installStorageStub();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a debounced write that has not landed yet', () => {
    updateControlsDebounced({ params: { inputGain: 9 } });
    cancelPendingControls();
    vi.advanceTimersByTime(1000);
    expect(loadControls().params.inputGain).toBeUndefined();
  });
});

describe('the delay record', () => {
  it('reads a missing, non-object or hostile record as no delay', () => {
    for (const raw of [undefined, null, 'x', 7, [], {}]) {
      expect(sanitiseControls({ delay: raw }).delay).toEqual(DEFAULT_DELAY);
    }
    expect(sanitiseControls({}).delay).toEqual(DEFAULT_DELAY);
  });

  it('keeps a valid record', () => {
    const delay = { present: true, bypassed: true, level: 50, time: 200, feedback: 40 };
    expect(sanitiseControls({ delay }).delay).toEqual(delay);
  });

  it('takes a boolean only when it is a real one', () => {
    expect(sanitiseControls({ delay: { present: 'yes' } }).delay.present).toBe(false);
    expect(sanitiseControls({ delay: { present: 1 } }).delay.present).toBe(false);
    expect(sanitiseControls({ delay: { present: true } }).delay.present).toBe(true);
    expect(sanitiseControls({ delay: { bypassed: 'no' } }).delay.bypassed).toBe(false);
    expect(sanitiseControls({ delay: { bypassed: true } }).delay.bypassed).toBe(true);
  });

  it('clamps out-of-range values and falls back to defaults for non-numbers', () => {
    const d = sanitiseControls({ delay: { level: 500, time: -3, feedback: 100 } }).delay;
    expect(d.level).toBe(100);
    expect(d.time).toBe(20);
    expect(d.feedback).toBe(90);

    const bad = sanitiseControls({ delay: { level: Number.NaN, time: 'slow', feedback: null } }).delay;
    expect(bad.level).toBe(DEFAULT_DELAY.level);
    expect(bad.time).toBe(DEFAULT_DELAY.time);
    expect(bad.feedback).toBe(DEFAULT_DELAY.feedback);
  });

  it('is not shared between two reads', () => {
    const a = sanitiseControls(null);
    a.delay.level = 99;
    expect(sanitiseControls(null).delay.level).toBe(DEFAULT_DELAY.level);
  });
});

describe('updateDelay', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('merges a patch into the stored record and leaves the rest alone', () => {
    updateControls({ inputId: 'in-1' });
    updateDelay({ present: true, level: 60 });
    updateDelay({ time: 120 });

    const stored = loadControls();
    expect(stored.delay).toEqual({ ...DEFAULT_DELAY, present: true, level: 60, time: 120 });
    expect(stored.inputId).toBe('in-1');
  });
});

describe('the chorus record', () => {
  it('reads a missing, non-object or hostile record as no chorus', () => {
    for (const raw of [undefined, null, 'x', 7, [], {}]) {
      expect(sanitiseControls({ chorus: raw }).chorus).toEqual(DEFAULT_CHORUS);
    }
    expect(sanitiseControls({}).chorus).toEqual(DEFAULT_CHORUS);
  });

  it('keeps a valid record', () => {
    const chorus = { present: true, bypassed: true, level: 20, rate: 2.5, depth: 75 };
    expect(sanitiseControls({ chorus }).chorus).toEqual(chorus);
  });

  it('takes a boolean only when it is a real one', () => {
    expect(sanitiseControls({ chorus: { present: 'yes' } }).chorus.present).toBe(false);
    expect(sanitiseControls({ chorus: { present: 1 } }).chorus.present).toBe(false);
    expect(sanitiseControls({ chorus: { present: true } }).chorus.present).toBe(true);
    expect(sanitiseControls({ chorus: { bypassed: 'no' } }).chorus.bypassed).toBe(false);
    expect(sanitiseControls({ chorus: { bypassed: true } }).chorus.bypassed).toBe(true);
  });

  it('clamps out-of-range values and falls back to defaults for non-numbers', () => {
    const c = sanitiseControls({ chorus: { level: 500, rate: 99, depth: -3 } }).chorus;
    expect(c.level).toBe(100);
    expect(c.rate).toBe(5);
    expect(c.depth).toBe(0);
    expect(sanitiseControls({ chorus: { rate: 0 } }).chorus.rate).toBe(0.05);

    const bad = sanitiseControls({ chorus: { level: Number.NaN, rate: 'fast', depth: null } }).chorus;
    expect(bad).toEqual(DEFAULT_CHORUS);
  });

  it('is not shared between two reads', () => {
    const a = sanitiseControls(null);
    a.chorus.level = 99;
    expect(sanitiseControls(null).chorus.level).toBe(DEFAULT_CHORUS.level);
  });
});

describe('the drive record', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('reads as no drive when absent, and from a record written before it existed', () => {
    expect(sanitiseControls({}).drive).toEqual(DEFAULT_DRIVE);
    expect(sanitiseControls({ chorus: { present: true } }).drive).toEqual(DEFAULT_DRIVE);
    expect(DEFAULT_DRIVE).toEqual({ present: false, bypassed: false, level: 0, gain: 27, tone: 50, type: 0 });
  });

  it('keeps valid values and clamps out-of-range ones', () => {
    expect(sanitiseControls({ drive: { present: true, bypassed: true, level: -6, gain: 40, tone: 20, type: 2 } }).drive)
      .toEqual({ present: true, bypassed: true, level: -6, gain: 40, tone: 20, type: 2 });
    expect(sanitiseControls({ drive: { present: true, level: 99, gain: -5, tone: 400 } }).drive)
      .toMatchObject({ level: 24, gain: 6, tone: 100 });
  });

  it('reads a hostile type as a valid 0, 1 or 2', () => {
    const typeOf = (type: unknown) => sanitiseControls({ drive: { present: true, type } }).drive.type;
    expect(typeOf(1)).toBe(1);
    expect(typeOf(2.7)).toBe(2);
    expect(typeOf(1.2)).toBe(1);
    expect(typeOf(5)).toBe(2);
    expect(typeOf(-1)).toBe(0);
    expect(typeOf('2')).toBe(0);
    expect(typeOf(null)).toBe(0);
    expect(typeOf(Number.NaN)).toBe(0);
  });

  it('treats a hostile record as no drive', () => {
    for (const raw of [null, 'drive', [1, 2], 42]) expect(sanitiseControls({ drive: raw }).drive).toEqual(DEFAULT_DRIVE);
    expect(sanitiseControls({ drive: { present: 'yes', level: 'loud' } }).drive).toEqual(DEFAULT_DRIVE);
  });

  it('merges a patch into the stored record', () => {
    updateDrive({ present: true, gain: 33 });
    updateDrive({ type: 1 });
    expect(loadControls().drive).toMatchObject({ present: true, gain: 33, type: 1, tone: 50 });
  });
});

describe('the reverb record', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('reads as no reverb when absent, and from a record written before it existed', () => {
    expect(sanitiseControls({}).reverb).toEqual(DEFAULT_REVERB);
    expect(sanitiseControls({ chorus: { present: true } }).reverb).toEqual(DEFAULT_REVERB);
    expect(DEFAULT_REVERB).toEqual({
      present: false,
      bypassed: false,
      trails: true,
      mix: 30,
      decay: 50,
      tone: 50,
      preDelay: 20,
      character: 50,
      type: 1,
    });
  });

  it('keeps valid values and clamps out-of-range ones', () => {
    const valid = { present: true, bypassed: true, trails: false, mix: 70, decay: 10, tone: 90, preDelay: 120, character: 5, type: 4 };
    expect(sanitiseControls({ reverb: valid }).reverb).toEqual(valid);
    expect(sanitiseControls({ reverb: { present: true, mix: 200, decay: -1, tone: 101, preDelay: 999, character: -50 } }).reverb)
      .toMatchObject({ mix: 100, decay: 0, tone: 100, preDelay: 250, character: 0 });
  });

  it('keeps trails on unless it is explicitly off', () => {
    const trailsOf = (trails: unknown) => sanitiseControls({ reverb: { present: true, trails } }).reverb.trails;
    expect(trailsOf(false)).toBe(false);
    expect(trailsOf(true)).toBe(true);
    expect(trailsOf(undefined)).toBe(true);
    expect(trailsOf('false')).toBe(true);
    expect(trailsOf(0)).toBe(true);
  });

  it('reads a hostile type as one of the six', () => {
    const typeOf = (type: unknown) => sanitiseControls({ reverb: { present: true, type } }).reverb.type;
    expect(typeOf(5)).toBe(5);
    expect(typeOf(2.6)).toBe(3);
    expect(typeOf(9)).toBe(5);
    expect(typeOf(-2)).toBe(0);
    expect(typeOf('4')).toBe(1);
    expect(typeOf(null)).toBe(1);
    expect(typeOf(Number.NaN)).toBe(1);
  });

  it('treats a hostile record as no reverb', () => {
    for (const raw of [null, 'reverb', [1, 2], 42]) expect(sanitiseControls({ reverb: raw }).reverb).toEqual(DEFAULT_REVERB);
    expect(sanitiseControls({ reverb: { present: 'yes', mix: 'wet' } }).reverb).toEqual(DEFAULT_REVERB);
  });

  it('does not share the default through the garbage-record path', () => {
    sanitiseControls({ reverb: 'x' }).reverb.mix = 99;
    expect(DEFAULT_REVERB.mix).toBe(30);
    expect(sanitiseControls({ reverb: 'x' }).reverb.mix).toBe(30);
  });

  it('merges a patch into the stored record', () => {
    updateReverb({ present: true, decay: 80 });
    updateReverb({ type: 5, trails: false });
    expect(loadControls().reverb).toMatchObject({ present: true, decay: 80, type: 5, trails: false, mix: 30 });
  });
});

describe('the tremolo record', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('reads as no tremolo when absent, and from a record written before it existed', () => {
    expect(sanitiseControls({}).tremolo).toEqual(DEFAULT_TREMOLO);
    expect(sanitiseControls({ reverb: { present: true } }).tremolo).toEqual(DEFAULT_TREMOLO);
    expect(DEFAULT_TREMOLO).toEqual({ present: false, bypassed: false, level: 0, rate: 4, depth: 50, wave: 0 });
  });

  it('keeps valid values and clamps out-of-range ones', () => {
    const valid = { present: true, bypassed: true, level: -3.5, rate: 7.25, depth: 90, wave: 2 };
    expect(sanitiseControls({ tremolo: valid }).tremolo).toEqual(valid);
    expect(sanitiseControls({ tremolo: { present: true, level: 50, rate: 100, depth: -5 } }).tremolo)
      .toMatchObject({ level: 24, rate: 15, depth: 0 });
    expect(sanitiseControls({ tremolo: { present: true, level: -50, rate: 0, depth: 500 } }).tremolo)
      .toMatchObject({ level: -24, rate: 0.5, depth: 100 });
  });

  it('reads a hostile wave as one of the four', () => {
    const waveOf = (wave: unknown) => sanitiseControls({ tremolo: { present: true, wave } }).tremolo.wave;
    expect(waveOf(3)).toBe(3);
    expect(waveOf(1.4)).toBe(1);
    expect(waveOf(2.6)).toBe(3);
    expect(waveOf(9)).toBe(3);
    expect(waveOf(-2)).toBe(0);
    expect(waveOf('2')).toBe(0);
    expect(waveOf(null)).toBe(0);
    expect(waveOf(Number.NaN)).toBe(0);
  });

  it('treats a hostile record as no tremolo', () => {
    for (const raw of [null, 'tremolo', [1, 2], 42]) expect(sanitiseControls({ tremolo: raw }).tremolo).toEqual(DEFAULT_TREMOLO);
    expect(sanitiseControls({ tremolo: { present: 'yes', rate: 'fast' } }).tremolo).toEqual(DEFAULT_TREMOLO);
  });

  it('does not share the default through the garbage-record path', () => {
    sanitiseControls({ tremolo: 'x' }).tremolo.rate = 9;
    expect(DEFAULT_TREMOLO.rate).toBe(4);
    expect(sanitiseControls({ tremolo: 'x' }).tremolo.rate).toBe(4);
  });

  it('merges a patch into the stored record', () => {
    updateTremolo({ present: true, rate: 6 });
    updateTremolo({ wave: 3, bypassed: true });
    expect(loadControls().tremolo).toEqual({ ...DEFAULT_TREMOLO, present: true, rate: 6, wave: 3, bypassed: true });
  });
});

describe('the effect order', () => {
  const DEFAULT = ['chorus', 'tremolo', 'delay', 'reverb'];

  it('defaults to chorus, tremolo, delay, reverb', () => {
    expect(DEFAULT_EFFECT_ORDER).toEqual(DEFAULT);
    expect(sanitiseControls({}).effectOrder).toEqual(DEFAULT);
  });

  it('keeps every permutation of the four', () => {
    for (const order of [
      ['chorus', 'tremolo', 'delay', 'reverb'],
      ['reverb', 'chorus', 'delay', 'tremolo'],
      ['tremolo', 'delay', 'reverb', 'chorus'],
      ['reverb', 'delay', 'tremolo', 'chorus'],
    ]) {
      expect(sanitiseControls({ effectOrder: order }).effectOrder).toEqual(order);
    }
  });

  it('keeps an order stored before the tremolo, with the tremolo last', () => {
    expect(sanitiseControls({ effectOrder: ['reverb', 'delay', 'chorus'] }).effectOrder).toEqual([
      'reverb',
      'delay',
      'chorus',
      'tremolo',
    ]);
    expect(sanitiseControls({ effectOrder: ['chorus', 'delay', 'reverb'] }).effectOrder).toEqual([
      'chorus',
      'delay',
      'reverb',
      'tremolo',
    ]);
  });

  it('keeps an order stored before the reverb, with the newer effects after it in default order', () => {
    expect(sanitiseControls({ effectOrder: ['delay', 'chorus'] }).effectOrder).toEqual(['delay', 'chorus', 'tremolo', 'reverb']);
    expect(sanitiseControls({ effectOrder: ['chorus', 'delay'] }).effectOrder).toEqual(['chorus', 'delay', 'tremolo', 'reverb']);
  });

  it('reads anything else as the default', () => {
    const hostile = [
      undefined,
      null,
      'chorus,delay',
      7,
      {},
      [],
      ['delay'],
      ['reverb'],
      ['delay', 'delay'],
      ['delay', 'reverb'],
      ['tremolo', 'reverb'],
      ['delay', 'chorus', 'chorus'],
      ['chorus', 'tremolo', 'delay'],
      ['delay', 'chorus', 'reverb', 'reverb'],
      ['chorus', 'tremolo', 'delay', 'reverb', 'reverb'],
      ['delay', 'chorus', 'drive'],
      ['delay', 'chorus', 'reverb', 'drive'],
      [1, 2, 3],
      ['Chorus', 'Delay', 'Reverb'],
    ];
    for (const raw of hostile) {
      expect(sanitiseControls({ effectOrder: raw }).effectOrder).toEqual(DEFAULT);
    }
  });

  it('never hands out the default itself, so a caller cannot change it', () => {
    expect(sanitiseControls(null).effectOrder).not.toBe(DEFAULT_EFFECT_ORDER);
    expect(sanitiseControls({}).effectOrder).not.toBe(DEFAULT_EFFECT_ORDER);
    expect(sanitiseControls({ effectOrder: 'garbage' }).effectOrder).not.toBe(DEFAULT_EFFECT_ORDER);

    // Mutate once, then look: two reverses of the same shared array would cancel.
    (sanitiseControls({ effectOrder: 'garbage' }).effectOrder as string[]).reverse();
    expect(DEFAULT_EFFECT_ORDER).toEqual(DEFAULT);
    expect(sanitiseControls({}).effectOrder).toEqual(DEFAULT);
  });

  it('does not share the default chorus through the garbage-record path', () => {
    sanitiseControls({ chorus: 'x' }).chorus.level = 99;
    expect(DEFAULT_CHORUS.level).toBe(50);
    expect(sanitiseControls({ chorus: 'x' }).chorus.level).toBe(50);
  });
});

describe('updateChorus and updateEffectOrder', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('merges a chorus patch and leaves the delay and the rest alone', () => {
    updateControls({ inputId: 'in-1' });
    updateDelay({ present: true });
    updateChorus({ present: true, rate: 2 });
    updateChorus({ depth: 80 });

    const stored = loadControls();
    expect(stored.chorus).toEqual({ ...DEFAULT_CHORUS, present: true, rate: 2, depth: 80 });
    expect(stored.delay.present).toBe(true);
    expect(stored.inputId).toBe('in-1');
  });

  it('stores the order and keeps the effects', () => {
    updateChorus({ present: true });
    updateEffectOrder(['reverb', 'tremolo', 'delay', 'chorus']);

    const stored = loadControls();
    expect(stored.effectOrder).toEqual(['reverb', 'tremolo', 'delay', 'chorus']);
    expect(stored.chorus.present).toBe(true);
  });
});
