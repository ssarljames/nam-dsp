# Reverb — the third POST effect, with six types and trails

**Date:** 2026-10-01
**Status:** Approved in conversation (types, controls, layout, trails, the shared-core approach, the
fade-and-restart type change, the three-way order and the engine integration in §3.1–§3.5). The DSP
detail in §3.6 onward, the screen, the state and the verification were not presented section by
section: the user asked for implementation to go ahead, so this document records them as decided.
Implemented on the `reverb` branch; §10 lists what changed from the first draft while building it.
**Refines:** [2026-09-25-chorus-effect-design.md](2026-09-25-chorus-effect-design.md) (the POST
order, which this generalises from two effects to three), [2026-09-25-delay-effect-design.md](2026-09-25-delay-effect-design.md)
and [2026-09-25-drive-effect-design.md](2026-09-25-drive-effect-design.md) (the effect pattern and
the type switch); the engine rules in [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md)
§5.3 and §12; the presets in [2026-09-24-saved-settings-design.md](2026-09-24-saved-settings-design.md) §3.

---

## 1. Scope

A **Reverb** in POST beside the Chorus and the Delay, with six types: **ROOM, HALL, PLATE, SPRING,
SHIMMER and AMBIENT**. It has MIX, DECAY, TONE and PRE-DELAY knobs, a fifth knob whose job follows
the type, a 2×3 type switch and a **TRAILS** switch.

In scope:

- `ReverbProcessor` in the C++ engine, one pre-allocated instance, in pooled slot 4
- A POST order over **three** effects, any permutation, set in the engine between audio blocks
- Trails: with TRAILS on, switching the reverb off lets its tail ring out
- A live Reverb tray chip, dropped only on POST
- A REVERB panel: power, remove, title handle, five knobs, the type switch and the TRAILS switch
- The stored working state and saved presets carry it, and an order stored before this feature keeps
  its meaning

Out of scope, on purpose:

- **Stereo.** The engine is mono in, processed once, duplicated to both outputs (main spec §5.1 and
  §14), so this is a mono reverb: dense and lush, not wide. Stereo is a separate, larger decision.
- A freeze/infinite hold, tempo-synced pre-delay, a choice of shimmer interval (it is an octave up),
  ducking, or more than one reverb.
- Morphing between types: a type change restarts the tail (§3.8).
- The click when a stage is switched on or off with TRAILS off, or when the order changes (the known
  stage-switch gap, rack-rewire §8).

## 2. Approach and why

The same pattern as every effect so far: one fixed processor member, pre-allocated at construction,
always in the chain and disabled until placed, its params in a pooled slot, nothing allocated in
`process()`.

All six types share **one reverb core**, voiced per type, with one small add-on per type. The
alternatives were a separate algorithm per type (about three times the code, tests and memory for a
difference that is hard to hear after an amp model) and convolution with bundled responses (rejected:
no shimmer, no bloom, no DECAY knob, no modulation, and seconds-long responses need FFT convolution
the engine does not have).

## 3. Engine

### 3.1 Chain position

```
Gate -> InputGain -> Drive -> Nam[0..kNamCount-1] -> Cab -> {Chorus, Delay, Reverb in any order} -> Eq -> OutputVolume
```

The default order is **Chorus, Delay, Reverb**: the usual pedalboard order, where the reverb tails the
echoes of the chorused sound. The EQ still shapes everything before it.

### 3.2 Slot, stage and parameters

`kReverbSlot = kNamCount + 3` (slot 4), `kReverbParamIndex = kSlotBaseIndex + kReverbSlot ×
kParamsPerSlot` = 32. The 56-float block does not change. `static_assert`s keep the slot inside the
pool, clear of the NAM stages, and distinct from the delay's, chorus's and drive's.
`Engine::Stage::Reverb = 6`, mapped from `'reverb'` in the worklet. It starts **disabled** and is
reset on the false-to-true transition only.

