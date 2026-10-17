import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHORUS,
  DEFAULT_DELAY,
  DEFAULT_DRIVE,
  DEFAULT_EFFECT_ORDER,
  DEFAULT_REVERB,
  DEFAULT_TREMOLO,
  sanitiseControls,
} from './persistence';
import {
  addSetting,
  captureSettings,
  cleanName,
  deleteSetting,
  duplicateSetting,
  emptyData,
  idAtPosition,
  isValidName,
  missingReferences,
  missingUploadIds,
  neighbour,
  positionOf,
  referenceName,
  renameSetting,
  restoreSetting,
  sanitiseData,
  settingNames,
  settingsEqual,
  settingsToControls,
  summarise,
  uniqueName,
  updateSetting,
  type SettingsSnapshot,
} from './savedSettings';

const controls = (over: Record<string, unknown> = {}) =>
  sanitiseControls({
    params: { inputGain: 6, bass: -3 },
    inputId: 'in-1',
    outputId: 'out-1',
    nam: { 0: { url: 'upload:slo.nam', bypassed: false, level: 3 } },
    eqBypassed: false,
    gateBypassed: false,
    cabBypassed: false,
    cabIr: 'upload:cab.wav',
    ...over,
  });

const snap = (over: Record<string, unknown> = {}): SettingsSnapshot => captureSettings(controls(over));

function three() {
  let data = emptyData();
  data = addSetting(data, 'Clean', snap(), 'a').data;
  data = addSetting(data, 'Crunch', snap(), 'b').data;
  data = addSetting(data, 'Lead', snap(), 'c').data;
  return data;
}

describe('captureSettings', () => {
  it('keeps the sound and drops the machine: no devices, no live state', () => {
    const s = snap();
    expect(s).toEqual({
      params: { inputGain: 6, bass: -3 },
      nam: { 0: { url: 'upload:slo.nam', bypassed: false, level: 3 } },
      cabIr: 'upload:cab.wav',
      cabBypassed: false,
      gateBypassed: false,
      eqBypassed: false,
      delay: DEFAULT_DELAY,
      chorus: DEFAULT_CHORUS,
      drive: DEFAULT_DRIVE,
      reverb: DEFAULT_REVERB,
      tremolo: DEFAULT_TREMOLO,
      effectOrder: DEFAULT_EFFECT_ORDER,
    });
    expect(JSON.stringify(s)).not.toContain('in-1');
  });

  it('fills a missing NAM level with 0 so two captures of the same rack compare equal', () => {
    const s = captureSettings({ nam: { 0: { url: 'https://x/a.nam', bypassed: true } } });
    expect(s.nam[0]).toEqual({ url: 'https://x/a.nam', bypassed: true, level: 0 });
  });

  it('sanitises hostile input instead of trusting it', () => {
    const s = captureSettings({ params: { inputGain: Number.NaN, bass: 999 }, cabIr: 42 });
    expect(s.params.inputGain).toBeUndefined();
    expect(s.params.bass).toBe(12);
    expect(s.cabIr).toBeNull();
  });
});

describe('settingsEqual', () => {
  it('ignores the order keys were written in', () => {
    const a: SettingsSnapshot = { ...snap(), params: { inputGain: 6, bass: -3 } };
    const b: SettingsSnapshot = { ...snap(), params: { bass: -3, inputGain: 6 } };
    expect(settingsEqual(a, b)).toBe(true);
  });

  it('sees a changed level, a changed selection and a changed switch', () => {
    expect(settingsEqual(snap(), snap({ params: { inputGain: 7, bass: -3 } }))).toBe(false);
    expect(settingsEqual(snap(), snap({ cabIr: null }))).toBe(false);
    expect(settingsEqual(snap(), snap({ gateBypassed: true }))).toBe(false);
  });
});

