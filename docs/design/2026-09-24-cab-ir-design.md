# Cab simulator — a fixed IR convolution stage after the NAM

**Date:** 2026-09-24
**Status:** Approved. Amended 2026-09-24: uploaded IRs and models are now saved in IndexedDB — see the note under §1.
**Refines:** [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §14 (which defers
IR/cab convolution past Phase 3) and
[2026-09-22-fixed-noise-gate-design.md](2026-09-22-fixed-noise-gate-design.md) §1, §5 (which
names this as the next milestone, after a feasibility spike).

---

## 1. Scope

The rack already has a CAB SIMULATOR panel (`CabSimPanel.tsx`): an IR picker, a custom-file
picker, a bypass switch and a LEVEL knob. None of it reaches the audio graph — the knob is
bound with `param={null}` and the engine has no convolution. This milestone puts DSP behind
it: a **fixed** cab stage, always between the NAM and the EQ, that convolves the signal
with one user-loaded impulse response.

Like the gate, it is a core stage and will stay one. A movable IR effect is a future
Phase 3 slot concern.

In scope:

- `CabProcessor` in the C++ engine — direct time-domain FIR, toggleable
- `cabLevel` as a new core parameter
- A `loadIr` command and an `irLoaded` reply, mirroring `loadModel` / `modelLoaded`
- `'cab'` added to `setStageEnabled`
- The cab's bypass persisted; `CabSimPanel` wired to the engine
- Main-thread decoding of a user-uploaded audio file into a mono 48 kHz tap array

Out of scope:

- **A bundled IR library.** No IR files exist to ship; users select their own.
- Persisting an uploaded IR across reloads. *(Superseded: uploads, for both this stage and the
  NAM stage, are now saved in IndexedDB — `src/state/uploadStore.ts` — listed in the dropdown
  under "Saved uploads", and the last selection is restored on start via `StoredControls.cabIr`.
  Raw file bytes are stored, so §4 preparation still runs on every load.)*
- IRs longer than the tap cap, partitioned/FFT convolution, stereo IRs, IR trimming UI
- Crossfade on IR swap or engage/bypass (rack-rewire §8 known gap, shared with every stage)

---

## 2. Chain position

```
Gate → InputGain → Nam[0 .. kNamCount-1] → Cab → Eq → OutputVolume
```

After the NAM, before the EQ: the order of a real rig (amp → cab → tone shaping → master),
and it lets the EQ sculpt the cabbed sound.

---

## 3. DSP — `CabProcessor`

A core processor, not a slot occupant.

**Convolution.** Direct FIR: `y[n] = Σ h[k] · x[n−k]` for `k < length`, where `length` is
the loaded IR's tap count. Direct rather than FFT because the IRs in scope are short
(guitar cab IRs are typically 10–50 ms) and direct convolution needs no partitioning, no
scratch allocation, and adds **no latency** beyond the IR's own delay.

**Tap cap.** `kMaxTaps = 4096` (≈ 85 ms at 48 kHz). Taps and the input history are
members, sized at construction; `process()` allocates nothing (spec §5.3).

**History.** A ring buffer of the last `kMaxTaps` input samples, written twice (at `i` and
`i + kMaxTaps`) so the dot product always reads one contiguous run and the SIMD loop needs
no modulo.

**Cost.** 4096 taps × 48 000 samples/s ≈ 197 M multiply-adds/s at full length; the loop
runs over `length` taps only, so a 1024-tap IR costs a quarter as much. WASM SIMD does four
per instruction. This is the feasibility question the gate spec left open, and §8 answers
it by measurement on the real machine rather than by estimate.

**No IR loaded ⇒ passthrough.** `length == 0` copies input to output. So enabling the stage
before a file is chosen is silent and harmless, and no separate "loaded" flag is needed.

**Reset.** `reset()` zeroes the history, not the taps — a stale tail must not leak into a
reordered position, but the loaded IR survives a reset. `Engine::setStageEnabled` also
resets on the false → true transition, as it does for the gate: a bypassed stage is not
run, so its history goes stale, and re-engaging must not convolve against old audio.

**History is written even with no IR loaded**, so an IR loaded mid-performance convolves
against real recent input instead of ramping in from silence. Input samples below 1e-20
are flushed to zero as they enter the history, so a decaying NAM tail cannot fill the
dot product with denormals (spec §5.3 rule 4).

**Loading an IR.** `loadIr(length)` copies `length` floats from a staging buffer into the
taps and sets `length`. It runs from the worklet's message handler, which the audio thread
executes between `process()` calls, so `process()` never sees a half-written tap array.
The history is **not** cleared on a swap. The abrupt tap change can click; that is the
known crossfade gap, not new to this stage.

---

## 4. Decoding — main thread, once

The engine only ever sees a mono, 48 kHz `Float32Array`. Everything else is done before the
`postMessage`, where allocating and being slow are fine:

1. `new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes)` — the browser decodes WAV
   (and whatever else it supports) and **resamples to 48 kHz**, so no resampler or WAV
   parser is written here. It does *not* down-mix: the result keeps the file's channel
   count, so the channels are then averaged into one.
2. Truncate to `kMaxTaps`. If truncated, apply a short fade-out over the last 64 samples so
   the cut is not a hard edge, and tell the user (§7).
3. **Normalise** so the IR's energy `sqrt(Σ h²)` is 1. IR files vary wildly in level; this
   keeps loudness roughly comparable between files, and LEVEL trims from there. The
   constant lives in one place and is a one-line change if it sounds wrong.
4. Reject silence (all zeros) and an empty decode with a message rather than loading it.

A failed decode (unsupported or corrupt file) reports through the same `log` channel the
NAM panel uses and leaves the previously loaded IR in place.

---

## 5. Parameter block — 56 floats

`cabLevel` is a **core** parameter, appended after `gateThreshold`:

| index | parameter |
|---|---|
| 0 | inputGain |
| 1–3 | bass, mid, treble |
| 4 | eqLevel |
| 5 | outputVolume |
| 6 | gateThreshold |
| **7** | **cabLevel** (new) |
| 8–55 | slot pool, 8 × 6 (was 7–54) |

Only the slot base moves, exactly as it did for the gate. Range and taper are
`levelSpec('cabLevel')` (−24 … +24 dB, default 0, detent at 0).

C++: `Engine.h` gains `kCabLevelIndex = 7`; `kSlotBaseIndex` becomes 8 and `kParamCount`
56. The static-assert chain gains "the cab level sits immediately after `gateThreshold`"
and "the pool starts immediately after the cab level". `bindings.cpp` exports
`getCabLevelIndex()` and the IR staging pointer; the worklet's instantiation-time layout
checks gain a `cabLevel` entry.

TypeScript: `cabLevel` joins `CORE_PARAMS` and `CORE_PARAM_ORDER` (after `gateThreshold`);
`PARAM_INDEX` gains `cabLevel`; `PARAM_COUNT` is 56. Stored control values are keyed by id,
so saved settings survive the renumbering.

The level is applied as a smoothed gain (one-pole, inside `CabProcessor`, like every
processor's anti-zipper smoothing) on the convolver's output.

---

## 6. Stage enable and IR load protocol

`StageId` becomes `'gate' | 'eq' | 'cab'`; C++ `Stage` gains `Cab = 2`. The TS → numeric
mapping stays in the one worklet table. The cab starts **disabled** in the engine.

New commands and replies, next to the NAM ones in `engineMessages.ts`:

```ts
{ type: 'loadIr'; bytes: ArrayBuffer }                    // raw Float32 taps, transferred
{ type: 'irLoaded'; ok: boolean; message: string }        // exactly one per loadIr
```

The worklet copies the transferred floats into the engine's IR staging buffer
(`kMaxTaps` floats, a member, pointer derived once), calls `engine.loadCabIr(length)` —
which rejects `length > kMaxTaps` and any non-finite tap — and replies.
`AudioEngine.loadCabIr(taps)` transfers the buffer, as `loadNamModel` does. The main
thread learns `kMaxTaps` from a new `maxIrTaps` field on the `ready` message, as it
learns `maxModelBytes`, rather than restating the constant.

---

## 7. Persistence and UI

- `StoredControls` gains `cabBypassed: boolean`, defaulting to **`true`**, sanitised like
  `gateBypassed` (anything other than a boolean `false` reads as `true`). Absent means the
  default, so `STORAGE_KEY` is not bumped. `cabLevel` persists through the existing
  `params` record.
- The selected IR is **not** persisted (§1). After a reload the panel shows "No IR loaded"
  and, if the stored bypass is off, the stage passes signal through unchanged.
- On start, the stored cab bypass is pushed to the engine beside the gate's and the EQ's.
- `CabSimPanel` follows `GatePanel`/`EqPanel`: it receives `engine`, `initialBypassed`, and
  the LEVEL knob already wired to its core `AudioParam` (`coreKnob('cabLevel')`). Its
  switch calls `engine.setStageEnabled('cab', …)` and `updateControls({ cabBypassed })`.
  Choosing a custom file runs §4 then `engine.loadIr`; the panel shows the file's name
  once `irLoaded` reports `ok`, and a truncation notice when §4 step 2 applied. The
  "UI only / nothing reaches the audio graph" comment is deleted.

---

## 8. Verification

Host C++ — new `engine/tests/test_cab_processor.cpp`:

- **Identity:** a unit impulse as the IR gives output equal to input
- **Known response:** a delayed, scaled impulse IR delays and scales an impulse input by
  exactly that amount; a two-tap IR against an impulse returns those two taps
- **Ring buffer wrap:** identical output for a block that straddles the history boundary
  and the same signal fed in one piece
- **Length respected:** a 64-tap IR is not affected by stale taps left from a longer
  previous IR
- **No IR ⇒ passthrough**, including right after construction
- **Reset** clears the tail but keeps the loaded IR
- **Finite** output across the ±24 dB level range and a full-scale input
- **Cost benchmark:** one second of audio through a full 4096-tap IR, timed on the host,
  asserted to take well under real time (a loose bound, printed so the ratio is visible).
  Host speed is only a proxy for WASM SIMD in the worklet — the by-ear run is the real
  check — but it catches an accidental O(n²) or a lost vectorisation immediately

Host C++ — `engine/tests/test_engine.cpp`:

- the layout is 56 floats, `cabLevel` at 7, pool at 8
- the chain is `Gate → InputGain → Nam → Cab → Eq → OutputVolume`, the cab bound to
  offset 7
- the cab starts disabled; `setStageEnabled` flips gate, cab and EQ independently

Vitest:

- `PARAM_COUNT === 56`, `PARAM_INDEX.cabLevel === 7`, `PARAM_INDEX.slotBase === 8`
- taper round-trip and formatter tests cover `cabLevel` as a core param
- `cabBypassed` sanitisation: absent → `true`, non-boolean → `true`, `false` survives
- the IR preparation function (§4) on synthetic buffers: truncation and fade-out,
  energy normalisation, silence rejected

By ear, guitar and headphones:

- with a cab IR loaded, the amp's fizz is tamed and the sound reads as a miked speaker
- bypass is audibly the raw NAM output; switching it on and off does not glitch beyond
  the known engage-click gap
- LEVEL moves loudness smoothly with no zipper noise
- loading a second IR while playing swaps the sound (a click is tolerated, silence or a
  crash is not)
- a 4096-tap IR plays for several minutes, with the NAM engaged, without a single crackle
  or dropout — this is the feasibility check the gate spec asked for; if it fails, the tap
  cap comes down before any FFT work is considered. (The Phase 2 spec promised a
  dropped-quantum counter and CPU meter, but neither was ever built, so this is by ear;
  the host benchmark above gives the objective number.)
- selecting a non-audio file reports an error and leaves the current IR playing

---

## 9. Risks

| Risk | Handling |
|---|---|
| 4096 taps too heavy for the worklet on this machine | The host benchmark and the by-ear run in §8; the cap is one constant, and the fallback is a lower cap, not a redesign. No in-app CPU meter exists to check it against |
| Layout drift between C++ and TS as the slot base moves again | Static asserts in `Engine.h` plus the new `cabLevel` entry in the worklet's instantiation-time layout checks, as for the gate |
| IR loudness varies by file | Energy normalisation in §4, with LEVEL to trim |
| IR swap click | Known crossfade gap shared with every stage; not addressed here |
| `decodeAudioData` support differs by browser | Chromium is the primary target; a decode failure is reported, never fatal |