| Param | Slot param | Range | Default | Notes |
|---|---|---|---|---|
| MIX | `slot4_p0` | 0 to 100 % | 30 % | §3.6. |
| DECAY | `slot4_p1` | 0 to 100 % | 50 % | Mapped to the type's own range of seconds (§3.7). |
| TONE | `slot4_p2` | 0 to 100 % | 50 % | Brightness of the tail (§3.6). |
| PRE-DELAY | `slot4_p3` | 0 to 250 ms | 20 ms | Skewed so 40 ms sits at mid travel. |
| The type's knob | `slot4_p4` | 0 to 100 % | 50 % | EARLY, MOD, DRIP, SHIMMER or BLOOM (§3.7). |
| TYPE | `slot4_p5` | 0 to 5 | 1 | 0 ROOM, 1 HALL, 2 PLATE, 3 SPRING, 4 SHIMMER, 5 AMBIENT. Rounded and clamped. |

The knobs come first and TYPE last, as in the drive's slot. The type's knob is stored as a percent, so
switching type keeps its position and changes only its meaning.

### 3.3 Order

`setPostOrder(first)` becomes **`setPostOrder(a, b, c)`**, three `Stage` values.

- Anything that is not a permutation of Chorus, Delay and Reverb changes nothing; repeating the
  current order is a no-op.
- A real change rearranges the three chain entries at `kPostEntryIndex` with at most two
  `swapEntries` calls and **resets only the processors whose position changed**, so no stale tail
  plays from a new position and an effect that did not move keeps ringing.
- It runs on the audio thread between render quanta like every other structural command, and
  allocates nothing.
- The wire format is `{ type: 'setPostOrder', order: ['chorus', 'delay', 'reverb'] }`. The worklet
  checks that `order` is a permutation of the three ids before calling the engine.

### 3.4 Trails

The engine receives two facts about the reverb, both derived by the screen from the stored record:

- **stage enabled** = placed **and** (powered on **or** TRAILS on)
- **input open** = powered on

The second is a new command, `setReverbInput(open)` (wire: `{ type: 'setReverbInput', open }`),
which the processor stores. With the input closed:

- the **dry** signal passes at full level (MIX above 50 % no longer turns it down: the pedal is off);
- nothing new enters the reverb: the input to the tank fades to zero over 5 ms;
- the existing tail decays on its own;
- once the wet output has stayed below **−120 dBFS for 100 ms**, `process()` goes **idle** and
  returns at once, leaving the buffer untouched, so a bypassed reverb with trails costs no CPU.

Opening the input wakes it without a reset. What follows:

| Action | TRAILS off | TRAILS on |
|---|---|---|
| Power off | stage disabled: the tail is cut | input closed: the tail rings out, then idles |
| Power on | stage enabled, reset on false-to-true | input opened, no reset |
| ✕ remove | stage disabled: cut | stage disabled: cut |
| TRAILS switched while off | — | switching it off disables the stage: cut |

### 3.5 Bindings

`setPostOrder(int32_t a, int32_t b, int32_t c)` and `setReverbInput(bool open)` replace / join the
embind setup calls. `setStageEnabled` already takes any stage number.

### 3.6 `ReverbProcessor`: signal flow

Per sample, mono:

1. **Input guard.** A non-finite sample (NaN or ±infinity) is treated as 0.
2. **Input gate.** Multiply by the smoothed input gain (1 open, 0 closed, 5 ms).
3. **Bandwidth.** A one-pole low-pass at the type's input bandwidth for the current TONE (§3.7),
   kept below 0.45 × fs.
4. **Pre-delay.** Written to a line and read at the smoothed pre-delay with linear interpolation.
5. **Front add-on** (by type, §3.7): spring lines for SPRING, bloom diffusers for AMBIENT.
6. **Input diffusion.** Four series Schroeder all-passes, 4.8, 3.6, 12.7 and 9.3 ms, coefficient by
   type (SPRING has none).
