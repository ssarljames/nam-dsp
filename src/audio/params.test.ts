import { describe, expect, it } from 'vitest';
import {
  CORE_PARAMS,
  NAM_SLOT_COUNT,
  PARAM_COUNT,
  PARAM_INDEX,
  PARAM_ORDER,
  PARAMS_PER_SLOT,
  formatValue,
  levelSpec,
  normalizedToValue,
  slotParamId,
  valueToNormalized,
  DELAY_PARAMS,
  DELAY_PARAM_INDEX,
  DELAY_SLOT,
  CHORUS_PARAMS,
  CHORUS_PARAM_INDEX,
  CHORUS_SLOT,
  DRIVE_PARAMS,
  DRIVE_PARAM_INDEX,
  DRIVE_SLOT,
  DRIVE_TYPE_INDEX,
  DRIVE_TYPE_LABELS,
  DEFAULT_DRIVE_TYPE,
  REVERB_PARAMS,
  REVERB_PARAM_INDEX,
  REVERB_SLOT,
  REVERB_TYPE_INDEX,
  REVERB_TYPE_LABELS,
  REVERB_CHARACTER_LABELS,
  REVERB_CHARACTER_SPECS,
  DEFAULT_REVERB_TYPE,
  reverbDecaySeconds,
  formatReverbDecay,
  TREMOLO_PARAMS,
  TREMOLO_PARAM_INDEX,
  TREMOLO_SLOT,
  TREMOLO_WAVE_INDEX,
  TREMOLO_WAVE_NAMES,
  DEFAULT_TREMOLO_WAVE,
} from './params';

// Every declared parameter, plus an engaged level — a knob with a broken
// taper is broken whether or not it is wired.
const allSpecs = [
  ...Object.values(CORE_PARAMS),
  ...Object.values(DELAY_PARAMS),
  ...Object.values(CHORUS_PARAMS),
  ...Object.values(DRIVE_PARAMS),
  ...Object.values(REVERB_PARAMS),
  ...REVERB_CHARACTER_SPECS,
  ...Object.values(TREMOLO_PARAMS),
  levelSpec('testLevel'),
];

