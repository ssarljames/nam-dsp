# Drive — the first PRE effect, with three clipping types

**Date:** 2026-09-25
**Status:** Approved in conversation; this document records it. Awaiting review of the written text.
**Refines:** [2026-09-25-chorus-effect-design.md](2026-09-25-chorus-effect-design.md) and
[2026-09-25-delay-effect-design.md](2026-09-25-delay-effect-design.md), which built the POST effects
and left the PRE slot inert; the engine rules in [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md)
§5.3 and §12; the presets in [2026-09-24-saved-settings-design.md](2026-09-24-saved-settings-design.md) §3.

---

## 1. Scope

The PRE slot, before the amp model, has been a placeholder since the rack rewire. This milestone
puts one real effect in it: **Drive**, a stand-alone dirt pedal that runs from light overdrive to
heavy distortion. It has its own panel with **GAIN, TONE and LEVEL** knobs and a **SOFT / HARD /
ASYM** clipping-type switch. It is named Drive rather than Distortion because the three types cover
both overdrive and distortion.

In scope:

- `DriveProcessor` in the C++ engine, one pre-allocated instance, between the input gain and the NAM
- Four params in pooled slot 3, and a stage switch
- A live Drive tray chip, dropped **only** on PRE; the PRE slot becomes a drop target
- A DRIVE panel in the PRE position: power, remove, three knobs and the type switch
- The stored working state and saved presets carry it

Out of scope, on purpose:

- Any other PRE effect (compressor and boost stay inert), more than one Drive, putting Drive in
  POST, or reordering within PRE (there is only one PRE effect).
- Oversampling. Aliasing is handled by first-order ADAA (§3.3), agreed as the approach.
- A dry/wet mix, a two-band tone, or a fuzz type. Any of these can follow as extra params in the
  same slot (it has two spare).
- The click when a stage is switched on or off (the known stage-switch gap, rack-rewire §8).

## 2. Approach and why

The same pattern as the delay and the chorus: one fixed processor member, pre-allocated at
construction, always in the chain and disabled until the UI places it, its params in a pooled
slot, nothing allocated in `process()`. The UI's "placed" and "powered" are two flags that the
engine sees as one (enabled = placed and not bypassed).

The clipping is a soft or hard curve applied at the base sample rate with **first-order
antiderivative anti-aliasing (ADAA)**. Of the three options considered (plain clipping, 4×
oversampling, ADAA), ADAA removes most of the fold-back fizz at high gain without oversampling's
CPU cost, filter latency or extra code. Its cost is about half a sample of delay and one guarded
special case.

## 3. Engine

### 3.1 Chain position

```
Gate -> InputGain -> Drive -> Nam[0..kNamCount-1] -> Cab -> {Chorus, Delay in either order} -> Eq -> OutputVolume
```

Drive follows the input gain, matching the screen (INPUT, GATE, PRE, AMP), so the input trim also
sets how hard the pedal is hit. Every later entry moves along by one: `kPostEntryIndex` becomes
`4 + kNamCount`, and `setPostOrder` keeps swapping that entry and the next.

### 3.2 Parameters

| Param | Slot param | Range | Default | Notes |
|---|---|---|---|---|
| LEVEL | `slot3_p0` | −24 to +24 dB | 0 dB | Output trim after everything else. Centre detent at 0, like every stage's LEVEL. |
| GAIN | `slot3_p1` | +6 to +48 dB | +27 dB | Gain into the clipper. Linear in dB. Even the minimum breaks up a little. |
| TONE | `slot3_p2` | 0 to 100 % | 50 % | Low-pass after the clipper, 800 Hz at 0 % to 12 kHz at 100 % (§3.3). |
| TYPE | `slot3_p3` | 0, 1, 2 | 0 | 0 SOFT, 1 HARD, 2 ASYM. Rounded to the nearest integer and clamped. |

- `kDriveSlot = kNamCount + 2` (slot 3); `kDriveParamIndex = kSlotBaseIndex + kDriveSlot ×
  kParamsPerSlot` = 26. The 56-float block does not change. `static_assert`s keep the slot inside
  the pool, clear of the NAM stages, and distinct from the delay's and the chorus's.
- `Engine::Stage::Drive = 5`, mapped from `'drive'` in the worklet. It starts **disabled** and is
  reset on the false-to-true transition only.
