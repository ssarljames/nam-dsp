import { describe, expect, it } from 'vitest';
import { DEFAULT_DRIVE, DEFAULT_REVERB, DEFAULT_TREMOLO, sanitiseControls } from '../state/persistence';
import {
  applyControlsToEngine,
  applyEffectsToEngine,
  reverbEngineState,
  writeChorusParams,
  writeDelayParams,
  writeDriveParams,
  writeReverbParams,
  writeTremoloParams,
  type EngineTarget,
} from './applyControls';
import { CORE_PARAMS, DRIVE_SLOT, NAM_SLOT_COUNT, REVERB_SLOT, TREMOLO_SLOT, type CoreParamId } from './params';
import type { PostEffectId, StageId } from './engineMessages';

function fakeEngine() {
  const params = new Map<string, number>();
  const slots = new Map<string, number>();
  const nam: Array<[number, boolean]> = [];
  const stages: Array<[StageId, boolean]> = [];
  const orders: PostEffectId[][] = [];
  const inputs: boolean[] = [];
  /** Every structural call in the order it was made. */
  const calls: string[] = [];
  const engine: EngineTarget = {
    param: (id: CoreParamId) => ({
      get value() {
        return params.get(id) ?? Number.NaN;
      },
      set value(v: number) {
        params.set(id, v);
      },
    }),
    slotParam: (slot: number, index: number) => ({
      get value() {
        return slots.get(`${slot}:${index}`) ?? Number.NaN;
      },
      set value(v: number) {
        slots.set(`${slot}:${index}`, v);
      },
    }),
    setNamEnabled: (slot, enabled) => void nam.push([slot, enabled]),
    setStageEnabled: (stage, enabled) => {
      stages.push([stage, enabled]);
      calls.push(`stage ${stage} ${enabled}`);
    },
    setPostOrder: (order) => {
      orders.push([...order]);
      calls.push(`order ${order.join(',')}`);
    },
    setReverbInput: (open) => {
      inputs.push(open);
      calls.push(`input ${open}`);
    },
  };
  return { engine, params, slots, nam, stages, orders, inputs, calls };
}