describe('settingsToControls', () => {
  it('replaces the sound but keeps the devices from the current state', () => {
    const current = controls({ inputId: 'in-9', outputId: 'out-9' });
    const target = snap({ params: { inputGain: -2 }, cabIr: null, nam: {} });
    const out = settingsToControls(current, target);
    expect(out.inputId).toBe('in-9');
    expect(out.outputId).toBe('out-9');
    expect(out.params).toEqual({ inputGain: -2 });
    expect(out.cabIr).toBeNull();
    expect(out.nam).toEqual({});
  });

  it('does not share objects with the preset', () => {
    const target = snap();
    const out = settingsToControls(controls(), target);
    out.params.inputGain = 0;
    expect(target.params.inputGain).toBe(6);
  });
});

describe('names', () => {
  it('trims, collapses spaces and cuts to 40 characters', () => {
    expect(cleanName('  Big   amp  ')).toBe('Big amp');
    expect(cleanName('x'.repeat(60))).toHaveLength(40);
  });

  it('rejects a name that is empty once cleaned', () => {
    expect(isValidName('   ')).toBe(false);
    expect(isValidName(' a ')).toBe(true);
  });

  it('suffixes a collision, ignoring case', () => {
    expect(uniqueName('Clean', ['clean'])).toBe('Clean 2');
    expect(uniqueName('Clean', ['clean', 'Clean 2'])).toBe('Clean 3');
    expect(uniqueName('Fresh', ['clean'])).toBe('Fresh');
  });

  it('keeps a suffixed name inside the length limit', () => {
    const long = 'y'.repeat(40);
    const out = uniqueName(long, [long]);
    expect(out).toHaveLength(40);
    expect(out.endsWith(' 2')).toBe(true);
  });
});

describe('operations', () => {
  it('adds at the end and makes the new one active', () => {
    const data = three();
    expect(data.order).toEqual(['a', 'b', 'c']);
    expect(data.activeId).toBe('c');
  });

  it('suffixes a duplicate name on add', () => {
    const { data, id } = addSetting(three(), 'Lead', snap(), 'd');
    expect(data.byId[id].name).toBe('Lead 2');
  });

  it('updates the stored settings and nothing else', () => {
    const data = updateSetting(three(), 'a', snap({ cabIr: null }));
    expect(data.byId.a.settings.cabIr).toBeNull();
    expect(data.byId.a.name).toBe('Clean');
    expect(data.byId.b.settings.cabIr).toBe('upload:cab.wav');
  });

  it('renames uniquely among the others, and lets a preset keep its own name', () => {
    expect(renameSetting(three(), 'a', 'Crunch').byId.a.name).toBe('Crunch 2');
    expect(renameSetting(three(), 'a', 'CLEAN').byId.a.name).toBe('CLEAN');
    expect(renameSetting(three(), 'a', '   ').byId.a.name).toBe('Clean');
  });

  it('duplicates right after the original and activates the copy', () => {
    const out = duplicateSetting(three(), 'a', 'z');
    expect(out?.data.order).toEqual(['a', 'z', 'b', 'c']);
    expect(out?.data.byId.z.name).toBe('Clean copy');
    expect(out?.data.activeId).toBe('z');
  });

  it('deletes, and clears the active pointer only if it was the active one', () => {
    const data = three(); // active is c
    expect(deleteSetting(data, 'a').activeId).toBe('c');
    expect(deleteSetting(data, 'c').activeId).toBeNull();
    expect(deleteSetting(data, 'a').order).toEqual(['b', 'c']);
  });

  it('restores a deleted preset where it was', () => {
    const data = three();
    const gone = data.byId.b;
    const back = restoreSetting(deleteSetting(data, 'b'), gone, 1, true);
    expect(back.order).toEqual(['a', 'b', 'c']);
    expect(back.activeId).toBe('b');
  });
});