- LEVEL sits at p0 like the delay's and chorus's LEVEL. The panel shows the knobs in the order
  GAIN, TONE, LEVEL (§4.3); the slot order and the panel order are independent.

### 3.3 `DriveProcessor`

Per sample, in order:

1. **Input guard.** A non-finite sample (NaN or ±infinity) is treated as 0.
2. **Tighten.** A fixed one-pole high-pass at 100 Hz, so low strings do not turn to mush.
3. **Gain.** Multiply by the smoothed GAIN, converted from dB.
4. **Clip with ADAA.** With `x` the gained sample and `x₁` the previous one, the output is
   `(F(x) − F(x₁)) / (x − x₁)`, or `f((x + x₁) / 2)` when `|x − x₁| < 1e−6`. The state `x₁` and the
   evaluation of `F` are in `double`, because the difference of two nearly equal antiderivatives
   loses precision in `float`. The curves:

   | Type | `f(x)` | `F(x)` (antiderivative) |
   |---|---|---|
   | SOFT | `tanh(x)` | `log cosh(x)`, computed as `|x| + log1p(exp(−2|x|)) − log 2` so it cannot overflow |
   | HARD | `clamp(x, −1, 1)` | `x² / 2` for `|x| ≤ 1`, else `|x| − 1/2` |
   | ASYM | `tanh(x + b) − tanh(b)`, `b = 0.4` | `log cosh(x + b) − x · tanh(b)` |

5. **DC blocker.** A one-pole high-pass at about 10 Hz. ASYM produces DC; the blocker removes it
   and is harmless for the other types.
6. **Level matching.** The output is multiplied by `A / m(g·A)`, where `A = 0.1` (a −20 dBFS
   reference), `g` is the linear gain and `m(v)` is the mean magnitude of the curve at `±v`,
   `(|f(v)| + |f(−v)|) / 2`. So a moderate guitar signal comes out at about the level it went in,
   and GAIN mostly changes the character rather than the loudness. It is computed from the
   smoothed gain, at most once per sample while the gain is moving.
7. **TONE.** A second-order low-pass (Butterworth, Q 0.707) with cutoff `800 × 15^t` Hz, `t` the
   smoothed tone in 0 to 1, so 50 % sits at about 3.1 kHz. Coefficients in `double`, recomputed
   only when the smoothed tone has moved by more than a small epsilon, as in the EQ.
8. **LEVEL.** Multiply by the smoothed LEVEL, converted from dB.

Rules:

- **Smoothing.** GAIN, TONE and LEVEL are smoothed inside the processor (one-pole, about 20 to
  30 ms), as everywhere (design spec §5.3), so a turning knob never zippers.
- **Type changes crossfade.** When TYPE changes, the processor computes both the old and the new
  curve from the same `x` history for 10 ms and fades linearly from one to the other, so the switch
  does not click. A change during a crossfade starts a new fade from the current mix.
- **Fixed storage.** Every state is a scalar member. Nothing allocates in `process()`.
- **Denormals.** Filter states are flushed to zero below a tiny threshold.
- **Parameters** are clamped to their ranges; a non-finite value reads as the default.
- **`reset()`** clears the filters, the ADAA history and any crossfade. As for the delay and chorus,
  the first `setParams` after a reset takes effect at once rather than gliding from stale values.
- **Sample rate.** `prepare()` takes the real rate; the filter coefficients and smoothing times are
  derived from it, and the TONE cutoff is kept below 0.45 of it.

## 4. Screen

### 4.1 The tray

- A new live chip, **Drive**, marked `pre`, sits after Boost. It is a `button` dragged with pointer
  events (mouse and touch), and **Enter** on it adds it. Space does nothing (panic mute).
- `EffectId` becomes `'drive' | 'chorus' | 'delay'`. Drive may be dropped **only on PRE**; Chorus
  and Delay only on POST (`canDrop`).
- The chip reads **in use** while Drive is placed. The hint reads "Drag an effect onto PRE or POST"
  while any live effect is unplaced, and "The effects are in the chain — remove one with its ✕" when
  all three are placed. Compressor, Boost and Tremolo stay inert.

### 4.2 The PRE slot

- Empty, it is the thin placeholder it is today. While a chip that fits (Drive) is dragged, it
  highlights and widens as a drop target, exactly like POST.