describe('applyControlsToEngine', () => {
  it('writes every core parameter, using the default for one the state does not name', () => {
    const { engine, params } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({ params: { inputGain: 6 } }));

    expect(params.get('inputGain')).toBe(6);
    for (const id of Object.keys(CORE_PARAMS) as CoreParamId[]) {
      expect(params.has(id)).toBe(true);
    }
    expect(params.get('gateThreshold')).toBe(CORE_PARAMS.gateThreshold.default);
    expect(params.get('outputVolume')).toBe(CORE_PARAMS.outputVolume.default);
  });

  it('sets each NAM stage level and power from its entry', () => {
    const { engine, slots, nam } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({ nam: { 0: { url: 'upload:a.nam', bypassed: false, level: 4 } } }));

    expect(slots.get('0:0')).toBe(4);
    expect(nam).toContainEqual([0, true]);
  });

  it('leaves a NAM stage with no entry at level 0 and disabled', () => {
    const { engine, slots, nam } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({ nam: {} }));

    for (let slot = 0; slot < NAM_SLOT_COUNT; slot++) {
      expect(slots.get(`${slot}:0`)).toBe(0);
      expect(nam).toContainEqual([slot, false]);
    }
  });

  it('turns each core stage on or off from its bypass flag', () => {
    const { engine, stages } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({ eqBypassed: true, gateBypassed: false, cabBypassed: false }));

    expect(stages).toContainEqual(['eq', false]);
    expect(stages).toContainEqual(['gate', true]);
    expect(stages).toContainEqual(['cab', true]);
  });

  it('never touches the live state — there is no such call on the target', () => {
    const { engine } = fakeEngine();
    expect(Object.keys(engine).sort()).toEqual([
      'param',
      'setNamEnabled',
      'setPostOrder',
      'setReverbInput',
      'setStageEnabled',
      'slotParam',
    ]);
  });

  it('sets the delay params and powers the stage only when it is placed and not bypassed', () => {
    const placed = fakeEngine();
    applyControlsToEngine(
      placed.engine,
      sanitiseControls({ delay: { present: true, bypassed: false, level: 50, time: 200, feedback: 40 } }),
    );
    expect(placed.slots.get('1:0')).toBe(50);
    expect(placed.slots.get('1:1')).toBe(200);
    expect(placed.slots.get('1:2')).toBe(40);
    expect(placed.stages).toContainEqual(['delay', true]);

    const bypassed = fakeEngine();
    applyControlsToEngine(bypassed.engine, sanitiseControls({ delay: { present: true, bypassed: true } }));
    expect(bypassed.stages).toContainEqual(['delay', false]);

    const none = fakeEngine();
    applyControlsToEngine(none.engine, sanitiseControls({}));
    expect(none.stages).toContainEqual(['delay', false]);
  });

  it('sets the chorus params and powers the stage only when it is placed and not bypassed', () => {
    const placed = fakeEngine();
    applyControlsToEngine(
      placed.engine,
      sanitiseControls({ chorus: { present: true, bypassed: false, level: 65, rate: 1.5, depth: 40 } }),
    );
    expect(placed.slots.get('2:0')).toBe(65);
    expect(placed.slots.get('2:1')).toBe(1.5);
    expect(placed.slots.get('2:2')).toBe(40);
    expect(placed.stages).toContainEqual(['chorus', true]);

    const bypassed = fakeEngine();
    applyControlsToEngine(bypassed.engine, sanitiseControls({ chorus: { present: true, bypassed: true } }));
    expect(bypassed.stages).toContainEqual(['chorus', false]);

    const none = fakeEngine();
    applyControlsToEngine(none.engine, sanitiseControls({}));
    expect(none.stages).toContainEqual(['chorus', false]);
  });

  it('tells the engine the whole order of the POST effects', () => {
    const swapped = fakeEngine();
    applyControlsToEngine(swapped.engine, sanitiseControls({ effectOrder: ['reverb', 'tremolo', 'delay', 'chorus'] }));
    expect(swapped.orders).toEqual([['reverb', 'tremolo', 'delay', 'chorus']]);

    const beforeTremolo = fakeEngine();
    applyControlsToEngine(beforeTremolo.engine, sanitiseControls({ effectOrder: ['reverb', 'delay', 'chorus'] }));
    expect(beforeTremolo.orders).toEqual([['reverb', 'delay', 'chorus', 'tremolo']]);

    const old = fakeEngine();
    applyControlsToEngine(old.engine, sanitiseControls({ effectOrder: ['delay', 'chorus'] }));
    expect(old.orders).toEqual([['delay', 'chorus', 'tremolo', 'reverb']]);

    const plain = fakeEngine();
    applyControlsToEngine(plain.engine, sanitiseControls({}));
    expect(plain.orders).toEqual([['chorus', 'tremolo', 'delay', 'reverb']]);
  });
});

describe('writeDelayParams', () => {
  it('writes level, time and feedback to slot 1 and touches nothing else', () => {
    const { engine, slots, params, stages } = fakeEngine();
    writeDelayParams(engine, { present: true, bypassed: false, level: 12, time: 345, feedback: 67 });
    expect([...slots.entries()].sort()).toEqual([
      ['1:0', 12],
      ['1:1', 345],
      ['1:2', 67],
    ]);
    expect(params.size).toBe(0);
    expect(stages).toEqual([]);
  });
});

describe('writeChorusParams', () => {
  it('writes level, rate and depth to slot 2 and touches nothing else', () => {
    const { engine, slots, params, stages, orders } = fakeEngine();
    writeChorusParams(engine, { present: true, bypassed: false, level: 12, rate: 3.4, depth: 56 });
    expect([...slots.entries()].sort()).toEqual([
      ['2:0', 12],
      ['2:1', 3.4],
      ['2:2', 56],
    ]);
    expect(params.size).toBe(0);
    expect(stages).toEqual([]);
    expect(orders).toEqual([]);
  });
});

