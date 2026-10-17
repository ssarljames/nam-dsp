# Fixed noise gate — one knob, first in the chain

**Date:** 2026-09-22
**Status:** Approved.
**Refines:** [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §5.2 and
[2026-09-22-rack-rewire-design.md](2026-09-22-rack-rewire-design.md) §2, §4, §5.

---

## 1. Scope

The rack already has a NOISE GATE panel with THRESHOLD and RELEASE knobs, both unwired.
This milestone puts DSP behind it: a **fixed** gate — always at the head of the chain, one
knob, sensible fixed dynamics — for the everyday job of silencing an interface's hum and
hiss between notes.

It is deliberately not the full gate. A full-featured gate (attack, hold, release, range,
hysteresis as knobs) that can be placed anywhere in the chain is a future Phase 3 slot
effect. The two are separate processors; this one is a core stage and will stay one.

In scope:

- `GateProcessor` in the C++ engine, first in the chain, toggleable
- `gateThreshold` as a new core parameter
- A generic `setStageEnabled` command replacing `setEqEnabled`
- The gate's bypass persisted; `GatePanel` wired to the engine

Out of scope: a gate-open LED or any engine→UI gate telemetry, the full movable gate, a
crossfade on engage/bypass (rack-rewire §8 known gap), and the cab/IR stage (next
milestone, after a feasibility spike).

---

## 2. Chain position — before INPUT GAIN

```
Gate → InputGain → Nam[0 .. kNamCount-1] → Eq → OutputVolume
```

Rack-rewire §2 placed the gate "before the NAM stages". This refines it to before
INPUT GAIN too, for one reason: the input meter beside THRESHOLD taps the signal **before
the worklet** (spec §5.1), so it shows the level ahead of input gain. With the gate first,
THRESHOLD and the meter are in the same units — set −50 dB, and the gate opens where the
meter crosses −50 dB — and turning INPUT GAIN up does not move the gate point. It is also
where a gate sits on a real pedalboard: at the guitar end.

---

## 3. DSP — `GateProcessor`

A core processor, not a slot occupant. Per sample:

**Detector.** Peak envelope follower on `|x|`: instant rise, 10 ms time-constant fall.
Tracks a picked note's envelope without following individual waveform cycles.

**Decision, with hysteresis and hold.**

- The gate **opens** when the envelope rises above THRESHOLD.
- It **closes** only when the envelope has been below THRESHOLD − 6 dB for a continuous
  10 ms hold. Any sample back above the close point restarts the hold.

Hysteresis keeps a decaying note that hovers around the threshold from chattering; hold
keeps a momentary dip from closing it.

**Gain.** One-pole smoothed between unity (open) and −90 dB (closed), with a separate
coefficient per direction:

| Direction | Time constant | Why |
|---|---|---|
| Opening | 0.5 ms | Fast enough not to soften the pick attack |
| Closing | 100 ms | The note decays rather than being chopped |

**Threshold** is not smoothed. It feeds a comparison, not a gain, so a k-rate step in it
cannot zipper.

**Threshold at minimum disables the gate.** The range is −80 … 0 dB, default −60 dB. At
−80 dB the existing formatter already prints `−∞ dB`; the processor makes that literal —
at (or below) the range minimum the gate is held fully open and never closes, even on
digital silence.

**No LEVEL knob.** Open, the gate passes at unity, so there is no engaged loudness to
match against bypass. This is the one switchable stage without an engaged level
(rack-rewire §3), by design.

**Real-time safety** (spec §5.3):

- Every coefficient is derived in `prepare()` from the sample rate; `process()` allocates,
  locks and throws nothing.
- The envelope is a decaying feedback state, the exact case rule 4 warns about: it is
  flushed to 0 below 1e-12. The gain cannot denormal — it bottoms out at −90 dB.

**Reset and bypass.** `reset()` leaves the gate **fully open** (envelope 0, gain unity, hold
cleared), so engaging it never starts closed and swallows the first note. Bypassed, the
stage is not run at all — `ProcessorChain` already skips a disabled processor.

---

## 4. Parameter block — 55 floats

`gateThreshold` is a **core** parameter, appended after `outputVolume`:

| index | parameter |
|---|---|
| 0 | inputGain |
| 1–3 | bass, mid, treble |
| 4 | eqLevel |
| 5 | outputVolume |
| **6** | **gateThreshold** (new) |
| 7–54 | slot pool, 8 × 6 (was 6–53) |

Only the slot base moves. Rejected alternatives:

- **Index 0, in signal order.** Shifts every existing index for no gain — the block is
  not in signal order anyway (the EQ sits at 1–4 and runs last).
- **A pool slot.** The pool is for movable effects, and the future full gate belongs
  there. The fixed gate taking a slot would blur that line and cost a slot.

C++: `Engine.h` gains `kGateThresholdIndex = 6`; `kSlotBaseIndex` becomes 7 and
`kParamCount` 55. The static-assert chain gains "the gate sits immediately after
`outputVolume`" and "the pool starts immediately after the gate". `bindings.cpp` exports
`getGateThresholdIndex()`, and the worklet's instantiation-time layout checks gain a
`gateThreshold` entry.

TypeScript: `gateThreshold` moves from `GATE_PARAMS` into `CORE_PARAMS` and
`CORE_PARAM_ORDER` (after `outputVolume`); `PARAM_INDEX` gains `gateThreshold`.
`gateRelease` is deleted, and with it `GATE_PARAMS` and `GateParamId`. Stored control
values are keyed by id, so saved settings survive the renumbering; a stored
`gateRelease` value is simply ignored.

---

## 5. Stage enable — `setStageEnabled`

Rack-rewire §5 deferred a generic enable command until "the gate arrives as the third"
switchable stage. It has. `setEqEnabled` is **replaced** end to end by:

```ts
{ type: 'setStageEnabled'; stage: 'gate' | 'eq'; enabled: boolean }
```

- `engineMessages.ts`: the command union, with `StageId = 'gate' | 'eq'`
- worklet: one `case 'setStageEnabled'` mapping the id to the engine's numeric stage id
- `AudioEngine.setStageEnabled(stage, enabled)` replaces `setEqEnabled`
- C++: `enum class Stage : int32_t { Gate = 0, Eq = 1 }`;
  `Engine::setStageEnabled(Stage, bool)`; binding `setStageEnabled(int32_t, bool)` ignores
  an unknown id. The TS→numeric mapping lives in one table in the worklet.

NAM keeps its own slot-indexed `setEnabled`: NAM stages are numbered, core stages named.

The gate starts **disabled** in the engine; the EQ starts enabled, as today.

---

## 6. Persistence

- `StoredControls` gains `gateBypassed: boolean`, defaulting to **`true`** — the gate
  starts off, as the panel does today, so nothing stored cannot surprise anyone with a
  gated signal. Sanitised like `eqBypassed`: anything other than a boolean `false` reads
  as `true`. Absent-means-default, so `STORAGE_KEY` is not bumped.
- `gateThreshold` is a core parameter, so it persists through the existing `params`
  record; `sanitiseControls` already walks every core parameter.

On start, the stored gate bypass is pushed to the engine beside the EQ's, before audio
flows.

---

## 7. UI

`GatePanel` follows `EqPanel`'s shape: it receives `engine`, `initialBypassed`, the input
meter, and the threshold knob already wired to its core `AudioParam` by the screen
(`coreKnob('gateThreshold')`). Its switch calls `engine.setStageEnabled('gate', …)` and
`updateControls({ gateBypassed })`. The RELEASE knob is removed; the panel stays narrow,
meter beside the knob. Its doc comment stops describing itself as unwired.

---

## 8. Verification

Host C++ — new `engine/tests/test_gate_processor.cpp`:

- **Opens and passes at unity:** a −20 dB sine with the threshold at −40 dB is output
  equal to input once the attack has settled
- **Closes to the floor:** silence, and a −70 dB sine, with the threshold at −40 dB settle
  to ≤ −90 dB relative to input within a few release time constants
- **Hysteresis:** once open, a signal 3 dB below threshold keeps it open; 8 dB below
  closes it
- **Hold:** after the signal drops below the close point, gain stays at unity for ~10 ms
  before it begins to fall
- **Minimum threshold** never closes, even on digital silence
- **Finite and flushed:** after a long silence the output is finite and the envelope state
  is exactly 0
- **Reset reopens:** after `reset()` the first block passes at unity

Host C++ — `engine/tests/test_engine.cpp`:

- the layout is 55 floats, `gateThreshold` at 6, pool at 7
- the chain is `Gate → InputGain → Nam → Eq → OutputVolume`, the gate bound to offset 6
- the gate starts disabled; `setStageEnabled` flips gate and EQ independently; an unknown
  stage id changes nothing
- the existing EQ-bypass test moves to `setStageEnabled`

Vitest:

- `PARAM_COUNT === 55`, `PARAM_INDEX.gateThreshold === 6`, `PARAM_INDEX.slotBase === 7`
- taper round-trip and formatter tests cover `gateThreshold` as a core param
- `gateBypassed` sanitisation: absent → `true`, non-boolean → `true`, `false` survives

By ear, guitar and headphones:

- gate engaged, hands off the strings: hum and hiss vanish
- a picked note's attack is untouched
- a sustained chord decays naturally, with no chatter near the threshold
- turning INPUT GAIN up does not change where the gate opens
- THRESHOLD fully down (`−∞ dB`) is indistinguishable from bypass
- bypass and threshold survive a reload

---

## 9. Risks

| Risk | Handling |
|---|---|
| Layout drift between C++ and TS as the slot base moves | Static asserts in `Engine.h`, plus the new `gateThreshold` entry in the worklet's instantiation-time layout checks |
| A fixed 100 ms close sounds wrong on some material | The constants live together in `GateProcessor.h`; tuning is a one-line change. Per-user control is the full gate's job |
| Engage/bypass clicks | Known gap shared with every stage (rack-rewire §8); not addressed here |