- On drop, the DRIVE panel takes its place in the chain. Removing Drive brings the slot back.

### 4.3 The DRIVE panel

The shared `EffectPanel`, titled DRIVE:

- a power switch and a ✕ that removes it and returns the chip;
- three 56 px **knobs**: GAIN, TONE, LEVEL, in that order;
- under them, a **SOFT / HARD / ASYM** segmented switch: three small buttons, the selected one lit.
  It is a `radiogroup` labelled "Clipping type"; ← and → move the selection when it has focus.
  Selecting a type writes the TYPE param and saves at once;
- **no title drag handle**: PRE holds only one effect, so there is nothing to reorder. The title
  handle becomes an optional prop of `EffectPanel`.

The knobs write straight to the slot AudioParams while turned and sync state and storage on
release, so turning one never re-renders the chain. The panel's chain cell has the
effect width; the type switch fits under the three knobs.

### 4.4 Accessibility

The chip's state is announced ("in use" or the instruction to add it). The panel is a labelled
group with a labelled power switch and remove button. After adding Drive from the keyboard, focus
moves to its power switch, as for the other effects.

## 5. State

### 5.1 The working state

`StoredControls` gains one record, read like `delay` and `chorus`:

```
drive: { present: boolean; bypassed: boolean; level: number; gain: number; tone: number; type: 0 | 1 | 2 }
```

Absent, unreadable or out-of-range values read as **no Drive** with defaults, so a record written
before this feature stays valid and cannot come back with a Drive. Values are stored in their own
units and clamped on read; `type` is rounded and clamped. The same storage key is used; no
migration. The values are kept while Drive is removed.

### 5.2 Presets

Drive is part of the sound:

- **Capture and compare.** `SettingsSnapshot` gains `drive`. A Drive that is not placed carries
  default values, so hidden state never makes two presets differ. `settingsEqual` includes it.
- **Applying.** `applyControlsToEngine` sets the four params and the stage. A preset without Drive
  **removes** a placed one; an old preset (no `drive`) loads as no Drive. The chain re-keys so the
  panel shows the new state. Device ids and the live state are untouched.
- **The list summary** names placed effects in chain order, Drive first: `Drive · slo.nam ·
  cab.wav · Chorus · Delay`. The saved-settings storage version stays 1.

### 5.3 Reload

Drive, its power, its values and its type are restored on start and pushed to the engine before
audio flows. Nothing is asynchronous, so the startup-order protection (the SIGILL fix) is
unaffected.

## 6. Documentation in the app

- The guide gets a **Drive** page under Panels (what the three types sound like, GAIN, TONE,
  LEVEL, starting settings), and the *Effects tray and slots*, *How the signal flows* and
  *Presets* pages mention it.
- The tour's PRE stop reads that Drive can be dropped there.
- README: feature list, chain, presets summary example, test counts.

## 7. Files and boundaries

| File | Change |
|---|---|
| `engine/DriveProcessor.{h,cpp}` | New. The processor. No browser or Emscripten headers. |
| `engine/Engine.{h,cpp}` | Member, chain entry, `kDriveSlot`, `Stage::Drive`, `kPostEntryIndex`. |
| `engine/bindings.cpp` | Nothing: `setStageEnabled` already takes the stage number and casts it. |
| `engine/CMakeLists.txt`, `engine/build-wasm.sh` | Add the source and the test. |
| `engine/tests/test_drive_processor.cpp` (new), `test_engine.cpp` | Host tests (§8). |
| `src/audio/engineMessages.ts`, `nam-engine.worklet.ts` | `'drive'` in `StageId`, and `drive: 5` in the worklet's `STAGE_IDS`. |
| `src/audio/params.ts` | `DRIVE_SLOT`, `DRIVE_PARAMS`, `DRIVE_PARAM_INDEX`, the type labels. |
| `src/state/persistence.ts` | `StoredDrive`, sanitising, `updateDrive`. |
| `src/state/savedSettings.ts`, `src/audio/applyControls.ts` | Snapshot, equality, controls, summary, apply. |
| `src/ui/panel/effectDrag.ts`, `useEffectDrag.ts` | `'drive'` in `EffectId`, dropped on PRE only. |
| `src/ui/panel/EffectPanel.tsx` | Optional title handle; an optional extra row under the knobs. |
| `src/ui/panel/ClipTypeSwitch.tsx` (new) | The SOFT / HARD / ASYM radio group. |
| `src/ui/panel/Chain.tsx`, `panel.css` | Live Drive chip, PRE as a drop target, the switch's styles. |
| `src/ui/screens/useEffectRack.ts`, `MainScreen.tsx` | Drive's placement, power and values; the PRE cell. |
| `src/ui/panel/tutorialContent.tsx`, `src/ui/tour/tourSteps.ts` | §6. |
| `README.md` | §6. |