describe('the drive', () => {
  it('writes its four values to slot 3', () => {
    const { engine, slots } = fakeEngine();
    writeDriveParams(engine, { present: true, bypassed: false, level: -3, gain: 40, tone: 70, type: 2 });
    expect(slots.get(`${DRIVE_SLOT}:0`)).toBe(-3);
    expect(slots.get(`${DRIVE_SLOT}:1`)).toBe(40);
    expect(slots.get(`${DRIVE_SLOT}:2`)).toBe(70);
    expect(slots.get(`${DRIVE_SLOT}:3`)).toBe(2);
  });

  it('powers the stage only when placed and not bypassed', () => {
    const placed = fakeEngine();
    applyControlsToEngine(placed.engine, sanitiseControls({ drive: { present: true, bypassed: false, gain: 33 } }));
    expect(placed.stages).toContainEqual(['drive', true]);
    expect(placed.slots.get(`${DRIVE_SLOT}:1`)).toBe(33);

    const bypassed = fakeEngine();
    applyControlsToEngine(bypassed.engine, sanitiseControls({ drive: { present: true, bypassed: true } }));
    expect(bypassed.stages).toContainEqual(['drive', false]);
  });

  it('switches a placed drive off when a state without one is applied', () => {
    const { engine, stages } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({ drive: { present: true } }));
    applyControlsToEngine(engine, sanitiseControls({}));
    expect(stages.filter(([stage]) => stage === 'drive').at(-1)).toEqual(['drive', false]);
  });
});

describe('applyEffectsToEngine', () => {
  it('pushes the drive and the POST effects, their power and their order, and nothing else', () => {
    const { engine, slots, params, nam, stages, orders } = fakeEngine();
    applyEffectsToEngine(
      engine,
      sanitiseControls({
        chorus: { present: true, bypassed: true, level: 11, rate: 0.5, depth: 22 },
        delay: { present: true, bypassed: false, level: 33, time: 444, feedback: 55 },
        effectOrder: ['delay', 'chorus'],
      }),
    );
    expect([...slots.entries()].sort()).toEqual([
      ['1:0', 33],
      ['1:1', 444],
      ['1:2', 55],
      ['2:0', 11],
      ['2:1', 0.5],
      ['2:2', 22],
      [`${DRIVE_SLOT}:0`, DEFAULT_DRIVE.level],
      [`${DRIVE_SLOT}:1`, DEFAULT_DRIVE.gain],
      [`${DRIVE_SLOT}:2`, DEFAULT_DRIVE.tone],
      [`${DRIVE_SLOT}:3`, DEFAULT_DRIVE.type],
      [`${REVERB_SLOT}:0`, DEFAULT_REVERB.mix],
      [`${REVERB_SLOT}:1`, DEFAULT_REVERB.decay],
      [`${REVERB_SLOT}:2`, DEFAULT_REVERB.tone],
      [`${REVERB_SLOT}:3`, DEFAULT_REVERB.preDelay],
      [`${REVERB_SLOT}:4`, DEFAULT_REVERB.character],
      [`${REVERB_SLOT}:5`, DEFAULT_REVERB.type],
      [`${TREMOLO_SLOT}:0`, DEFAULT_TREMOLO.level],
      [`${TREMOLO_SLOT}:1`, DEFAULT_TREMOLO.rate],
      [`${TREMOLO_SLOT}:2`, DEFAULT_TREMOLO.depth],
      [`${TREMOLO_SLOT}:3`, DEFAULT_TREMOLO.wave],
    ]);
    expect(stages).toEqual([
      ['drive', false],
      ['chorus', false],
      ['tremolo', false],
      ['delay', true],
      ['reverb', false],
    ]);
    expect(orders).toEqual([['delay', 'chorus', 'tremolo', 'reverb']]);
    expect(params.size).toBe(0);
    expect(nam).toEqual([]);
  });
});