describe('navigation', () => {
  it('steps and wraps around', () => {
    const data = three();
    expect(neighbour(data, 'a', 1)).toBe('b');
    expect(neighbour(data, 'c', 1)).toBe('a');
    expect(neighbour(data, 'a', -1)).toBe('c');
  });

  it('starts at the first for next and the last for previous when nothing is active', () => {
    const data = { ...three(), activeId: null };
    expect(neighbour(data, null, 1)).toBe('a');
    expect(neighbour(data, null, -1)).toBe('c');
  });

  it('does nothing with no presets', () => {
    expect(neighbour(emptyData(), null, 1)).toBeNull();
  });

  it('finds a preset by position and a position by id', () => {
    const data = three();
    expect(idAtPosition(data, 1)).toBe('b');
    expect(idAtPosition(data, 9)).toBeNull();
    expect(positionOf(data, 'c')).toBe(2);
    expect(positionOf(data, 'nope')).toBe(-1);
  });

  it('lists names, optionally leaving one out', () => {
    expect(settingNames(three())).toEqual(['Clean', 'Crunch', 'Lead']);
    expect(settingNames(three(), 'b')).toEqual(['Clean', 'Lead']);
  });
});

describe('referenceName and summarise', () => {
  it('names an upload, a bundled url and a wav url plainly', () => {
    expect(referenceName('upload:my amp.nam')).toBe('my amp.nam');
    expect(referenceName('/models/Slo100%20noon.nam')).toBe('Slo100 noon');
    expect(referenceName('https://x/irs/4x12.wav')).toBe('4x12');
  });

  it('summarises the model and the IR', () => {
    expect(summarise(snap())).toBe('slo.nam · cab.wav');
    expect(summarise(snap({ nam: {}, cabIr: null }))).toBe('Default sounds');
  });
});