7. **The tank:** a feedback delay network of **8 lines**.
   - Base lengths 31.1, 37.3, 41.9, 47.1, 53.9, 61.3, 69.7 and 79.1 ms, scaled by the type's size.
   - Each line's read point is swept by its own slow sine (rates spread around the type's modulation
     rate) by the type's modulation depth, and read with linear interpolation.
   - Each line output passes a per-line **absorption filter** (Jot): a gain `g_i = 10^(−3 L_i /
     (RT60 × fs))`, `L_i` its mean length in samples, so the low and mid frequencies decay in exactly
     DECAY's RT60, and a one-pole low-pass whose Nyquist gain makes the highs decay in `α × RT60`,
     `α` the type's high/low decay ratio at the current TONE. Both are per line, so every line decays
     alike whatever its length, and DECAY really is the RT60 a listener hears below about 1 kHz.
   - For SHIMMER, **all eight lines** blend their output with an **octave-up** pitch-shifted copy
     (§3.7) before mixing.
   - The eight outputs are mixed by a normalised 8×8 Hadamard matrix (a fast Walsh–Hadamard
     transform, orthogonal, so it neither adds nor removes energy), the diffused input is added to
     each with alternating signs, and the result is written back.
8. **Wet.** The sum of the eight line outputs with alternating signs, plus the type's add-on outputs
   (ROOM's early reflections, SPRING's spring lines), through a one-pole high-pass at the type's low
   cut, times the type's output gain and the decay compensation `(RT60 / RT60_default)^−0.25`, so a
   very long DECAY does not swamp the dry signal.
9. **Type fade** (§3.8) and **MIX.** With `m = MIX / 100`: wet gain `min(1, 2m)`, dry gain `1` up to
   50 % then `2(1 − m)`, so up to 50 % the reverb is added to a full-level dry signal and above it the
   dry falls away, to wet-only at 100 %. With the input closed the dry gain is 1 (§3.4). Both gains are
   smoothed (20 ms).

**Stability.** Every line gain is below 1, the damping filters never amplify, the matrix is
orthogonal, and the shimmer blend is a convex mix of the line and its shifted copy, each of whose
taps is a convex mix of past samples, so the loop cannot gain energy at any setting. Host-tested at
every type with every knob at its maximum.

### 3.7 The six voicings

| Type | Size | Diffusion | DECAY 0→100 % | Input bandwidth, TONE 0→100 % | High/low decay ratio α, TONE 0→100 % | Modulation | Low cut | Add-on, and the fifth knob |
|---|---|---|---|---|---|---|---|---|
| ROOM | 0.35 | 0.60 | 0.2 → 2.5 s | 3 → 16 kHz | 0.15 → 0.70 | 0.05 ms, 0.9 Hz | 80 Hz | Early reflections. **EARLY**: their level, 0 to 1. |
| HALL | 1.5 | 0.70 | 0.8 → 10 s | 2.5 → 14 kHz | 0.10 → 0.60 | **MOD**: 0 → 0.8 ms, 0.5 Hz | 60 Hz | — |
| PLATE | 0.6 | 0.78 | 0.5 → 8 s | 4 → 18 kHz | 0.20 → 0.85 | **MOD**: 0 → 0.4 ms, 1 Hz | 100 Hz | — |
| SPRING | 0.45 | none | 0.4 → 5 s | 2 → 6 kHz | 0.10 → 0.40 | none | 150 Hz | Spring lines. **DRIP**: dispersion. |
| SHIMMER | 1.4 | 0.70 | 1.5 → 20 s | 3 → 14 kHz | 0.15 → 0.60 | 0.4 ms, 0.4 Hz | 120 Hz | Octave-up shifter. **SHIMMER**: how much. |
| AMBIENT | 2.0 | 0.75 | 3 → 30 s | 1.5 → 9 kHz | 0.08 → 0.45 | 1.2 ms, 0.3 Hz | 80 Hz | Bloom diffusers. **BLOOM**: how slowly it swells. |

Each type also has a measured output gain (ROOM 2.6, HALL 4.25, PLATE 2.75, SPRING 1.85, SHIMMER 6.5,
AMBIENT 4.0) so white noise at the default settings comes out of the wet path within 0.1 dB of its
input level.