describe('the reverb', () => {
  const reverb = { present: true, bypassed: false, trails: true, mix: 40, decay: 60, tone: 30, preDelay: 75, character: 90, type: 5 };

  it('writes its six values to slot 4 and touches nothing else', () => {
    const { engine, slots } = fakeEngine();
    writeReverbParams(engine, sanitiseControls({ reverb }).reverb);
    expect([...slots.entries()].sort()).toEqual([
      [`${REVERB_SLOT}:0`, 40],
      [`${REVERB_SLOT}:1`, 60],
      [`${REVERB_SLOT}:2`, 30],
      [`${REVERB_SLOT}:3`, 75],
      [`${REVERB_SLOT}:4`, 90],
      [`${REVERB_SLOT}:5`, 5],
    ]);
  });

  it('keeps the stage on through a bypass only with trails, and opens the input only when powered', () => {
    const state = (present: boolean, bypassed: boolean, trails: boolean) => reverbEngineState({ present, bypassed, trails });
    // Placed and on: running and listening, whatever trails says.
    expect(state(true, false, true)).toEqual({ enabled: true, inputOpen: true });
    expect(state(true, false, false)).toEqual({ enabled: true, inputOpen: true });
    // Bypassed with trails: still running so the tail rings out, but deaf.
    expect(state(true, true, true)).toEqual({ enabled: true, inputOpen: false });
    // Bypassed without trails: off, so the tail is cut.
    expect(state(true, true, false)).toEqual({ enabled: false, inputOpen: false });
    // Not placed: off, whatever else.
    expect(state(false, false, true).enabled).toBe(false);
    expect(state(false, true, true).enabled).toBe(false);
    expect(state(false, false, false).enabled).toBe(false);
  });

  it('sends the input before the stage, so a reset on enabling sees it', () => {
    const { engine, calls } = fakeEngine();
    applyEffectsToEngine(engine, sanitiseControls({ reverb: { ...reverb, bypassed: true } }));
    const input = calls.indexOf('input false');
    const stage = calls.indexOf('stage reverb true');
    expect(input).toBeGreaterThanOrEqual(0);
    expect(stage).toBeGreaterThan(input);
  });

  it('switches a placed reverb off when a state without one is applied', () => {
    const { engine, stages } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({}));
    expect(stages).toContainEqual(['reverb', false]);
  });
});

describe('the tremolo', () => {
  it('writes its four values to slot 5 and touches nothing else', () => {
    const { engine, slots, params, stages, orders } = fakeEngine();
    writeTremoloParams(engine, { present: true, bypassed: false, level: -4, rate: 7.5, depth: 85, wave: 3 });
    expect([...slots.entries()].sort()).toEqual([
      [`${TREMOLO_SLOT}:0`, -4],
      [`${TREMOLO_SLOT}:1`, 7.5],
      [`${TREMOLO_SLOT}:2`, 85],
      [`${TREMOLO_SLOT}:3`, 3],
    ]);
    expect(params.size).toBe(0);
    expect(stages).toEqual([]);
    expect(orders).toEqual([]);
  });

  it('powers the stage only when placed and not bypassed', () => {
    const placed = fakeEngine();
    applyControlsToEngine(placed.engine, sanitiseControls({ tremolo: { present: true, bypassed: false, rate: 9 } }));
    expect(placed.stages).toContainEqual(['tremolo', true]);
    expect(placed.slots.get(`${TREMOLO_SLOT}:1`)).toBe(9);

    const bypassed = fakeEngine();
    applyControlsToEngine(bypassed.engine, sanitiseControls({ tremolo: { present: true, bypassed: true } }));
    expect(bypassed.stages).toContainEqual(['tremolo', false]);
  });

  it('switches a placed tremolo off when a state without one is applied', () => {
    const { engine, stages } = fakeEngine();
    applyControlsToEngine(engine, sanitiseControls({ tremolo: { present: true } }));
    applyControlsToEngine(engine, sanitiseControls({}));
    expect(stages.filter(([stage]) => stage === 'tremolo').at(-1)).toEqual(['tremolo', false]);
  });
});