describe('tapers', () => {
  it('round-trips every declared parameter across the whole range', () => {
    for (const spec of allSpecs) {
      for (let i = 0; i <= 20; i++) {
        const n = i / 20;
        const back = valueToNormalized(spec, normalizedToValue(spec, n));
        expect(back).toBeCloseTo(n, 6);
      }
    }
  });

  it('maps 0 to min and 1 to max for every parameter', () => {
    for (const spec of allSpecs) {
      expect(normalizedToValue(spec, 0)).toBeCloseTo(spec.min, 6);
      expect(normalizedToValue(spec, 1)).toBeCloseTo(spec.max, 6);
    }
  });

  it('puts a skewed parameter centre value at mid travel', () => {
    const spec = CORE_PARAMS.outputVolume;
    if (spec.taper.kind !== 'skewed') throw new Error('outputVolume must be skewed');
    expect(normalizedToValue(spec, 0.5)).toBeCloseTo(spec.taper.center, 6);
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    const spec = CORE_PARAMS.bass;
    expect(normalizedToValue(spec, -1)).toBeCloseTo(spec.min, 6);
    expect(normalizedToValue(spec, 2)).toBeCloseTo(spec.max, 6);
    expect(valueToNormalized(spec, spec.min - 100)).toBe(0);
    expect(valueToNormalized(spec, spec.max + 100)).toBe(1);
  });

  it('gives every default a position inside the travel', () => {
    for (const spec of allSpecs) {
      const n = valueToNormalized(spec, spec.default);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('formatValue', () => {
  it('formats dB with a sign and one decimal', () => {
    expect(formatValue(CORE_PARAMS.bass, 3.5)).toBe('+3.5 dB');
    expect(formatValue(CORE_PARAMS.bass, -3.5)).toBe('−3.5 dB');
    expect(formatValue(CORE_PARAMS.bass, 0)).toBe('0.0 dB');
  });

  it('shows minus infinity at the bottom of a volume range', () => {
    expect(formatValue(CORE_PARAMS.outputVolume, -60)).toBe('−∞ dB');
  });

  it('shows minus infinity at the bottom of the gate threshold, where the gate never closes', () => {
    expect(formatValue(CORE_PARAMS.gateThreshold, -80)).toBe('−∞ dB');
  });

  it('formats the cab level at its minimum, default and maximum', () => {
    expect(formatValue(CORE_PARAMS.cabLevel, -24)).toBe('−24.0 dB');
    expect(formatValue(CORE_PARAMS.cabLevel, 0)).toBe('0.0 dB');
    expect(formatValue(CORE_PARAMS.cabLevel, 24)).toBe('+24.0 dB');
  });

  it('formats min, default and max of every parameter without NaN', () => {
    for (const spec of allSpecs) {
      for (const v of [spec.min, spec.default, spec.max]) {
        const s = formatValue(spec, v);
        expect(s).not.toContain('NaN');
        expect(s.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('parameter pool', () => {
  it('declares exactly 56 parameters: 8 core + 8 slots x 6', () => {
    expect(PARAM_COUNT).toBe(56);
    expect(PARAM_ORDER).toHaveLength(56);
  });

  it('starts with the eight core parameters in the order the engine expects', () => {
    expect(PARAM_ORDER.slice(0, 8)).toEqual([
      'inputGain',
      'bass',
      'mid',
      'treble',
      'eqLevel',
      'outputVolume',
      'gateThreshold',
      'cabLevel',
    ]);
  });

  it('names slot parameters predictably', () => {
    expect(slotParamId(0, 0)).toBe('slot0_p0');
    expect(slotParamId(7, 5)).toBe('slot7_p5');
    expect(PARAM_ORDER[8]).toBe('slot0_p0');
    expect(PARAM_ORDER[55]).toBe('slot7_p5');
  });

  it('has no duplicate ids', () => {
    expect(new Set(PARAM_ORDER).size).toBe(PARAM_ORDER.length);
  });

  it('derives PARAM_INDEX to match C++ engine contract', () => {
    expect(PARAM_INDEX.inputGain).toBe(0);
    expect(PARAM_INDEX.eqBase).toBe(1); // bass
    expect(PARAM_INDEX.eqLevel).toBe(4);
    expect(PARAM_INDEX.outputVolume).toBe(5);
    expect(PARAM_INDEX.gateThreshold).toBe(6);
    expect(PARAM_INDEX.cabLevel).toBe(7);
    expect(PARAM_INDEX.slotBase).toBe(8);
    expect(PARAM_ORDER[PARAM_INDEX.slotBase]).toBe('slot0_p0');
  });
});

describe('NAM_SLOT_COUNT', () => {
  it('fits inside the pre-declared slot pool', () => {
    expect(NAM_SLOT_COUNT).toBeGreaterThanOrEqual(1);
    // Mirrors Engine.h's static_assert: the highest param index the last NAM
    // stage can address (slotBase + NAM_SLOT_COUNT * PARAMS_PER_SLOT, exclusive)
    // must stay inside the declared pool (PARAM_COUNT). Unlike the old
    // `NAM_SLOT_COUNT * PARAMS_PER_SLOT <= SLOT_COUNT * PARAMS_PER_SLOT` form,
    // PARAMS_PER_SLOT does not cancel out here, so this can actually fail —
    // e.g. if NAM_SLOT_COUNT were raised past what the pool can hold.
    expect(PARAM_INDEX.slotBase + NAM_SLOT_COUNT * PARAMS_PER_SLOT).toBeLessThanOrEqual(PARAM_COUNT);
  });
});

describe('the delay parameters', () => {
  it('lives in the first slot after the NAM stages, and its three params fit the slot', () => {
    expect(DELAY_SLOT).toBe(NAM_SLOT_COUNT);
    // engine/Engine.h: kDelayParamIndex == 14.
    expect(PARAM_INDEX.slotBase + DELAY_SLOT * PARAMS_PER_SLOT).toBe(14);
    expect(Object.keys(DELAY_PARAM_INDEX)).toHaveLength(3);
    for (const index of Object.values(DELAY_PARAM_INDEX)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PARAMS_PER_SLOT);
    }
  });

  it('orders level, time, feedback as DelayProcessor::setParams reads them', () => {
    expect(DELAY_PARAM_INDEX).toEqual({ level: 0, time: 1, feedback: 2 });
  });

  it('has the ranges and defaults the spec fixes', () => {
    expect(DELAY_PARAMS.level).toMatchObject({ min: 0, max: 100, default: 30, unit: '%' });
    expect(DELAY_PARAMS.time).toMatchObject({ min: 20, max: 1000, default: 350, unit: 'ms' });
    expect(DELAY_PARAMS.feedback).toMatchObject({ min: 0, max: 90, default: 35, unit: '%' });
  });

  it('puts 250 ms at mid travel on the time slider', () => {
    expect(normalizedToValue(DELAY_PARAMS.time, 0.5)).toBeCloseTo(250, 3);
  });

  it('formats each default the way it is read out', () => {
    expect(formatValue(DELAY_PARAMS.level, DELAY_PARAMS.level.default)).toBe('30 %');
    expect(formatValue(DELAY_PARAMS.time, DELAY_PARAMS.time.default)).toBe('350 ms');
    expect(formatValue(DELAY_PARAMS.feedback, DELAY_PARAMS.feedback.default)).toBe('35 %');
  });
});

describe('the chorus parameters', () => {
  it('lives in the slot after the delay, and its three params fit the pool', () => {
    expect(CHORUS_SLOT).toBe(NAM_SLOT_COUNT + 1);
    expect(CHORUS_SLOT).not.toBe(DELAY_SLOT);
    // engine/Engine.h: kChorusParamIndex == 20.
    expect(PARAM_INDEX.slotBase + CHORUS_SLOT * PARAMS_PER_SLOT).toBe(20);
    expect(PARAM_INDEX.slotBase + (CHORUS_SLOT + 1) * PARAMS_PER_SLOT).toBeLessThanOrEqual(PARAM_COUNT);
    for (const index of Object.values(CHORUS_PARAM_INDEX)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PARAMS_PER_SLOT);
    }
  });

  it('orders level, rate, depth as ChorusProcessor::setParams reads them', () => {
    expect(CHORUS_PARAM_INDEX).toEqual({ level: 0, rate: 1, depth: 2 });
  });

  it('has the ranges and defaults the spec fixes', () => {
    expect(CHORUS_PARAMS.level).toMatchObject({ min: 0, max: 100, default: 50, unit: '%', label: 'LEVEL' });
    expect(CHORUS_PARAMS.rate).toMatchObject({ min: 0.05, max: 5, default: 0.8, unit: 'Hz', label: 'RATE' });
    expect(CHORUS_PARAMS.depth).toMatchObject({ min: 0, max: 100, default: 50, unit: '%', label: 'DEPTH' });
  });

  it('puts 0.8 Hz at mid travel on the rate knob', () => {
    expect(normalizedToValue(CHORUS_PARAMS.rate, 0.5)).toBeCloseTo(0.8, 6);
  });

  it('formats the rate and the percentages the way they are read out', () => {
    expect(formatValue(CHORUS_PARAMS.rate, 0.05)).toBe('0.05 Hz');
    expect(formatValue(CHORUS_PARAMS.rate, 0.8)).toBe('0.80 Hz');
    expect(formatValue(CHORUS_PARAMS.rate, 5)).toBe('5.00 Hz');
    expect(formatValue(CHORUS_PARAMS.level, CHORUS_PARAMS.level.default)).toBe('50 %');
    expect(formatValue(CHORUS_PARAMS.depth, 0)).toBe('0 %');
    expect(formatValue(CHORUS_PARAMS.depth, 100)).toBe('100 %');
  });
});

describe('drive params', () => {
  it('sits in the slot after the chorus, level first and the type fourth', () => {
    expect(DRIVE_SLOT).toBe(NAM_SLOT_COUNT + 2);
    expect(PARAM_INDEX.slotBase + DRIVE_SLOT * PARAMS_PER_SLOT).toBe(26);
    expect(DRIVE_PARAM_INDEX).toEqual({ level: 0, gain: 1, tone: 2 });
    expect(DRIVE_TYPE_INDEX).toBe(3);
  });

  it('has the spec ranges and defaults', () => {
    expect([DRIVE_PARAMS.level.min, DRIVE_PARAMS.level.max, DRIVE_PARAMS.level.default]).toEqual([-24, 24, 0]);
    expect(DRIVE_PARAMS.level.detent).toBe(0);
    expect([DRIVE_PARAMS.gain.min, DRIVE_PARAMS.gain.max, DRIVE_PARAMS.gain.default]).toEqual([6, 48, 27]);
    expect([DRIVE_PARAMS.tone.min, DRIVE_PARAMS.tone.max, DRIVE_PARAMS.tone.default]).toEqual([0, 100, 50]);
    expect(DRIVE_PARAMS.gain.label).toBe('GAIN');
    expect(DRIVE_PARAMS.tone.label).toBe('TONE');
    expect(DRIVE_PARAMS.level.label).toBe('LEVEL');
  });

  it('formats the knobs at min, default and max', () => {
    expect(formatValue(DRIVE_PARAMS.gain, 6)).toBe('+6.0 dB');
    expect(formatValue(DRIVE_PARAMS.gain, 27)).toBe('+27.0 dB');
    expect(formatValue(DRIVE_PARAMS.gain, 48)).toBe('+48.0 dB');
    expect(formatValue(DRIVE_PARAMS.tone, 0)).toBe('0 %');
    expect(formatValue(DRIVE_PARAMS.tone, 50)).toBe('50 %');
    expect(formatValue(DRIVE_PARAMS.level, -24)).toBe('−24.0 dB');
  });

  it('names the three clipping types, soft by default', () => {
    expect(DRIVE_TYPE_LABELS).toEqual(['SOFT', 'HARD', 'ASYM']);
    expect(DEFAULT_DRIVE_TYPE).toBe(0);
  });
});

describe('reverb params', () => {
  it('sits in the slot after the drive, the five knobs first and the type sixth', () => {
    expect(REVERB_SLOT).toBe(NAM_SLOT_COUNT + 3);
    expect(PARAM_INDEX.slotBase + REVERB_SLOT * PARAMS_PER_SLOT).toBe(32);
    expect(REVERB_PARAM_INDEX).toEqual({ mix: 0, decay: 1, tone: 2, preDelay: 3, character: 4 });
    expect(REVERB_TYPE_INDEX).toBe(5);
    expect(REVERB_TYPE_INDEX).toBeLessThan(PARAMS_PER_SLOT);
  });

  it('has the spec ranges, defaults and legends', () => {
    const r = REVERB_PARAMS;
    expect([r.mix.min, r.mix.max, r.mix.default, r.mix.label, r.mix.unit]).toEqual([0, 100, 30, 'MIX', '%']);
    expect([r.decay.min, r.decay.max, r.decay.default, r.decay.label]).toEqual([0, 100, 50, 'DECAY']);
    expect([r.tone.min, r.tone.max, r.tone.default, r.tone.label]).toEqual([0, 100, 50, 'TONE']);
    expect([r.preDelay.min, r.preDelay.max, r.preDelay.default, r.preDelay.label, r.preDelay.unit]).toEqual([
      0,
      250,
      20,
      'PRE-DELAY',
      'ms',
    ]);
    expect([r.character.min, r.character.max, r.character.default]).toEqual([0, 100, 50]);
  });

  it('puts 40 ms at mid travel on the pre-delay knob', () => {
    expect(normalizedToValue(REVERB_PARAMS.preDelay, 0.5)).toBeCloseTo(40, 6);
  });

  it('names the six types, hall by default', () => {
    expect(REVERB_TYPE_LABELS).toEqual(['ROOM', 'HALL', 'PLATE', 'SPRING', 'SHIMMER', 'AMBIENT']);
    expect(DEFAULT_REVERB_TYPE).toBe(1);
  });

  it('labels the fifth knob for each type, keeping its id, range and default', () => {
    expect(REVERB_CHARACTER_LABELS).toEqual(['EARLY', 'MOD', 'MOD', 'DRIP', 'SHIMMER', 'BLOOM']);
    expect(REVERB_CHARACTER_SPECS.map((spec) => spec.label)).toEqual([...REVERB_CHARACTER_LABELS]);
    for (const spec of REVERB_CHARACTER_SPECS) {
      expect({ ...spec, label: '' }).toEqual({ ...REVERB_PARAMS.character, label: '' });
    }
  });

  it('maps DECAY onto each type\'s own range of seconds, as ReverbProcessor::decaySeconds does', () => {
    expect(reverbDecaySeconds(1, 0)).toBeCloseTo(0.8, 9);
    expect(reverbDecaySeconds(1, 100)).toBeCloseTo(10, 9);
    expect(reverbDecaySeconds(1, 50)).toBeCloseTo(Math.sqrt(8), 9);
    expect(reverbDecaySeconds(0, 0)).toBeCloseTo(0.2, 9);
    expect(reverbDecaySeconds(5, 100)).toBeCloseTo(30, 9);
    expect(reverbDecaySeconds(4, 50)).toBeCloseTo(Math.sqrt(30), 9);
    expect(reverbDecaySeconds(1, 500)).toBeCloseTo(10, 9);
    expect(reverbDecaySeconds(1, -5)).toBeCloseTo(0.8, 9);
  });

  it('reads DECAY out in seconds for the current type', () => {
    expect(formatReverbDecay(1, 50)).toBe('2.8 s');
    expect(formatReverbDecay(1, 100)).toBe('10 s');
    expect(formatReverbDecay(5, 100)).toBe('30 s');
    expect(formatReverbDecay(5, 50)).toBe('9.5 s');
    expect(formatReverbDecay(0, 0)).toBe('0.2 s');
    expect(formatReverbDecay(4, 50)).toBe('5.5 s');
  });

  it('formats the other knobs at min, default and max', () => {
    expect(formatValue(REVERB_PARAMS.mix, 30)).toBe('30 %');
    expect(formatValue(REVERB_PARAMS.preDelay, 0)).toBe('0.0 ms');
    expect(formatValue(REVERB_PARAMS.preDelay, 20)).toBe('20 ms');
    expect(formatValue(REVERB_PARAMS.preDelay, 250)).toBe('250 ms');
    expect(formatValue(REVERB_PARAMS.character, 100)).toBe('100 %');
  });
});

describe('tremolo params', () => {
  it('sits in the slot after the reverb, the three knobs first and the wave fourth', () => {
    expect(TREMOLO_SLOT).toBe(NAM_SLOT_COUNT + 4);
    expect(PARAM_INDEX.slotBase + TREMOLO_SLOT * PARAMS_PER_SLOT).toBe(38);
    expect(TREMOLO_PARAM_INDEX).toEqual({ level: 0, rate: 1, depth: 2 });
    expect(TREMOLO_WAVE_INDEX).toBe(3);
  });

  it('has the spec ranges, defaults and legends', () => {
    const t = TREMOLO_PARAMS;
    expect([t.level.min, t.level.max, t.level.default, t.level.label, t.level.unit]).toEqual([-24, 24, 0, 'LEVEL', 'dB']);
    expect(t.level.detent).toBe(0);
    expect([t.rate.min, t.rate.max, t.rate.default, t.rate.label, t.rate.unit]).toEqual([0.5, 15, 4, 'RATE', 'Hz']);
    expect([t.depth.min, t.depth.max, t.depth.default, t.depth.label, t.depth.unit]).toEqual([0, 100, 50, 'DEPTH', '%']);
  });

  it('puts 4 Hz at mid travel on the rate knob', () => {
    expect(normalizedToValue(TREMOLO_PARAMS.rate, 0.5)).toBeCloseTo(4, 6);
  });

  it('formats the knobs at min, default and max', () => {
    expect(formatValue(TREMOLO_PARAMS.rate, 0.5)).toBe('0.50 Hz');
    expect(formatValue(TREMOLO_PARAMS.rate, 4)).toBe('4.00 Hz');
    expect(formatValue(TREMOLO_PARAMS.rate, 15)).toBe('15 Hz');
    expect(formatValue(TREMOLO_PARAMS.depth, 50)).toBe('50 %');
    expect(formatValue(TREMOLO_PARAMS.level, 0)).toBe('0.0 dB');
    expect(formatValue(TREMOLO_PARAMS.level, 24)).toBe('+24.0 dB');
  });

  it('names the four waves, in the order the engine numbers them, sine by default', () => {
    expect(TREMOLO_WAVE_NAMES).toEqual(['Sine', 'Triangle', 'Square', 'Saw']);
    expect(DEFAULT_TREMOLO_WAVE).toBe(0);
  });
});