DECAY maps logarithmically: `RT60 = lo × (hi / lo)^(DECAY / 100)`, so 50 % is the geometric middle
(ROOM 0.71 s, HALL 2.8 s, PLATE 2 s, SPRING 1.4 s, SHIMMER 5.5 s, AMBIENT 9.5 s).

- **ROOM, early reflections.** Eight taps read from the pre-delay line at 4.3 to 33 ms after the
  pre-delay, with falling gains and alternating signs, added to the wet at EARLY × 1.
- **SPRING, spring lines.** Two loops of 33.7 and 41.3 ms, each holding a chain of **12 stretched
  all-passes** `(a + z^−K) / (1 + a z^−K)` with `K = round(fs / 9600)` (so the dispersion sits below
  about 4.8 kHz and low frequencies arrive before high ones: the chirp), a damping low-pass and a
  feedback gain from DECAY. DRIP sets `a` from 0.3 to 0.75. Their sum is added to the wet and feeds
  the tank (the diffuse body behind the boing).
- **SHIMMER, octave up.** Every tank line has a two-tap delay-line pitch shifter: two read points
  sweep a 50 ms window at twice the write rate, half a window apart, weighted by a bump that is zero
  where a tap jumps back, and the two weights always sum to one. The eight windows are staggered by
  an eighth so they never turn over together. SHIMMER blends the shifted copy in from 0 to 0.7.
  Because it sits inside the loop, each pass climbs another octave and the damping softens the
  climb. Measured with a 220 Hz input: the octave sits 54 dB under the note at SHIMMER 0, 13 dB under
  at 50 % and 4 dB over at 100 %, with the second octave 6 dB under the note.
- **AMBIENT, bloom.** Four long Schroeder all-passes, 61, 90, 117 and 144 ms, in front of the tank,
  always running. Their coefficient is 0.55 + 0.2 × BLOOM, and BLOOM also crossfades from the
  unbloomed signal to theirs, so at 0 they are out of the path and at 100 % each note's energy is
  spread out: the wet swells to its peak around 0.6 to 0.8 s instead of arriving at once (measured:
  the first 100 ms is 19 dB under 0.5 to 1 s, against 8 dB at BLOOM 0).
- **HALL and PLATE** are voicing only; their fifth knob is the modulation depth.

### 3.8 Type changes

When the rounded TYPE differs from the voiced one, the wet output fades to zero over **30 ms** (the
old type still running), then every line and add-on is cleared and the new voicing applied, and the
wet gain returns to full at once: the tank is empty, so it builds from silence. The input gate is
snapped shut and ramps back open over its 5 ms, so the new tank never starts on a step of a
waveform already in progress either. If TYPE returns to the voiced type during the fade, the fade
reverses instead. So a type change restarts the tail and never clicks. (A `reset()` does not ramp
the input: the first note after a stage is switched on starts as it would anyway.)

### 3.9 Rules

- **Smoothing.** MIX, DECAY, TONE, PRE-DELAY and the fifth knob are smoothed inside the processor, as
  everywhere (design spec §5.3). Coefficients that cost a `pow` or `exp` (line gains, damping) are
  recomputed once per block from the smoothed values.