describe('missingUploadIds', () => {
  it('flags a preset whose upload is no longer saved', () => {
    const data = three();
    expect([...missingUploadIds(data, ['slo.nam'], ['cab.wav'])]).toEqual([]);
    expect([...missingUploadIds(data, [], ['cab.wav'])].sort()).toEqual(['a', 'b', 'c']);
    expect([...missingUploadIds(data, ['slo.nam'], [])].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not check bundled urls', () => {
    const { data } = addSetting(emptyData(), 'Bundled', snap({ nam: { 0: { url: '/models/a.nam', bypassed: false } }, cabIr: null }), 'x');
    expect(missingUploadIds(data, [], []).size).toBe(0);
  });
});

describe('missingReferences', () => {
  const one = (nam: SettingsSnapshot['nam'], cabIr: string | null) =>
    snap({ nam, cabIr });

  it('names each upload that is no longer saved, models then the IR', () => {
    const s = one({ 0: { url: 'upload:slo.nam', bypassed: false }, 1: { url: 'upload:sd1.nam', bypassed: false } }, 'upload:cab.wav');
    expect(missingReferences(s, ['sd1.nam'], [])).toEqual(['slo.nam', 'cab.wav']);
    expect(missingReferences(s, ['slo.nam', 'sd1.nam'], ['cab.wav'])).toEqual([]);
  });

  it('ignores bundled urls and empty slots', () => {
    const s = one({ 0: { url: '/models/a.nam', bypassed: false }, 1: { url: null, bypassed: false } }, null);
    expect(missingReferences(s, [], [])).toEqual([]);
  });
});

describe('sanitiseData', () => {
  it('reads garbage as empty', () => {
    for (const raw of [null, 'x', 7, [], undefined]) expect(sanitiseData(raw)).toEqual(emptyData());
  });

  it('round-trips valid data', () => {
    const data = three();
    expect(sanitiseData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('drops a preset with no usable name and keeps the rest', () => {
    const raw = { version: 1, activeId: 'a', order: ['a', 'b'], byId: { a: { name: 'Ok', settings: {} }, b: { name: '   ', settings: {} } } };
    const out = sanitiseData(raw);
    expect(out.order).toEqual(['a']);
    expect(Object.keys(out.byId)).toEqual(['a']);
  });

  it('repairs an order that is short, duplicated or names ids that do not exist', () => {
    const raw = {
      order: ['b', 'ghost', 'b'],
      byId: { a: { name: 'A', settings: {} }, b: { name: 'B', settings: {} } },
    };
    expect(sanitiseData(raw).order).toEqual(['b', 'a']);
  });

  it('drops an active id that does not exist', () => {
    const raw = { activeId: 'ghost', order: ['a'], byId: { a: { name: 'A', settings: {} } } };
    expect(sanitiseData(raw).activeId).toBeNull();
  });

  it('cannot be poisoned through an id named __proto__', () => {
    const raw = JSON.parse('{"order":["__proto__"],"byId":{"__proto__":{"name":"Evil","settings":{}}}}');
    const out = sanitiseData(raw);
    expect(out.order).toEqual([]);
    expect(({} as Record<string, unknown>).name).toBeUndefined();
  });

  it('sanitises the settings inside each preset', () => {
    const raw = { order: ['a'], byId: { a: { name: 'A', settings: { params: { inputGain: 'loud', bass: 500 } } } } };
    const s = sanitiseData(raw).byId.a.settings;
    expect(s.params.inputGain).toBeUndefined();
    expect(s.params.bass).toBe(12);
  });
});

describe('the delay in a preset', () => {
  const withDelay = { delay: { present: true, bypassed: false, level: 55, time: 180, feedback: 40 } };

  it('is captured when placed', () => {
    expect(snap(withDelay).delay).toEqual(withDelay.delay);
  });

  it('is normalised to the default when not placed, so hidden values never make two presets differ', () => {
    const a = snap({ delay: { present: false, level: 90, time: 900, feedback: 80 } });
    const b = snap({ delay: { present: false, level: 10, time: 40, feedback: 5 } });
    expect(a.delay).toEqual(DEFAULT_DELAY);
    expect(settingsEqual(a, b)).toBe(true);
  });

  it('makes a preset show as changed when the delay is added or moved', () => {
    const none = snap();
    const placed = snap(withDelay);
    expect(settingsEqual(none, placed)).toBe(false);
    expect(settingsEqual(placed, snap({ delay: { ...withDelay.delay, time: 181 } }))).toBe(false);
    expect(settingsEqual(placed, snap({ delay: { ...withDelay.delay, bypassed: true } }))).toBe(false);
    expect(settingsEqual(placed, snap(withDelay))).toBe(true);
  });

  it('is carried into the working state, keeping the devices', () => {
    const current = controls({ inputId: 'keep-me' });
    const out = settingsToControls(current, snap(withDelay));
    expect(out.delay).toEqual(withDelay.delay);
    expect(out.inputId).toBe('keep-me');
  });

  it('is removed from the working state by a preset that never had one', () => {
    const current = controls(withDelay);
    expect(current.delay.present).toBe(true);
    const out = settingsToControls(current, snap());
    expect(out.delay.present).toBe(false);
  });

  it('is mentioned in the list summary', () => {
    expect(summarise(snap(withDelay))).toBe('slo.nam · cab.wav · Delay');
    expect(summarise(snap())).toBe('slo.nam · cab.wav');
  });

  it('reads an old stored preset with no delay as no delay', () => {
    const old = { version: 1, activeId: 'a', order: ['a'], byId: { a: { name: 'Old', settings: { params: {}, nam: {}, cabIr: null } } } };
    const data = sanitiseData(old);
    expect(data.byId.a.settings.delay).toEqual(DEFAULT_DELAY);
  });
});

describe('the chorus and the order in a preset', () => {
  const chorus = { present: true, bypassed: false, level: 65, rate: 1.5, depth: 40 };
  const delay = { present: true, bypassed: false, level: 55, time: 180, feedback: 40 };

  it('captures a placed chorus', () => {
    expect(snap({ chorus }).chorus).toEqual(chorus);
  });

  it('normalises a chorus that is not placed, so hidden values never make two presets differ', () => {
    const a = snap({ chorus: { ...chorus, present: false } });
    const b = snap({ chorus: { present: false, level: 5, rate: 4, depth: 90 } });
    expect(a.chorus).toEqual(DEFAULT_CHORUS);
    expect(settingsEqual(a, b)).toBe(true);
  });

  it('keeps the order of the placed effects only, in the places the default order gives them', () => {
    expect(snap({ chorus, delay, effectOrder: ['delay', 'chorus'] }).effectOrder).toEqual(['delay', 'tremolo', 'chorus', 'reverb']);
    expect(snap({ delay, effectOrder: ['delay', 'chorus'] }).effectOrder).toEqual(DEFAULT_EFFECT_ORDER);
    expect(snap({ chorus, effectOrder: ['delay', 'chorus'] }).effectOrder).toEqual(DEFAULT_EFFECT_ORDER);
    expect(snap({ effectOrder: ['delay', 'chorus'] }).effectOrder).toEqual(DEFAULT_EFFECT_ORDER);
  });

  it('shows a preset as changed when a placed chorus or the order of two placed effects changes, and not otherwise', () => {
    const forward = snap({ chorus, delay });
    expect(settingsEqual(forward, snap({ chorus, delay, effectOrder: ['delay', 'chorus'] }))).toBe(false);
    expect(settingsEqual(forward, snap({ chorus: { ...chorus, depth: 41 }, delay }))).toBe(false);
    expect(settingsEqual(snap(), snap({ chorus }))).toBe(false);
    expect(settingsEqual(snap({ delay }), snap({ delay, effectOrder: ['delay', 'chorus'] }))).toBe(true);
  });

  it('is carried into the working state, keeping the devices', () => {
    const out = settingsToControls(
      controls({ inputId: 'keep-me' }),
      snap({ chorus, delay, effectOrder: ['delay', 'chorus'] }),
    );
    expect(out.chorus).toEqual(chorus);
    expect(out.effectOrder).toEqual(['delay', 'tremolo', 'chorus', 'reverb']);
    expect(out.inputId).toBe('keep-me');
  });

  it('removes a placed chorus when the preset has none', () => {
    const current = controls({ chorus });
    expect(current.chorus.present).toBe(true);
    expect(settingsToControls(current, snap()).chorus.present).toBe(false);
  });

  it('does not share the order with the preset', () => {
    const preset = snap({ chorus, delay, effectOrder: ['delay', 'chorus'] });
    const out = settingsToControls(controls(), preset);
    out.effectOrder.reverse();
    expect(preset.effectOrder).toEqual(['delay', 'tremolo', 'chorus', 'reverb']);
  });

  it('names each placed effect in the summary, in chain order', () => {
    expect(summarise(snap())).toBe('slo.nam · cab.wav');
    expect(summarise(snap({ chorus }))).toBe('slo.nam · cab.wav · Chorus');
    expect(summarise(snap({ delay }))).toBe('slo.nam · cab.wav · Delay');
    expect(summarise(snap({ chorus, delay }))).toBe('slo.nam · cab.wav · Chorus · Delay');
    expect(summarise(snap({ chorus, delay, effectOrder: ['delay', 'chorus'] }))).toBe(
      'slo.nam · cab.wav · Delay · Chorus',
    );
  });

  it('reads an old stored preset with no chorus and no order as no chorus in the default order', () => {
    const old = {
      version: 1,
      activeId: 'a',
      order: ['a'],
      byId: { a: { name: 'Old', settings: { params: {}, nam: {}, cabIr: null, delay } } },
    };
    const s = sanitiseData(old).byId.a.settings;
    expect(s.chorus).toEqual(DEFAULT_CHORUS);
    expect(s.effectOrder).toEqual(DEFAULT_EFFECT_ORDER);
    expect(s.delay).toEqual(delay);
  });

  it('reads a hostile stored order as the default', () => {
    const raw = { order: ['a'], byId: { a: { name: 'A', settings: { chorus, delay, effectOrder: ['delay', 'delay'] } } } };
    expect(sanitiseData(raw).byId.a.settings.effectOrder).toEqual(DEFAULT_EFFECT_ORDER);
  });
});

describe('the drive in a preset', () => {
  const drive = { present: true, bypassed: false, level: -2, gain: 36, tone: 30, type: 1 as const };

  it('captures a placed drive and ignores the values of an unplaced one', () => {
    expect(snap({ drive }).drive).toEqual(drive);
    expect(snap({ drive: { ...drive, present: false } }).drive).toEqual(DEFAULT_DRIVE);
  });

  it('makes two presets differ when only the drive differs', () => {
    expect(settingsEqual(snap({ drive }), snap({}))).toBe(false);
    expect(settingsEqual(snap({ drive: { ...drive, present: false } }), snap({}))).toBe(true);
  });

  it('carries the drive into the working state, and an old preset removes it', () => {
    const current = sanitiseControls({ drive });
    expect(settingsToControls(current, snap({ drive })).drive).toEqual(drive);
    expect(settingsToControls(current, captureSettings({})).drive.present).toBe(false);
  });

  it('names the drive first in the summary', () => {
    expect(summarise(snap({ drive, chorus: { present: true } }))).toBe('Drive · slo.nam · cab.wav · Chorus');
    expect(summarise(snap({ drive, nam: {}, cabIr: null }))).toBe('Drive');
  });
});

describe('the reverb in a preset', () => {
  const reverb = {
    present: true,
    bypassed: false,
    trails: false,
    mix: 45,
    decay: 70,
    tone: 35,
    preDelay: 60,
    character: 80,
    type: 4 as const,
  };
  const chorus = { present: true, bypassed: false, level: 65, rate: 1.5, depth: 40 };
  const delay = { present: true, bypassed: false, level: 55, time: 180, feedback: 40 };

  it('captures a placed reverb, trails included, and ignores the values of an unplaced one', () => {
    expect(snap({ reverb }).reverb).toEqual(reverb);
    expect(snap({ reverb: { ...reverb, present: false } }).reverb).toEqual(DEFAULT_REVERB);
  });

  it('makes two presets differ when only the reverb or its trails differ', () => {
    expect(settingsEqual(snap({ reverb }), snap({}))).toBe(false);
    expect(settingsEqual(snap({ reverb }), snap({ reverb: { ...reverb, trails: true } }))).toBe(false);
    expect(settingsEqual(snap({ reverb: { ...reverb, present: false } }), snap({}))).toBe(true);
  });

  it('keeps where the placed effects sit and nothing about the missing ones', () => {
    // Chorus and reverb placed, reverb first: the delay's position is not part of the sound.
    const a = snap({ chorus, reverb, effectOrder: ['reverb', 'delay', 'chorus'] });
    const b = snap({ chorus, reverb, effectOrder: ['reverb', 'chorus', 'delay'] });
    expect(a.effectOrder).toEqual(['reverb', 'tremolo', 'delay', 'chorus']);
    expect(settingsEqual(a, b)).toBe(true);
    expect(settingsEqual(a, snap({ chorus, reverb }))).toBe(false);
    // All three placed: their whole order is the sound.
    expect(snap({ chorus, delay, reverb, effectOrder: ['reverb', 'chorus', 'delay'] }).effectOrder).toEqual([
      'reverb',
      'tremolo',
      'chorus',
      'delay',
    ]);
  });

  it('carries the reverb into the working state, and an old preset removes it', () => {
    const current = sanitiseControls({ reverb });
    expect(settingsToControls(current, snap({ reverb })).reverb).toEqual(reverb);
    expect(settingsToControls(current, captureSettings({})).reverb.present).toBe(false);
  });

  it('names the reverb in the summary, in chain order', () => {
    expect(summarise(snap({ reverb }))).toBe('slo.nam · cab.wav · Reverb');
    expect(summarise(snap({ chorus, delay, reverb }))).toBe('slo.nam · cab.wav · Chorus · Delay · Reverb');
    expect(summarise(snap({ chorus, delay, reverb, effectOrder: ['reverb', 'chorus', 'delay'] }))).toBe(
      'slo.nam · cab.wav · Reverb · Chorus · Delay',
    );
  });
});

describe('the tremolo in a preset', () => {
  const tremolo = { present: true, bypassed: false, level: 2.5, rate: 6, depth: 80, wave: 2 as const };
  const chorus = { present: true, bypassed: false, level: 65, rate: 1.5, depth: 40 };
  const delay = { present: true, bypassed: false, level: 55, time: 180, feedback: 40 };
  const reverb = { present: true, type: 1 };

  it('captures a placed tremolo and ignores the values of an unplaced one', () => {
    expect(snap({ tremolo }).tremolo).toEqual(tremolo);
    expect(snap({ tremolo: { ...tremolo, present: false } }).tremolo).toEqual(DEFAULT_TREMOLO);
  });

  it('makes two presets differ when only the tremolo or its wave differs', () => {
    expect(settingsEqual(snap({ tremolo }), snap({}))).toBe(false);
    expect(settingsEqual(snap({ tremolo }), snap({ tremolo: { ...tremolo, wave: 3 } }))).toBe(false);
    expect(settingsEqual(snap({ tremolo: { ...tremolo, present: false } }), snap({}))).toBe(true);
  });

  it('keeps where a placed tremolo sits, and nothing about a missing one', () => {
    const after = snap({ chorus, tremolo, effectOrder: ['chorus', 'delay', 'reverb', 'tremolo'] });
    const before = snap({ chorus, tremolo, effectOrder: ['tremolo', 'delay', 'reverb', 'chorus'] });
    expect(settingsEqual(after, before)).toBe(false);
    expect(
      settingsEqual(
        snap({ chorus, delay, effectOrder: ['chorus', 'delay', 'reverb', 'tremolo'] }),
        snap({ chorus, delay, effectOrder: ['tremolo', 'chorus', 'reverb', 'delay'] }),
      ),
    ).toBe(true);
  });

  it('compares a preset saved before the tremolo exactly as it did', () => {
    // Saved with three effects in a three-effect order; the rack has the same
    // effects placed, in an order that has since had the tremolo added.
    const old = {
      order: ['a'],
      byId: {
        a: {
          name: 'Old',
          settings: { params: { inputGain: 6, bass: -3 }, nam: { 0: { url: 'upload:slo.nam', bypassed: false, level: 3 } }, cabIr: 'upload:cab.wav', gateBypassed: false, cabBypassed: false, chorus, delay, reverb, effectOrder: ['reverb', 'chorus', 'delay'] },
        },
      },
    };
    const saved = sanitiseData(old).byId.a.settings;
    expect(saved.tremolo).toEqual(DEFAULT_TREMOLO);
    expect(settingsEqual(saved, snap({ chorus, delay, reverb, effectOrder: ['reverb', 'chorus', 'delay', 'tremolo'] }))).toBe(true);
    expect(settingsEqual(saved, snap({ chorus, delay, reverb, effectOrder: ['tremolo', 'reverb', 'chorus', 'delay'] }))).toBe(true);
    expect(settingsEqual(saved, snap({ chorus, delay, reverb }))).toBe(false);
  });

  it('carries the tremolo into the working state, and an old preset removes it', () => {
    const current = sanitiseControls({ tremolo });
    expect(settingsToControls(current, snap({ tremolo })).tremolo).toEqual(tremolo);
    expect(settingsToControls(current, captureSettings({})).tremolo.present).toBe(false);
  });

  it('names the tremolo in the summary, in chain order', () => {
    expect(summarise(snap({ tremolo }))).toBe('slo.nam · cab.wav · Tremolo');
    expect(summarise(snap({ chorus, tremolo, delay, reverb }))).toBe('slo.nam · cab.wav · Chorus · Tremolo · Delay · Reverb');
    expect(summarise(snap({ chorus, tremolo, delay, reverb, effectOrder: ['reverb', 'tremolo', 'chorus', 'delay'] }))).toBe(
      'slo.nam · cab.wav · Reverb · Tremolo · Chorus · Delay',
    );
  });
});
