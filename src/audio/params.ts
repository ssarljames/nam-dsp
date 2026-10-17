/**
 * Single source of truth for every parameter: range, default, taper, step,
 * detent and display formatting.
 *
 * The ORDER of PARAM_ORDER is a contract with the C++ engine. Index i here is
 * index i in the engine's 56-float param block (engine/Engine.h, kParamCount).
 * Changing the order means changing both sides.
 */

export const SLOT_COUNT = 8;
export const PARAMS_PER_SLOT = 6;

/**
 * NAM stages in the chain, mirroring Engine::kNamCount. Each one occupies a
 * pooled slot, so chaining several models (a drive model, an amp, a cab) is a
 * change to this number on both sides rather than to the parameter layout.
 */
export const NAM_SLOT_COUNT = 1;

export type Taper =
  | { kind: 'linear' }
  /** `center` is the value that sits at half travel. Units are the param's own. */
  | { kind: 'skewed'; center: number };

export type ParamUnit = 'dB' | 'ms' | 'Hz' | '%' | '';

export interface ParamSpec {
  id: string;
  /** Screen-printed legend on the panel. */
  label: string;
  unit: ParamUnit;
  min: number;
  max: number;
  default: number;
  taper: Taper;
  /** Wheel and arrow-key increment, in value units. */
  step: number;
  /** Value that gets a magnetic centre detent, if any. */
  detent?: number;
  /** Draws the value arc from the centre rather than from the minimum. */
  bipolar?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function skewFor(spec: ParamSpec, center: number): number {
  const c = (center - spec.min) / (spec.max - spec.min);
  if (!(c > 0 && c < 1)) {
    throw new Error(`${spec.id}: skew centre ${center} must lie strictly inside its range`);
  }
  return Math.log(0.5) / Math.log(c);
}

export function normalizedToValue(spec: ParamSpec, n: number): number {
  const t = clamp(n, 0, 1);
  if (spec.taper.kind === 'linear') return spec.min + t * (spec.max - spec.min);
  const skew = skewFor(spec, spec.taper.center);
  return spec.min + (spec.max - spec.min) * Math.pow(t, 1 / skew);
}

export function valueToNormalized(spec: ParamSpec, v: number): number {
  const t = clamp((v - spec.min) / (spec.max - spec.min), 0, 1);
  if (spec.taper.kind === 'linear') return t;
  const skew = skewFor(spec, spec.taper.center);
  return Math.pow(t, skew);
}

const MINUS = '−'; // U+2212 MINUS SIGN — not a hyphen. The panel is typeset, not monospaced.

function formatDb(spec: ParamSpec, v: number): string {
  if (v <= spec.min && spec.min <= -60) return `${MINUS}∞ dB`;
  const rounded = Math.abs(v) < 0.05 ? 0 : v;
  const sign = rounded > 0 ? '+' : rounded < 0 ? MINUS : '';
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}

export function formatValue(spec: ParamSpec, v: number): string {
  switch (spec.unit) {
    case 'dB':
      return formatDb(spec, v);
    case 'ms':
      return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
    case 'Hz':
      return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v.toFixed(v < 10 ? 2 : 0)} Hz`;
    case '%':
      return `${Math.round(v)} %`;
    default:
      return v.toFixed(2);
  }
}

/**
 * Engaged level: gain applied only while its stage is on, so the engaged sound
 * can be matched against bypass. Every switchable stage carries one, each with
 * its own id, so this is a factory rather than a single spec.
 */
export function levelSpec(id: string): ParamSpec {
  return {
    id,
    label: 'LEVEL',
    unit: 'dB',
    min: -24,
    max: 24,
    default: 0,
    taper: { kind: 'linear' },
    step: 0.5,
    detent: 0,
    bipolar: true,
  };
}

export type CoreParamId =
  | 'inputGain'
  | 'bass'
  | 'mid'
  | 'treble'
  | 'eqLevel'
  | 'outputVolume'
  | 'gateThreshold'
  | 'cabLevel';

export const CORE_PARAMS: Record<CoreParamId, ParamSpec> = {
  inputGain: {
    id: 'inputGain',
    // Sits beside the INPUT device selector, so "INPUT" on the knob too would
    // read twice.
    label: 'GAIN',
    unit: 'dB',
    min: -24,
    max: 24,
    default: 0,
    // dB is already the audio taper for a gain control; unity sits at mid travel.
    taper: { kind: 'linear' },
    step: 0.5,
    detent: 0,
    bipolar: true,
  },
  bass: {
    id: 'bass',
    label: 'BASS',
    unit: 'dB',
    min: -12,
    max: 12,
    default: 0,
    taper: { kind: 'linear' },
    step: 0.5,
    detent: 0,
    bipolar: true,
  },
  mid: {
    id: 'mid',
    label: 'MID',
    unit: 'dB',
    min: -12,
    max: 12,
    default: 0,
    taper: { kind: 'linear' },
    step: 0.5,
    detent: 0,
    bipolar: true,
  },
  treble: {
    id: 'treble',
    label: 'TREBLE',
    unit: 'dB',
    min: -12,
    max: 12,
    default: 0,
    taper: { kind: 'linear' },
    step: 0.5,
    detent: 0,
    bipolar: true,
  },
  // The EQ's engaged level: the last float of the EQ's slice in the engine.
  eqLevel: levelSpec('eqLevel'),
  outputVolume: {
    id: 'outputVolume',
    // Sits beside the OUTPUT device selector, so "OUTPUT" on the knob too would
    // read twice.
    label: 'VOLUME',
    unit: 'dB',
    min: -60,
    max: 6,
    default: -6,
    // Linear in dB across -60..+6 would bunch every useful setting into the top
    // tenth of the travel. The skew puts -12 dB at half rotation.
    taper: { kind: 'skewed', center: -12 },
    step: 0.5,
  },
  // The fixed gate at the head of the chain. It runs before input gain, so
  // this is in the same units as the input meter beside it. At the minimum
  // the formatter prints −∞ dB and the engine holds the gate open.
  gateThreshold: {
    id: 'gateThreshold',
    label: 'THRESHOLD',
    unit: 'dB',
    min: -80,
    max: 0,
    default: -60,
    taper: { kind: 'linear' },
    step: 1,
  },
  // The cab's engaged level: the single float of its slice in the engine. Like
  // every stage level it applies only while the stage is on.
  cabLevel: levelSpec('cabLevel'),
};

export const CORE_PARAM_ORDER: readonly CoreParamId[] = [
  'inputGain',
  'bass',
  'mid',
  'treble',
  'eqLevel',
  'outputVolume',
  'gateThreshold',
  'cabLevel',
];

/**
 * The delay's pooled slot: the first one after the NAM stages. Mirrors
 * Engine::kDelaySlot in engine/Engine.h.
 */
export const DELAY_SLOT = NAM_SLOT_COUNT;

export type DelayParamId = 'level' | 'time' | 'feedback';

/** Which of the slot's params (slotN_p<index>) each control drives. Mirrors DelayProcessor::setParams. */
export const DELAY_PARAM_INDEX: Record<DelayParamId, number> = { level: 0, time: 1, feedback: 2 };

/**
 * Ranges match DelayProcessor: the processor clamps to the same limits, so a
 * value outside them can never reach the loop. The feedback cap sits below
 * 100 % so a delay cannot run away.
 */
export const DELAY_PARAMS: Record<DelayParamId, ParamSpec> = {
  level: {
    id: 'delayLevel',
    label: 'LEVEL',
    unit: '%',
    min: 0,
    max: 100,
    default: 30,
    taper: { kind: 'linear' },
    step: 1,
  },
  time: {
    id: 'delayTime',
    label: 'TIME',
    unit: 'ms',
    min: 20,
    max: 1000,
    default: 350,
    // Linear across 20..1000 ms would bunch the useful slapback and short
    // settings into the bottom tenth. The skew puts 250 ms at half travel.
    taper: { kind: 'skewed', center: 250 },
    step: 5,
  },
  feedback: {
    id: 'delayFeedback',
    label: 'FEEDBACK',
    unit: '%',
    min: 0,
    max: 90,
    default: 35,
    taper: { kind: 'linear' },
    step: 1,
  },
};

/**
 * The chorus's pooled slot: the one after the delay's. Mirrors
 * Engine::kChorusSlot in engine/Engine.h.
 */
export const CHORUS_SLOT = NAM_SLOT_COUNT + 1;

export type ChorusParamId = 'level' | 'rate' | 'depth';

/** Which of the slot's params (slotN_p<index>) each control drives. Mirrors ChorusProcessor::setParams. */
export const CHORUS_PARAM_INDEX: Record<ChorusParamId, number> = { level: 0, rate: 1, depth: 2 };

/** Ranges match ChorusProcessor, which clamps to the same limits. */
export const CHORUS_PARAMS: Record<ChorusParamId, ParamSpec> = {
  level: {
    id: 'chorusLevel',
    label: 'LEVEL',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
  rate: {
    id: 'chorusRate',
    label: 'RATE',
    unit: 'Hz',
    min: 0.05,
    max: 5,
    default: 0.8,
    // Linear across 0.05..5 Hz would crowd the slow, musical sweeps into the
    // first sixth of the travel. The skew puts 0.8 Hz at half travel.
    taper: { kind: 'skewed', center: 0.8 },
    step: 0.05,
  },
  depth: {
    id: 'chorusDepth',
    label: 'DEPTH',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
};

/**
 * The drive's pooled slot: the one after the chorus's. Mirrors
 * Engine::kDriveSlot in engine/Engine.h.
 */
export const DRIVE_SLOT = NAM_SLOT_COUNT + 2;

export type DriveParamId = 'level' | 'gain' | 'tone';

/** Which of the slot's params each knob drives. Mirrors DriveProcessor::setParams. */
export const DRIVE_PARAM_INDEX: Record<DriveParamId, number> = { level: 0, gain: 1, tone: 2 };

/** The clipping type is the slot's fourth param: 0 SOFT, 1 HARD, 2 ASYM. */
export const DRIVE_TYPE_INDEX = 3;

export type DriveType = 0 | 1 | 2;

/** The switch's legends, in type order. */
export const DRIVE_TYPE_LABELS = Object.freeze(['SOFT', 'HARD', 'ASYM'] as const);

export const DEFAULT_DRIVE_TYPE: DriveType = 0;

/** Ranges match DriveProcessor, which clamps to the same limits. */
export const DRIVE_PARAMS: Record<DriveParamId, ParamSpec> = {
  level: levelSpec('driveLevel'),
  gain: {
    id: 'driveGain',
    label: 'GAIN',
    unit: 'dB',
    min: 6,
    max: 48,
    default: 27,
    taper: { kind: 'linear' },
    step: 0.5,
  },
  tone: {
    id: 'driveTone',
    label: 'TONE',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
};

/**
 * The reverb's pooled slot: the one after the drive's. Mirrors
 * Engine::kReverbSlot in engine/Engine.h.
 */
export const REVERB_SLOT = NAM_SLOT_COUNT + 3;

export type ReverbParamId = 'mix' | 'decay' | 'tone' | 'preDelay' | 'character';

/** Which of the slot's params each knob drives. Mirrors ReverbProcessor::setParams. */
export const REVERB_PARAM_INDEX: Record<ReverbParamId, number> = { mix: 0, decay: 1, tone: 2, preDelay: 3, character: 4 };

/** The type is the slot's sixth param: 0 ROOM, 1 HALL, 2 PLATE, 3 SPRING, 4 SHIMMER, 5 AMBIENT. */
export const REVERB_TYPE_INDEX = 5;

export type ReverbType = 0 | 1 | 2 | 3 | 4 | 5;

/** The switch's legends, in type order. */
export const REVERB_TYPE_LABELS = Object.freeze(['ROOM', 'HALL', 'PLATE', 'SPRING', 'SHIMMER', 'AMBIENT'] as const);

export const DEFAULT_REVERB_TYPE: ReverbType = 1;

/** What the fifth knob does for each type, in type order. */
export const REVERB_CHARACTER_LABELS = Object.freeze(['EARLY', 'MOD', 'MOD', 'DRIP', 'SHIMMER', 'BLOOM'] as const);

/**
 * Each type's RT60 at DECAY 0 and 100, in seconds. Mirrors the voicings in
 * engine/ReverbProcessor.cpp; DECAY maps between them logarithmically.
 */
const REVERB_DECAY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0.2, 2.5],
  [0.8, 10],
  [0.5, 8],
  [0.4, 5],
  [1.5, 20],
  [3, 30],
];

/** RT60 in seconds for `type` at `decayPercent`, as ReverbProcessor::decaySeconds computes it. */
export function reverbDecaySeconds(type: ReverbType, decayPercent: number): number {
  const [lo, hi] = REVERB_DECAY_RANGES[type];
  const d = clamp(Number.isFinite(decayPercent) ? decayPercent : 50, 0, 100);
  return lo * Math.pow(hi / lo, d / 100);
}

/** DECAY's readout: seconds for the current type, one decimal below ten. */
export function formatReverbDecay(type: ReverbType, decayPercent: number): string {
  const seconds = reverbDecaySeconds(type, decayPercent);
  return seconds < 9.95 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

/** Ranges match ReverbProcessor, which clamps to the same limits. */
export const REVERB_PARAMS: Record<ReverbParamId, ParamSpec> = {
  mix: {
    id: 'reverbMix',
    label: 'MIX',
    unit: '%',
    min: 0,
    max: 100,
    default: 30,
    taper: { kind: 'linear' },
    step: 1,
  },
  // Stored as a percent of the type's own range; read out in seconds by
  // formatReverbDecay, which needs the type.
  decay: {
    id: 'reverbDecay',
    label: 'DECAY',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
  tone: {
    id: 'reverbTone',
    label: 'TONE',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
  preDelay: {
    id: 'reverbPreDelay',
    label: 'PRE-DELAY',
    unit: 'ms',
    min: 0,
    max: 250,
    default: 20,
    // Linear across 0..250 ms would crowd the useful short settings into the
    // first fifth. The skew puts 40 ms at half travel.
    taper: { kind: 'skewed', center: 40 },
    step: 1,
  },
  // The fifth knob. Its legend follows the type: REVERB_CHARACTER_SPECS.
  character: {
    id: 'reverbCharacter',
    label: 'MOD',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
};

/** The fifth knob's spec for each type: the same param, legended for what it does there. */
export const REVERB_CHARACTER_SPECS: readonly ParamSpec[] = Object.freeze(
  REVERB_CHARACTER_LABELS.map((label) => Object.freeze({ ...REVERB_PARAMS.character, label })),
);

/**
 * The tremolo's pooled slot: the one after the reverb's. Mirrors
 * Engine::kTremoloSlot in engine/Engine.h.
 */
export const TREMOLO_SLOT = NAM_SLOT_COUNT + 4;

export type TremoloParamId = 'level' | 'rate' | 'depth';

/** Which of the slot's params each knob drives. Mirrors TremoloProcessor::setParams. */
export const TREMOLO_PARAM_INDEX: Record<TremoloParamId, number> = { level: 0, rate: 1, depth: 2 };

/** The wave is the slot's fourth param: 0 SINE, 1 TRI, 2 SQUARE, 3 SAW. */
export const TREMOLO_WAVE_INDEX = 3;

export type TremoloWave = 0 | 1 | 2 | 3;

/** The waves' names, in wave order: the switch draws them, and these name the buttons. */
export const TREMOLO_WAVE_NAMES = Object.freeze(['Sine', 'Triangle', 'Square', 'Saw'] as const);

export const DEFAULT_TREMOLO_WAVE: TremoloWave = 0;

/** Ranges match TremoloProcessor, which clamps to the same limits. */
export const TREMOLO_PARAMS: Record<TremoloParamId, ParamSpec> = {
  level: levelSpec('tremoloLevel'),
  rate: {
    id: 'tremoloRate',
    label: 'RATE',
    unit: 'Hz',
    min: 0.5,
    max: 15,
    default: 4,
    // Linear across 0.5..15 Hz would crowd the slow, swaying speeds into the
    // first quarter of the travel. The skew puts 4 Hz at half travel.
    taper: { kind: 'skewed', center: 4 },
    step: 0.05,
  },
  depth: {
    id: 'tremoloDepth',
    label: 'DEPTH',
    unit: '%',
    min: 0,
    max: 100,
    default: 50,
    taper: { kind: 'linear' },
    step: 1,
  },
};

export function slotParamId(slot: number, param: number): string {
  return `slot${slot}_p${param}`;
}

function buildParamOrder(): readonly string[] {
  const ids: string[] = [...CORE_PARAM_ORDER];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    for (let p = 0; p < PARAMS_PER_SLOT; p++) ids.push(slotParamId(slot, p));
  }
  return Object.freeze(ids);
}

export const PARAM_ORDER = buildParamOrder();
export const PARAM_COUNT = PARAM_ORDER.length; // 56 — must equal kParamCount in engine/Engine.h

/** Byte offsets into the engine param block, mirrored in engine/Engine.h. Derived from PARAM_ORDER. */
export const PARAM_INDEX = {
  inputGain: PARAM_ORDER.indexOf('inputGain'),
  eqBase: PARAM_ORDER.indexOf('bass'), // bass, mid, treble
  eqLevel: PARAM_ORDER.indexOf('eqLevel'),
  outputVolume: PARAM_ORDER.indexOf('outputVolume'),
  gateThreshold: PARAM_ORDER.indexOf('gateThreshold'),
  cabLevel: PARAM_ORDER.indexOf('cabLevel'),
  slotBase: PARAM_ORDER.indexOf('slot0_p0'),
} as const;