- **Fixed storage.** About 1.2 MB in total: eight tank lines of 16384 samples, a 32768-sample pre-delay
  line, four input all-passes, four bloom all-passes of 16384, eight shifter windows of 8192 and two
  spring loops, all sized for 96 kHz with powers of two so reads wrap with a mask. They are `std::vector`s
  sized once in the constructor and never resized (as the engine's model staging is), so host tests
  that put an `Engine` on the stack do not overflow it. Nothing allocates in `process()`.
- **Denormals.** Every value written back into a line or a filter state below `1e−20` is written as
  zero, so a decaying tail ends in exact zeros (design spec §5.3 rule 4).
- **Parameters** are clamped to their ranges; a non-finite value reads as the default.
- **`reset()`** clears every line and state. As for the other effects, the first `setParams` after a
  reset takes effect at once, including TYPE, with no fade.
- **Sample rate.** `prepare()` takes the real rate; every length, coefficient and smoothing time is
  derived from it. Above 96 kHz the lengths are clamped to the fixed buffers rather than read out of
  bounds.

## 4. Screen

### 4.1 The tray

A live **Reverb** chip, marked `post`, after Chorus. It is dragged with pointer events (mouse and
touch), Enter adds it, Space does nothing (panic mute). `EffectId` gains `'reverb'`, dropped only on
POST. The hint logic is unchanged: it covers every live effect.

### 4.2 The POST area

As today, for three effects: the placed effects in their order, each its own panel, and the thin POST
slot while at least one is missing. A dropped effect goes into the gap it was released at, or last.
Dragging a panel by its title, and ← / → on the focused title, reorder among the placed ones.

### 4.3 The REVERB panel

The shared `EffectPanel`, titled REVERB, with the title handle like Chorus and Delay:

- a power switch and a ✕;
- **five 56 px knobs on two rows**: MIX, DECAY, TONE, then PRE-DELAY and the type's knob;
- DECAY reads out in **seconds** for the current type (for example `2.8 s`);
- the type's knob is labelled for the current type: EARLY, MOD, MOD, DRIP, SHIMMER or BLOOM;
- under them, a **2×3 type switch**: ROOM, HALL, PLATE / SPRING, SHIMMER, AMBIENT. It is the drive's
  switch generalised (a `TypeSwitch` with labels and a column count); a `radiogroup` labelled "Reverb
  type", ← → ↑ ↓ move the selection;
- under that, a small **TRAILS** switch with an LED, `role="switch"`.

The cell keeps the effect width (248 px); the panel is taller than the others. Knobs write straight
to the slot AudioParams while turned and sync state on release. Choosing a type re-renders the panel
(the fifth knob's legend and DECAY's readout change), never during a drag. The Knob gains an
optional `format` prop for DECAY's readout.

### 4.4 Accessibility

The chip's state is announced. The panel is a labelled group with a labelled power switch, remove
button and title handle. The TRAILS switch is labelled "Trails: let the tail ring out when the reverb
is switched off". After adding Reverb from the keyboard, focus moves to its power switch.

## 5. State

### 5.1 The working state

`StoredControls` gains:

```
reverb: { present: boolean; bypassed: boolean; trails: boolean; mix: number; decay: number;
          tone: number; preDelay: number; character: number; type: 0 | 1 | 2 | 3 | 4 | 5 }
effectOrder: ('chorus' | 'delay' | 'reverb')[]   // a permutation of all three
```

- Absent or unreadable values read as **no Reverb** with defaults; `trails` defaults to **true**
  (only an explicit `false` turns it off). Values are clamped; `type` is rounded and clamped.
- **Order migration.** An order that is a permutation of **chorus and delay only** (written before this
  feature) keeps its relative order with `'reverb'` appended. Anything else that is not a permutation
  of all three reads as the default.
- The same storage key is used. The values are kept while the reverb is removed.

### 5.2 Presets

- **Capture and compare.** `SettingsSnapshot` gains `reverb`. A reverb that is not placed carries the
  default values. The snapshot's order is made **canonical** (`canonicalEffectOrder`): the placed
  effects keep their relative order, in the positions the default order gives them, and every
  missing effect keeps its default position. So where a missing effect sits never makes two presets
  differ, and with one effect placed or none the order is the default. With chorus and delay only,
  this gives exactly the rule presets had before, so no saved preset changes meaning.
- **Applying.** `applyControlsToEngine` writes the six params, the stage (§3.4), the input, and the
  full order. A preset without a reverb removes a placed one; an old preset loads as no reverb.
- **The list summary** names placed effects in chain order: `Drive · slo.nam · cab.wav · Chorus ·
  Delay · Reverb`.
- The saved-settings storage version stays 1.

### 5.3 Reload

The reverb, its power, its trails, its values and the order are restored on start and pushed to the
engine before audio flows. Nothing is asynchronous, so the startup-order protection is unaffected.

## 6. Documentation in the app

- The guide gets a **Reverb** page under Panels (the six types, MIX above and below 50 %, DECAY in
  seconds, the fifth knob per type, TRAILS, starting settings); *Effects tray and slots*, *How the
  signal flows* and *Presets* mention it.
- README: feature list, chain, presets summary example, test counts.

## 7. Files and boundaries

| File | Change |
|---|---|
| `engine/ReverbProcessor.{h,cpp}` | New. The processor. No browser or Emscripten headers. |
| `engine/Engine.{h,cpp}` | Member, chain entry, `kReverbSlot`, `Stage::Reverb`, three-way `setPostOrder`, `setReverbInput`. |
| `engine/bindings.cpp` | `setPostOrder(a, b, c)`, `setReverbInput`. |
| `engine/CMakeLists.txt`, `engine/build-wasm.sh` | Add the source and the test. |
| `engine/tests/test_reverb_processor.cpp` (new), `test_engine.cpp` | Host tests (§8). |
| `src/audio/engineMessages.ts`, `nam-engine.worklet.ts`, `AudioEngine.ts` | `'reverb'`, the order message, `setReverbInput`. |
| `src/audio/params.ts` | `REVERB_SLOT`, `REVERB_PARAMS`, type labels, the fifth knob's legends, DECAY ranges and formatter. |
| `src/state/persistence.ts` | `StoredReverb`, sanitising, the order migration, `updateReverb`. |
| `src/state/savedSettings.ts`, `src/audio/applyControls.ts` | Snapshot, canonical order, equality, controls, summary, apply, the trails rule. |
| `src/ui/panel/effectDrag.ts` | `'reverb'` in `EffectId`, on POST. |
| `src/ui/panel/TypeSwitch.tsx` (new), `ClipTypeSwitch.tsx` | The generalised switch; the drive uses it. |
| `src/ui/panel/TrailsSwitch.tsx` (new) | The TRAILS switch. |
| `src/ui/Knob/Knob.tsx` | Optional `format`. |
| `src/ui/panel/Chain.tsx`, `panel.css` | Live Reverb chip, the panel's two knob rows, the 2×3 switch, TRAILS. |
| `src/ui/screens/useEffectRack.ts`, `MainScreen.tsx` | Reverb placement, power, trails, values, type; order over three. |
| `src/ui/panel/tutorialContent.tsx`, `README.md` | §6. |

## 8. Verification

**Host C++ (CMake).** `ReverbProcessor`:

- MIX 0 leaves the output equal to the input; MIX 100 % removes the dry signal; at 50 % the dry is
  untouched.
- With MIX 100 % and PRE-DELAY 100 ms, nothing comes out before 100 ms.
- **Decay time.** For every type at DECAY 0, 50 and 100 %, the impulse response's energy decay (T30
  from −5 to −35 dB, measured below 1 kHz) is within ±30 % of the target RT60 (TONE 100 %, the fifth
  knob at 0). Measured: within 3 % for every type but SPRING, whose dispersion lengthens it by up to
  11 %.