## 8. Verification

**Host C++ (CMake).** `DriveProcessor`:

- **Aliasing.** A 2.5 kHz sine at maximum GAIN, for each type: the energy outside the harmonic bins
  (the aliases) is at least **10 dB** lower with ADAA than with the same curve evaluated directly.
- **Curves.** HARD never exceeds ±1 before level matching and LEVEL; SOFT is odd-symmetric; ASYM
  produces a second harmonic well above SOFT's and no DC at the output.
- **Level matching.** A 1 kHz sine at −20 dBFS comes out within ±4 dB of its input level at the
  minimum, default and maximum GAIN, for every type (TONE at 100 %, LEVEL 0 dB).
- **TONE** lowers the output above the cutoff as it turns down; **LEVEL** scales the output by its
  dB value.
- **Type switch.** Changing type mid-signal never changes the output by more than a small bound
  between consecutive samples, and the crossfade finishes within 10 ms.
- **ADAA special case.** A constant input (so `x = x₁`) produces the curve's value, not a division
  by zero.
- **Robustness.** Params clamp; NaN, infinity and absurd values read as safe defaults; a
  non-finite input sample cannot poison later output; the output stays finite at 44.1, 48 and
  96 kHz at every setting.
- **`reset()`** clears all state; the first params after a reset take effect at once.

`Engine`: the chain order with Drive after the input gain; the param offsets (drive 26, delay 14,
chorus 20); `Stage::Drive` starts disabled, enables independently and resets on false-to-true
only; `setPostOrder` still swaps the two POST entries and leaves Drive in place.

**Vitest.** Tapers round-trip and formatters at minimum, default and maximum for GAIN, TONE and
LEVEL; the type labels; the sanitiser for a missing, partial, out-of-range and hostile `drive`;
`canDrop` for every effect on every slot; capture, equality, apply and summary for presets with and
without Drive, and old presets.

**Browser** (read the DOM, stub the microphone):

1. The Drive chip is live; it drops on PRE and not on POST; Delay and Chorus still drop only on POST.
2. Dropping it replaces the PRE slot with the panel; the chip reads "in use"; Enter also adds it.
3. The knobs and the type switch move the right slot AudioParams; a knob drag never re-renders the
   chain; ← and → on the switch change the type.
4. Power and ✕ behave; removing brings the PRE slot back.
5. A reload restores placement, power, values and type.
6. Presets with and without Drive round-trip; an old preset removes it; the summary lists it first.
7. The layout at 1900 px and at 375 px with all three effects placed.

**By ear (yours).** The three types sound clearly different; high notes at full GAIN are free of
fizz; turning GAIN changes the character more than the volume; no zipper noise from the knobs and
no click from the type switch; it drives a clean NAM and a high-gain NAM musically; the panic mute
still silences everything.

## 9. Risks

| Risk | Answer |
|---|---|
| ADAA precision loss when consecutive samples are close | The antiderivatives and the history are in `double`, and the near-equal case falls back to the curve at the midpoint; host-tested with a constant input. |
| Level matching is off for real guitar signals, not the test sine | The target is loose (±4 dB) and LEVEL trims ±24 dB; confirmed by ear. |
| A type change clicks | A 10 ms crossfade computed from the same input history; host-tested for the largest sample-to-sample step. |
| Moving the POST entries breaks reordering | `kPostEntryIndex` is derived, and the engine tests assert the order in both POST orders with Drive placed. |
| Hard clipping at +48 dB is still harsh on high notes | TONE rolls it off, and the aliasing test sets a floor; the by-ear check decides whether more (oversampling) is needed later. |
| Adding a field to presets confuses old data | Optional, read defensively, and covered by tests for missing and hostile records. |
