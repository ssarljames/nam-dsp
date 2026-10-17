# Tremolo — the fourth POST effect, with four waves and tap tempo

**Date:** 2026-10-06
**Status:** Approved in conversation: the approach, the engine and the signal flow (§2–§3), the
screen and the state (§4–§5), the wave icons and tap tempo on RATE (§4.3–§4.4). The verification in
§8 was not presented section by section: the user asked for implementation to go ahead, so this
document records it as decided. Implemented on the `tremolo` branch; §10 lists what was learned while
building it.
**Refines:** [2026-10-01-reverb-effect-design.md](2026-10-01-reverb-effect-design.md) (the POST order,
which this generalises from three effects to four, and the canonical preset order);
[2026-09-25-delay-effect-design.md](2026-09-25-delay-effect-design.md) (tap tempo, reused on RATE);
[2026-09-25-drive-effect-design.md](2026-09-25-drive-effect-design.md) (the type switch and the dB
LEVEL); the engine rules in [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §5.3 and §12.

---

## 1. Scope

A **Tremolo** in POST beside the Chorus, the Delay and the Reverb: a volume that rises and falls
in time. It has **LEVEL, RATE and DEPTH** knobs and a four-way **WAVE** switch, **SINE, TRI,
SQUARE and SAW**, whose buttons are drawn waveforms. A click on RATE is a tap, as on the delay's
TIME.

In scope:

- `TremoloProcessor` in the C++ engine, one pre-allocated instance, in pooled slot 5
- A POST order over **four** effects, any permutation, set in the engine between audio blocks
- The live Tremolo tray chip (today a placeholder), dropped only on POST
- A TREMOLO panel: power, remove, title handle, three knobs and the wave switch
- Tap tempo on RATE
- The stored working state and saved presets carry it, and an order stored before this feature keeps
  its meaning

Out of scope, on purpose:

- **Stereo, panning or harmonic tremolo.** The engine is mono in, processed once, duplicated to both
  outputs (main spec §5.1 and §14).
- **Locking the pulse to the taps.** Tapping sets the speed, not the phase: pinning the peaks to the
  taps would restart the wave mid-cycle on every tap, and the 15–40 ms output latency would put them
  off the beat anyway. The delay's tap tempo has the same limit.
- Subdivisions for the tap, tempo sync to a host or MIDI clock, more than one tremolo.
- The click when a stage is switched on or off, or when the order changes (the known stage-switch
  gap, rack-rewire §8).

## 2. Approach and why

The same pattern as every effect so far: one fixed processor member, pre-allocated at construction,
always in the chain and disabled until placed, its params in a pooled slot, nothing allocated in
`process()`.

Rejected: a Web Audio `OscillatorNode` driving a `GainNode` (breaks the one-WASM-worklet rule, main
spec §5); folding the tremolo into the chorus (they are placed, powered and reordered independently).

## 3. Engine

### 3.1 Chain position

```
Gate -> InputGain -> Drive -> Nam[0..kNamCount-1] -> Cab -> {Chorus, Tremolo, Delay, Reverb in any order} -> Eq -> OutputVolume
```

The default order is **Chorus, Tremolo, Delay, Reverb**: the usual pedalboard spot, modulation before
the time effects, so the echoes and the tail carry the pulse and soften it. Dragged after the Reverb,
the tail chops in time, like an amp's tremolo.

### 3.2 Slot, stage and parameters

`kTremoloSlot = kNamCount + 4` (slot 5), `kTremoloParamIndex = kSlotBaseIndex + kTremoloSlot ×
kParamsPerSlot` = 38. The 56-float block does not change. `static_assert`s keep the slot inside the
pool, clear of the NAM stages, and distinct from the other effects'. `Engine::Stage::Tremolo = 7`,
mapped from `'tremolo'` in the worklet. It starts **disabled** and is reset on the false-to-true
transition only.

| Param | Slot param | Range | Default | Notes |
|---|---|---|---|---|
| LEVEL | `slot5_p0` | −24 to +24 dB | 0 dB | Output trim, the drive's `levelSpec`: centre detent at 0. |
| RATE | `slot5_p1` | 0.5 to 15 Hz | 4 Hz | Skewed so 4 Hz sits at half travel. |
| DEPTH | `slot5_p2` | 0 to 100 % | 50 % | How far the volume falls at the bottom of the wave. |
| WAVE | `slot5_p3` | 0 to 3 | 0 | 0 SINE, 1 TRI, 2 SQUARE, 3 SAW. Rounded and clamped. |

### 3.3 Order

`setPostOrder(a, b, c)` becomes **`setPostOrder(a, b, c, d)`**, four `Stage` values.

- Anything that is not a permutation of Chorus, Tremolo, Delay and Reverb changes nothing; repeating
  the current order is a no-op.
- A real change rearranges the four chain entries at `kPostEntryIndex` with at most three
  `swapEntries` calls and **resets only the processors whose position changed**.
- It runs on the audio thread between render quanta and allocates nothing.
- The wire format is `{ type: 'setPostOrder', order: ['chorus', 'tremolo', 'delay', 'reverb'] }`.
  The worklet checks that `order` is a permutation of the four ids before calling the engine.

### 3.4 Bindings

`setPostOrder(int32_t a, int32_t b, int32_t c, int32_t d)` replaces the three-argument call, in
`bindings.cpp` and in the module typings `build-wasm.sh` writes. `setStageEnabled` already takes any
stage number. There are no trails: a tremolo has no tail, so switching it off is a plain bypass.

### 3.5 `TremoloProcessor`: signal flow

Per sample, mono:

1. **Input guard.** A non-finite sample (NaN or ±infinity) is treated as 0.
2. **The wave.** A phase `φ` in cycles (0 to 1, a `double` so it does not drift) gives `u`, from 0
   (full volume) to 1 (the bottom of the wave):

   | WAVE | `u(φ)` | Sound |
   |---|---|---|
   | SINE | `0.5 − 0.5 cos 2πφ` | Smooth, vintage |
   | TRI | `2φ` below ½, `2 − 2φ` above | A steadier, more even throb |
   | SQUARE | 0 below ½, 1 above | A hard on/off chop |
   | SAW | `1 − φ` | Swells up over the cycle, then drops (§10) |

   `φ = 0` is the top of the wave for SINE, TRI and SQUARE, and the start of the swell for SAW.
3. **Edges.** `u` passes a one-pole smoother with a fixed **2 ms** time constant (a `SmoothedValue`).
   The square's and the saw's jumps, and a WAVE change mid-cycle, become ramps of a few
   milliseconds: they chop hard but never click, at any rate. On SINE and TRI it is inaudible.
4. **Gain.** `y = x × dB(LEVEL) × (1 − DEPTH × s)`, `s` the smoothed `u`, DEPTH as 0 to 1. The top of
   the wave is the trimmed level and the bottom is `1 − DEPTH` of it, so DEPTH 100 % chops to silence.
   Like an analog tremolo it only ever turns down; LEVEL is there to make that up.
5. **Advance.** `φ += RATE / fs`, wrapping at 1. RATE is smoothed, so turning it changes the speed
   without the wave jumping.

### 3.6 Rules

- **Smoothing.** LEVEL (in dB, as the drive's) and DEPTH over 20 ms, RATE over 50 ms, inside the
  processor (main spec §5.3).
- **Storage.** None but a handful of scalars. Nothing allocates in `process()`.
- **Denormals.** No audio is fed back, so there is no decaying state to flush; the edge smoother's own
  epsilon snap keeps it out of denormal range.
- **Parameters** are clamped to their ranges; a non-finite value reads as the default. WAVE is
  rounded, then clamped.
- **`reset()`** restarts `φ` at 0 and snaps the edge smoother to `u(0)`, so a stage switched on starts
  at the top of the wave. As for the other effects, the first `setParams` after a reset takes effect
  at once, with no ramp.
- **Sample rate.** `prepare()` takes the real rate; the phase step and every smoothing time are
  derived from it.

## 4. Screen

### 4.1 The tray

The **Tremolo** chip, after Reverb and marked `post`, goes live: dragged with pointer events (mouse
and touch), Enter adds it, Space does nothing (panic mute). `EffectId` gains `'tremolo'`, dropped only
on POST. The empty POST slot's tooltip, still "Drag Chorus or Delay here" since the reverb, becomes
"Drag a POST effect here".

### 4.2 The POST area

As today, for four effects: the placed effects in their order, each its own panel, in the POST box. A
dropped effect goes into the gap it was released at, or last (Enter on a chip).
Dragging a panel by its title, and ← / → on the focused title, reorder among the placed ones.

### 4.3 The TREMOLO panel

The shared `EffectPanel`, titled TREMOLO, with the title handle like the other POST effects:

- a power switch and a ✕;
- **three 56 px knobs in one row: LEVEL, RATE, DEPTH** (the chorus's and the drive's order). LEVEL
  reads out in dB, RATE in Hz;
- under them, the **WAVE switch: one row of four buttons, each a small drawn waveform** (a sine, a
  triangle, a square and a ramp that rises then drops). The drawings are inline SVG with
  `stroke="currentColor"`, as `icons.tsx` draws, so they dim and light as the drive's legends do; the
  lit one takes a `drop-shadow` glow to match the legends' text glow. Each button's accessible name
  and tooltip is the word: Sine, Triangle, Square, Saw.

`TypeSwitch` gains an optional `icons` prop: given, each button shows its icon and `labels` become the
buttons' accessible names and tooltips. The drive's and the reverb's switches are unchanged. The group
is a `radiogroup` labelled "Waveform"; ← → ↑ ↓ move the selection.

The cell keeps the effect width (248 px). Knobs write straight to the slot AudioParams while turned
and sync state on release. Choosing a wave re-renders only the switch, never the chain.

### 4.4 Tap tempo on RATE

As on the delay's TIME: **a click on RATE without dragging is a tap**. After two or more taps, RATE
is **one cycle per tap**: `1000 / the mean gap in ms`, clamped to 0.5–15 Hz. The 2 s reset
`tapTempo.ts` already uses matches RATE's 0.5 Hz floor, so every gap that counts can be set. For
eighth-note pulses, tap eighths.

A pure `tapToRate(taps, minHz, maxHz)` sits beside `tapToTime` in `src/audio/tapTempo.ts`. RATE keeps
its own tap history, apart from the delay's. The knob is moved through its handle, so nothing remounts
or re-renders, and the value is committed as a turn would be. Dragging still works; double-clicking
RATE no longer resets it, because a click is a tap.

### 4.5 Accessibility

The chip's state is announced. The panel is a labelled group with a labelled power switch, remove
button and title handle. After adding Tremolo from the keyboard, focus moves to its power switch.

## 5. State

### 5.1 The working state

`StoredControls` gains:

```
tremolo: { present: boolean; bypassed: boolean; level: number; rate: number; depth: number;
           wave: 0 | 1 | 2 | 3 }
effectOrder: ('chorus' | 'tremolo' | 'delay' | 'reverb')[]   // a permutation of all four
```

- Absent or unreadable values read as **no Tremolo** with defaults. Values are clamped; `wave` is
  rounded and clamped.
- **Order migration.** An order written before this feature (a permutation of chorus and delay, or of
  chorus, delay and reverb) keeps its relative order, with the missing effects appended in default
  order. Anything else that is not a permutation of all four reads as the default.
- The same storage key is used. The values are kept while the tremolo is removed.

### 5.2 Presets

- **Capture and compare.** `SettingsSnapshot` gains `tremolo`; one that is not placed carries the
  default values. `canonicalEffectOrder` is unchanged and now runs over four effects, so where a
  missing effect sits never makes two presets differ, and a preset saved before this feature compares
  exactly as it did.
- **Applying.** `applyControlsToEngine` writes the four params, the stage and the full order. A preset
  without a tremolo removes a placed one; an old preset loads as no tremolo.
- **The list summary** names placed effects in chain order: `Drive · slo.nam · cab.wav · Chorus ·
  Tremolo · Delay · Reverb`.
- The saved-settings storage version stays 1.

### 5.3 Reload

The tremolo, its power, its values, its wave and the order are restored on start and pushed to the
engine before audio flows.

## 6. Documentation in the app

- The guide gets a **Tremolo** page under Panels (the knobs, the four waves, tap tempo, starting
  settings); *Effects tray and slots*, *How the signal flows* and *Presets* mention it.
- README: feature list, chain, presets summary example, test counts.

## 7. Files and boundaries

| File | Change |
|---|---|
| `engine/TremoloProcessor.{h,cpp}` | New. The processor. No browser or Emscripten headers. |
| `engine/Engine.{h,cpp}` | Member, chain entry, `kTremoloSlot`, `Stage::Tremolo`, four-way `setPostOrder`. |
| `engine/bindings.cpp`, `engine/build-wasm.sh` | `setPostOrder(a, b, c, d)`; the source in the build. |
| `engine/CMakeLists.txt` | The source and the test. |
| `engine/tests/test_tremolo_processor.cpp` (new), `test_engine.cpp` | Host tests (§8). |
| `src/audio/engineMessages.ts`, `nam-engine.worklet.ts` | `'tremolo'`, the four-way order. |
| `src/audio/params.ts` | `TREMOLO_SLOT`, `TREMOLO_PARAMS`, wave labels. |
| `src/audio/tapTempo.ts` | `tapToRate`. |
| `src/state/persistence.ts` | `StoredTremolo`, sanitising, the order migration, `updateTremolo`. |
| `src/state/savedSettings.ts`, `src/audio/applyControls.ts` | Snapshot, equality, controls, summary, apply. |
| `src/ui/panel/effectDrag.ts` | `'tremolo'` in `EffectId`, on POST. |
| `src/ui/panel/TypeSwitch.tsx`, `src/ui/panel/WaveSwitch.tsx` (new), `icons.tsx` | Optional icons; the wave switch and its four drawings. |
| `src/ui/panel/Chain.tsx`, `panel.css` | Live Tremolo chip, the slot hint, the icon switch. |
| `src/ui/screens/useEffectRack.ts`, `MainScreen.tsx` | Tremolo placement, power, values, wave, tap tempo; order over four. |
| `src/ui/panel/tutorialContent.tsx`, `README.md` | §6. |

## 8. Verification

**Host C++ (CMake).** `TremoloProcessor`, mostly with a steady input of 1.0, so the output *is* the
gain curve:

- DEPTH 0 at every wave: the output equals the input times LEVEL (exactly the input at 0 dB); +6 dB
  gives about twice the input.
- **Shapes.** At DEPTH 100 % and a slow rate, each wave's gain over a cycle follows its `u(φ)` within
  a small tolerance, away from the 2 ms edges.
- **Depth.** The bottom of the wave is `1 − DEPTH` of the top.
- **Rate.** The gain curve's period matches `1 / RATE` within 1 % at 0.5, 4 and 15 Hz.
- **No clicks.** SQUARE and SAW at 15 Hz and DEPTH 100 %, and a WAVE change at the worst moment, never
  move the gain by more than the 2 ms smoother's per-sample step.
- **Robustness.** NaN, ±infinity and absurd values for every param read as safe values; WAVE rounds
  and clamps; a non-finite input sample cannot poison later output; finite at 44.1, 48 and 96 kHz.
- `reset()` restarts the wave at its top; the first params after a reset take effect at once.

`Engine`: the chain with Tremolo in POST at its default place; param offsets (tremolo 38);
`Stage::Tremolo` starts disabled, enables independently and resets on false-to-true only;
`setPostOrder` reaches all 24 permutations, is a no-op when repeated, rejects anything else (a
duplicate, an unknown id, a PRE stage), resets only moved processors and leaves every other stage in
place.

**Vitest.** Tapers and formatters for the tremolo params; the wave labels; `tapToRate` (too few taps,
clamping at both ends, the mean); the sanitiser for a missing, partial, out-of-range and hostile
`tremolo`; the order migration from two- and three-effect orders; capture, canonical order,
equality, apply and summary for presets with and without Tremolo and old presets; `canDrop` for
Tremolo; the order rules over four effects.

**Browser** (read the DOM, stub the microphone):

1. The Tremolo chip is live and drops only on POST.
2. All four POST effects drop in different orders; the panels follow, and the engine gets each full
   order.
3. Title-drag and arrow keys reorder among four; the engine gets the full order.
4. The knobs and the wave switch move the right params; the icons light; tap tempo on RATE sets the
   rate from the taps.
5. A reload restores placement, power, values, wave and order.
6. Presets with and without Tremolo round-trip; an old preset removes it; the summary lists it.
7. The layout at 1900 px and at 375 px with every effect placed.

**By ear (yours).** Each wave sounds like its name; SQUARE and SAW chop without clicks; no zipper
noise from any knob; tapped rates match the tempo; DEPTH 100 % really silences the trough; the panic
mute still silences everything.

## 9. Risks

| Risk | Answer |
|---|---|
| SQUARE or SAW clicks | The 2 ms edge smoother, a host test that bounds the per-sample gain step, and the by-ear check. |
| The tremolo makes the sound quieter overall | Expected (it only turns down); LEVEL makes it up. |
| Changing the order message breaks an old worklet or UI | Both ship together in one bundle; the worklet validates the permutation and ignores anything else. |
| An order stored before this feature loses its meaning | Migrated (§5.1) and covered by tests for two- and three-effect orders. |
| Tapped rates feel off the beat | Tapping sets the speed, not the phase (§1); stated in the guide. |

## 10. Learned while building it

- **The saw cannot quite reach silence.** While the 2 ms smoother is softening the drop, the next
  swell has already begun, so at DEPTH 100 % the saw's floor is `r τ ln(1 / (r τ))`, `r` the rate and
  `τ` 2 ms: 0.039 (−28 dB) at 4 Hz, 0.105 (−20 dB) at 15 Hz. Any click-free saw has the same floor; a
  smoother that let it reach zero would be a click. The host test asserts this bound, and the guide
  mentions it. The square, whose halves are long and flat, reaches silence at every rate.