- **Stability.** For every type with every knob at its maximum, 10 s of noise then 60 s of silence:
  the output stays finite and bounded, and the last second is quieter than the first second of silence.
- **Denormals.** A short tail decays to exact zeros.
- **Robustness.** NaN, ±infinity and absurd values for every param read as safe values; a non-finite
  input sample cannot poison later output; finite at 44.1, 48 and 96 kHz at every type.
- **Type change.** With a steady input, switching type never makes a sample-to-sample step larger than
  the steady signal's own largest step plus a small bound, and the new type is voiced within 30 ms.
- **Trails.** With the input closed, new input produces no reverb and the dry is at full level even at
  MIX 100 %; an existing tail keeps ringing; after the tail is below −120 dBFS for 100 ms the processor
  is idle and leaves the buffer untouched; opening the input wakes it.
- **Add-ons.** SHIMMER at 100 % puts at least 10 dB more energy an octave above a 220 Hz input than
  SHIMMER 0; BLOOM at 100 % moves the wet energy at least 3 dB later (the first 100 ms against 0.5 to
  1 s) than BLOOM 0; EARLY at 100 % puts at least 3 dB more energy in the first 40 ms than EARLY 0;
  DRIP changes the spring's output and stays stable.
- **Loudness.** At default settings, steady noise gives a wet level within ±4 dB of the input's for
  every type.
- `reset()` clears all state; the first params after a reset take effect at once.

`Engine`: the chain with Reverb in POST; param offsets (reverb 32); `Stage::Reverb` starts disabled,
enables independently and resets on false-to-true only; `setPostOrder` reaches all six permutations,
is a no-op when repeated, rejects anything else, resets only moved processors and leaves Drive and
every other stage in place; `setReverbInput` reaches the processor.

**Vitest.** Tapers and formatters for the reverb params (DECAY in seconds per type); type and fifth-knob
labels; the sanitiser for a missing, partial, out-of-range and hostile `reverb`, `trails` defaulting
on, and the order migration; the trails rule (enabled, input) for every combination; capture,
canonical order, equality, apply and summary for presets with and without Reverb and old presets;
`canDrop` for Reverb; the order rules over three effects.

**Browser** (read the DOM, stub the microphone):

1. The Reverb chip is live and drops only on POST.
2. Drop all three POST effects in different orders; the panels follow; the POST slot goes away only
   when all three are placed.
3. Title-drag and arrow keys reorder among three; the engine gets the full order.
4. The knobs, the type switch (legend and readout change) and TRAILS move the right params and send
   the right stage and input messages.
5. A reload restores placement, power, trails, values, type and order.
6. Presets with and without Reverb round-trip; an old preset removes it; the summary lists it.
7. The layout at 1900 px and at 375 px with every effect placed.

**By ear (yours).** Each type sounds like its name; no zipper noise from any knob; no click from the
type switch; shimmer climbs cleanly without warble; ambient blooms; the spring drips; trails ring out
and stop cleanly; long tails end in silence; CPU stays comfortable with a NAM loaded; the panic mute
still silences everything.

## 9. Risks

| Risk | Answer |
|---|---|
| A loop that gains energy at some setting is loud in headphones | The stability argument in §3.6, a host test at every type with every knob at maximum, and the panic mute. |
| Denormals pin the CPU on a 30 s tail | Explicit flush on every write-back; a host test that a tail ends in exact zeros; the trails idle. |
| CPU next to the NAM model | One core of eight lines and one add-on per type; coefficients per block; the idle when bypassed with trails. Checked by ear with a NAM loaded. |
| Clearing ~1.1 MB on a type change or reset costs time in one quantum | A memory fill of that size is well under a millisecond; it happens only on a deliberate change. |
| Shimmer warbles | The `sin²` windows sum to one and hide each tap's jump; the damping softens the climb; judged by ear. |
| Mono reverb sounds narrow | Accepted (§1); stereo is a separate decision. |
| Changing the order message breaks an old worklet or UI | Both ship together in one bundle; the worklet validates the permutation and ignores anything else. |
| Adding fields to presets confuses old data | Optional, read defensively, migrated, and covered by tests for missing and hostile records. |

## 10. Changed while building it

- **TONE** was first a damping low-pass at a cutoff. A plain one-pole in the loop compounds per pass,
  so on a long DECAY the mids died far sooner than DECAY said. It is now the input bandwidth plus a
  per-line absorption filter (§3.6), so DECAY is the RT60 heard below about 1 kHz and TONE sets how
  much faster the highs go.
- **Shimmer** first shifted four of the eight lines; at full SHIMMER the octave sat 14 dB under the
  note, too faint for the effect. Shifting all eight at the same blend gives the range in §3.7.
- **The input ramp** after a type change was added when the type-change test showed the new tank
  starting on a step of the input waveform (§3.8).
- **The canonical preset order** keeps missing effects in their default positions rather than moving
  them to the end, so presets saved before the reverb compare exactly as they did (§5.2).
- **Bloom** swells over 0.6 to 0.8 s rather than "about a second"; the crossfade term was added so
  BLOOM 0 really takes the long all-passes out of the path (a Schroeder all-pass at coefficient 0 is a
  pure delay, not a pass-through).
