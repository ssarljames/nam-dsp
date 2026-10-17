# NAM PWA — Design Spec

**Date:** 2026-09-18
**Status:** Approved. Phase 1 is the implementation target. Phases 2 and 3 are recorded
here so Phase 1's architecture does not paint us into a corner, but they are explicitly
out of scope until Phase 1 is verified working with a real guitar through a real
interface.

---

## 1. Purpose

A browser-based, installable PWA for real-time guitar processing, built up in phases
toward Neural Amp Modeler (`.nam`) inference. It is the web sibling of the Android
`nam-loader` project and deliberately reuses its architecture: a chain of `Processor`
objects driven from the audio callback, with the UI growing additively phase by phase.

The distinguishing goal versus the Android app: **the controls must feel analog.** Not
sliders. Knobs with pointer-lock drag, non-linear tapers, detents, and a panel that looks
like hardware. This is a first-class requirement, not decoration — see §8.

Each phase must be fully working and verified by ear before the next phase begins.

---

## 2. Relationship to the Android `nam-loader` project

Carried over unchanged:

- The `Processor` interface — `virtual void process(float* buffer, int32_t numFrames) = 0`
- A single ordered chain run from one audio callback, so later phases insert stages
  without restructuring the engine
- Atomic/lock-free parameter targets with one-pole smoothing inside each processor
- RBJ Audio EQ Cookbook biquads for the tone stack
- NeuralAmpModelerCore as a **pinned git submodule** (not FetchContent) — model format
  compatibility is version-sensitive and warrants an explicit, reviewable pin
- Phase gates verified on real hardware by ear, not by an automated test suite
- Host-buildable CMake test target for the DSP math that *can* be checked analytically

Deliberately different:

| Android | PWA |
|---|---|
| Oboe `FullDuplexStream`, ring buffer between input and output streams | Web Audio graph — `MediaStreamAudioSourceNode` feeds the worklet directly; no ring buffer, no drift to manage |
| Kotlin/Compose UI, JNI bridge | React 19 + TypeScript UI, WASM module inside an `AudioWorkletProcessor` |
| Sliders | Canvas knobs with pointer lock, tapers and detents (§8) |
| `AudioManager.getDevices()` + `AudioDeviceCallback` | `enumerateDevices()` + `ondevicechange`; output via `setSinkId` |
| Device switch tears down and restarts a stream | Output switch needs no teardown at all; input switch rebuilds only the source node |
| APK install via `adb` | Installable PWA, offline-capable via service worker |

---

## 3. Honest constraints — read this before investing

**Latency.** The browser cannot reach native round-trip latency. Web Audio renders in a
128-frame quantum (2.67 ms at 48 kHz), but the capture path goes through `getUserMedia`
and the OS shared-mode mixer. Realistic desktop Chromium round trip with a USB interface
is **15–40 ms**, against sub-10 ms for Android + Oboe MMAP. The design minimises it
(§7) but cannot eliminate it. It is playable; it does not feel identical to plugging into
an amp. Accept this before Phase 1, not after.

**Output device selection is Chromium-only.** `AudioContext.setSinkId()` ships in
Chromium 110+. Firefox and Safari get "System default" and a one-line explanation. This
is the single largest reason the primary target is desktop Chromium.

**No guarantee NAM inference keeps up.** WASM SIMD is roughly 2–4× slower than native
for this workload. Phase 2 therefore ships a dropped-quantum counter and CPU headroom
meter *as part of the phase*, not as a nice-to-have — you need to see xruns rather than
infer them from the sound.

**Audio glitches under main-thread pressure.** `AudioWorklet` runs on a dedicated thread,
but a main thread that stalls can still starve `MediaStream` delivery. This is why the
knob rendering rules in §8 are mandatory rather than advisory.

---

## 4. Environment and tooling

- Ubuntu workstation.
- **Node 20+** and npm.
- **Emscripten SDK** (`emsdk`) — required before any native build. Not assumed present;
  installing and pinning it is the first task of Phase 1.
- A USB audio interface and **headphones** for testing. Speakers plus a mic-path monitor
  is an acoustic feedback loop; see the panic-mute requirement in §7.
- Chromium or Chrome 110+ for development.
- Dev loop: `npm run dev` (Vite, HMR). WASM rebuild is a separate, explicit
  `npm run build:wasm` — it is slow and must not sit in the hot reload path.

### Stack

- **Vite + React 19 + TypeScript**
- **`vite-plugin-pwa`** (Workbox) for manifest and service worker
- **Emscripten** compiles `src/engine/*.cpp` to `nam-engine.wasm` plus ES-module glue,
  built `-O3 -msimd128`, single-threaded, `MODULARIZE=1`, `ENVIRONMENT=web`
- **Vitest** for TypeScript units; **CMake + a host compiler** for C++ DSP unit tests
- No SharedArrayBuffer, no COOP/COEP headers — see §5.3

---

## 5. Architecture (all phases)

### 5.1 Threading model

```
main thread (React)
   │
   │  k-rate AudioParams ──────── continuous control values (knobs)
   │  port.postMessage ────────── structural changes (load model, reorder, enable)
   ▼
AudioWorkletGlobalScope — dedicated audio render thread, 128-frame quantum
   └─ NamEngineProcessor (AudioWorkletProcessor)
        └─ WASM module instance
             └─ ProcessorChain : std::vector<Processor*>

                 InputGain → Eq → [Nam] → [FX slot 0..N] → OutputVolume
```

> **Superseded (2026-09-22):** the EQ now runs after the NAM stages, not before —
> see [rack-rewire §2](2026-09-22-rack-rewire-design.md).

> **Superseded (2026-09-22):** the gate now runs first, ahead of `InputGain` — see
> [fixed-noise-gate §2](2026-09-22-fixed-noise-gate-design.md).

Graph:

```
MediaStreamAudioSourceNode → AnalyserNode (input meter)
                           → NamEngineWorkletNode
                           → GainNode (panic mute)
                           → AudioContext.destination
```

The `AnalyserNode` tap for the input meter sits **before** the worklet so the meter shows
what is actually arriving from the interface, independent of any processing.

Panic mute is a plain `GainNode` after the worklet rather than a parameter inside it, so
it works even if the WASM module has faulted.

**Channel count:** one channel in, one channel processed, duplicated to both output
channels. The worklet declares `outputChannelCount: [2]` and writes the same processed
buffer to both. Guitar input is mono; processing it twice would double the CPU cost of
NAM inference in Phase 2 for no audible benefit.

### 5.2 Parameter transport — the load-bearing decision

**Continuous control values travel as `AudioParam`s. Nothing else does.**

`AudioWorkletProcessor.parameterDescriptors` declares a **fixed pool** of parameters:

- Named core params: `inputGain`, `bass`, `mid`, `treble`, `outputVolume`
- Generic slot params: `slot0_p0 … slot7_p5` (8 slots × 6 params = 48)

> **Superseded (2026-09-22):** a sixth core param, `eqLevel`, sits after `treble` and
> before `outputVolume`; the block is 54 floats, not 53 — see
> [rack-rewire §4](2026-09-22-rack-rewire-design.md).

> **Superseded (2026-09-22):** a seventh core param, `gateThreshold`, follows
> `outputVolume`; the block is 55 floats, not 54 — see
> [fixed-noise-gate §4](2026-09-22-fixed-noise-gate-design.md).

Descriptors are fixed at class-definition time and cannot be added at runtime, which is
precisely why Phase 3's dynamic effects use a pre-declared pool rather than per-effect
descriptors. Each slot's occupying `Processor` reads its values out of the k-rate array
by slot index.

Why `AudioParam` rather than `postMessage` or a SharedArrayBuffer:

- Zero allocation, no message queue, no GC pressure during a knob drag
- Values arrive aligned to the render quantum, not to whenever the message loop drains
- No `SharedArrayBuffer`, therefore no COOP/COEP headers, therefore a trivial dev server
  and trivial hosting

**k-rate means one value per 2.67 ms block**, which is a coarse enough step to be audible
as zipper noise on a gain. Each C++ `Processor` therefore runs a **one-pole smoother**
internally toward the incoming target — identical to the Android `VolumeProcessor`
approach. Smoothing lives in C++, not in the browser's automation.

`port.postMessage` is reserved for events that happen once, not continuously:

- Loading `.nam` model bytes (transferred as an `ArrayBuffer`)
- Reordering the chain
- Enabling/disabling a slot
- Engine → UI telemetry: dropped-quantum count, CPU load, model metadata (posted at most
  ~10 Hz, never per quantum)

### 5.3 Real-time safety rules inside the worklet

These are non-negotiable and every phase must uphold them:

1. **No allocation, no `free`, no locks, no exceptions** on the `process()` path.
2. Every processor that can ever be used is **allocated once at engine construction**.
   Reordering permutes pointers in a `std::vector<Processor*>`; adding and removing an
   effect flips an enable flag. Nothing is constructed or destroyed in response to a
   user action.
3. Model loading (Phase 2) is the one genuinely heavy operation. It happens in the
   `port.onmessage` handler — which runs on the audio thread between quanta — so it must
   **build the new model off to the side and swap a single pointer**, with the old model
   released on a subsequent message tick, never mid-swap.
4. Denormals: flush-to-zero is not directly controllable in WASM. Feedback paths (delay,
   reverb) add a tiny DC-free dither or an explicit denormal-flush on the feedback
   state. Silently pinned CPU in a decaying delay tail is a real failure mode.

### 5.4 Processor interface

```cpp
class Processor {
public:
    virtual ~Processor() = default;
    // Contract: RT-safe. No allocation, locks, or exceptions.
    virtual void process(float* buffer, int32_t numFrames) = 0;
    virtual void prepare(double sampleRate, int32_t maxBlockSize) = 0;
    virtual void reset() = 0;                       // clear delay lines / filter state
    virtual void setParams(const float* params) = 0; // k-rate slice for this slot
    bool enabled = true;
};
```

`prepare()` is where every buffer a processor will ever need is allocated. `reset()` is
called on sample-rate change and on chain reorder so a stale delay tail cannot leak into
a new position in the chain.

### 5.5 Repo layout

```
nam-pwa/
├── docs/
│   └── design.md                 # this file
├── engine/                       # C++ — compiled to WASM and to host test binaries
│   ├── CMakeLists.txt            # host test build
│   ├── build-wasm.sh             # emcc invocation
│   ├── Processor.h
│   ├── ProcessorChain.{h,cpp}
│   ├── EqProcessor.{h,cpp}
│   ├── GainProcessor.{h,cpp}
│   ├── SmoothedValue.h
│   ├── bindings.cpp              # embind surface exposed to the worklet
│   └── tests/                    # host-run DSP unit tests
├── public/
│   ├── manifest.webmanifest
│   └── icons/
├── src/
│   ├── audio/
│   │   ├── AudioEngine.ts        # context lifecycle, graph wiring, param handles
│   │   ├── DeviceRepository.ts   # enumeration, hotplug, default selection
│   │   ├── nam-engine.worklet.ts # AudioWorkletProcessor + WASM host
│   │   └── params.ts             # param IDs, ranges, tapers, formatters
│   ├── ui/
│   │   ├── Knob/                 # canvas renderer, pointer logic, taper, a11y
│   │   ├── panel/                # chassis, legends, meters, LEDs
│   │   └── screens/
│   ├── state/                    # external store; see §8 perf rules
│   └── main.tsx
└── vite.config.ts
```

The `engine/` directory is built two ways from the same sources: by `emcc` for the
browser, and by CMake for host-run unit tests. Nothing in `engine/` may include a
browser or Emscripten header outside `bindings.cpp`, or the host test build breaks.

---

## 6. WASM ↔ worklet boundary

The worklet instantiates the WASM module from bytes passed in via
`processorOptions` (the worklet scope has no `fetch`, so the main thread fetches the
`.wasm` and hands over the `ArrayBuffer` at construction).

Per quantum:

1. Copy the 128-frame input into the WASM heap at a pre-allocated offset
2. Write the current k-rate parameter values into a pre-allocated param block
3. Call `chain_process(bufferPtr, 128)`
4. Copy back out to the output array

Two `HEAPF32.set` / `subarray` copies per quantum on 128 floats is negligible; the
pointers are obtained **once** at construction and never re-derived, because WASM memory
growth invalidates the JS views. The engine never grows its heap after `prepare()` — the
initial memory is sized for the worst case including the largest supported model.

Binding style: **embind** for the handful of setup calls, raw exported functions for the
hot path. `chain_process` must not go through embind.

---

## 7. Audio device handling

### Permission and enumeration

`enumerateDevices()` returns empty labels until microphone permission is granted. Flow:

1. Call `getUserMedia({ audio: true })` once to obtain permission
2. `enumerateDevices()` now returns real labels
3. Immediately stop those initial tracks and re-acquire with the real constraints

### Input constraints — these matter more than anything else on this page

```ts
{
  audio: {
    deviceId: { exact: id },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000,
    latency: 0,
  }
}
```

Leaving any of the three processing flags on gives a gated, pumped, latency-added signal
that sounds broken for guitar. Always verify with `track.getSettings()` that the
constraints were actually honoured, and surface a warning in the status line if they were
not — browsers silently ignore constraints they cannot satisfy.

### Sample rate

`new AudioContext({ latencyHint: 0, sampleRate: 48000 })`, and request 48 kHz in the
constraints too. A mismatch inserts a silent resampler plus latency. 48 kHz is also what
NAM models expect, so Phase 2 inherits the right rate for free.

`latencyHint: 0` requests the smallest buffer the platform will give. Fall back gracefully
if construction throws — some platforms reject the numeric form.

### Selection defaults

- Input: prefer a device whose label matches a known interface pattern, else the system
  default input
- Output: prefer the same physical device family as the input when identifiable, else
  system default

### Switching

- **Output**: `await audioContext.setSinkId(deviceId)`. No teardown, no restart. Guard
  with `'setSinkId' in AudioContext.prototype`; when absent, show "System default" and a
  short note that output routing needs Chromium.
- **Input**: acquire the new stream, create the new `MediaStreamAudioSourceNode`,
  connect it, disconnect the old one, then stop the old tracks. In that order — stopping
  first leaves an audible hole.

### Hotplug

`navigator.mediaDevices.addEventListener('devicechange', …)` re-enumerates. If the
currently selected device disappeared, fall back to default and say so in the status line
rather than failing silently.

### Latency readout

Report `audioContext.baseLatency + audioContext.outputLatency + (track latency)` in ms,
labelled **estimated**. A true measured round trip requires a physical loopback and is
out of scope.

### Feedback safety — mandatory in Phase 1

Monitoring a microphone or a high-gain input through speakers is a feedback loop.

- The engine starts **muted**. Audio passes only after an explicit "Engage" press.
- **Spacebar is a panic mute**, always, regardless of focus, implemented on the post-worklet
  `GainNode` with a short ramp.
- A dismissible headphones advisory on first run.

---

## 8. The analog control system

This section is a requirement, not a style note. "Feels analog" is the project's reason
for existing.

### 8.1 Interaction

- **Pointer Events** throughout (`pointerdown` / `pointermove` / `pointerup`) with
  `setPointerCapture` — one code path for mouse, touch and pen.
- **Pointer lock during desktop drag.** On `pointerdown`, request pointer lock; the cursor
  disappears and travel becomes unbounded, so a knob never "runs out of screen" and the
  cursor does not drift away from the control. This single detail accounts for most of
  the difference between a knob that feels like hardware and one that feels like a web
  widget. Fall back to unlocked relative-delta tracking where pointer lock is refused
  (it is, notably, on touch).
- **Vertical drag** as the primary gesture — up increases. Full range over ~200 px of
  travel.
- **Modifiers**: `Shift` = fine (×0.2), `Ctrl`/`Cmd` = coarse (×3).
- **Wheel** steps by the knob's step increment.
- **Double-click / double-tap** resets to the knob's default.
- **Touch**: enlarged hit target (≥44 px), `touch-action: none` to suppress scrolling,
  `navigator.vibrate(8)` at detents where supported.

### 8.2 Taper — the most commonly missed detail

Every knob maps normalized position `[0,1]` to its value through an explicit taper:

| Parameter kind | Taper |
|---|---|
| Gain / volume | Audio (logarithmic) taper |
| EQ band gain (bipolar, ±12 dB) | Linear with centre detent |
| Delay time, LFO rate, frequency | Exponential |
| Mix / blend | Linear, or slight S-curve |

A linear taper on a gain control bunches the entire useful range into the first tenth of
rotation. Tapers live in `src/audio/params.ts` beside the range and the display formatter
so a parameter is defined in exactly one place.

### 8.3 Detents and readout

- Bipolar parameters get a **centre detent** with magnetic snap within ~2 % of centre and
  a visible notch at 12 o'clock
- The numeric value appears on hover and during drag, then fades — the panel stays clean
  when nothing is being adjusted
- Values are always shown in real units: `−3.5 dB`, `250 ms`, `1.8 Hz`

### 8.4 Rendering

**Canvas 2D, procedural, DPR-aware.** Each knob owns one `<canvas>` sized
`cssSize * devicePixelRatio`.

Drawn per knob: a radial-gradient body, a bevel/rim highlight, the indicator line or
pointer, an arc value track outside the body, tick marks, and the detent notch where
applicable.

Procedural rather than sprite sheets because there is no asset pipeline to maintain, it
restyles per effect for free, and it stays crisp at any zoom or DPR. The renderer sits
behind a `KnobRenderer` interface so a sprite-sheet implementation can be substituted
later if photoreal artwork is ever wanted.

### 8.5 Performance rules — mandatory

- During a drag the knob writes **directly to its `AudioParam`** and repaints its own
  canvas on `requestAnimationFrame`. **React does not re-render.**
- Knob value lives in a ref plus an external store subscription; React state syncs on
  `pointerup`, or throttled to ~10 Hz if a readout elsewhere needs to track live.
- Rationale: 60 Hz reconciliation of a twenty-knob panel starves the main thread, and a
  starved main thread interrupts `MediaStream` delivery — a UI problem becomes an audio
  dropout.
- Repaint only on change and during drag. No always-on animation loop. Meters are the one
  exception and run on a single shared rAF for all of them, not one per meter.

### 8.6 Accessibility

Knobs are real controls, not decorations:

- Focusable, `role="slider"`, `aria-valuemin` / `aria-valuemax` / `aria-valuenow`
- `aria-valuetext` carries the **formatted** value ("−3.5 dB"), never the raw normalized
  number
- Arrow keys step, `PageUp`/`PageDown` step large, `Home`/`End` go to min/max
- Visible focus ring that is not swallowed by the canvas
- `prefers-reduced-motion` disables the value-readout fade

### 8.7 Panel look

Hardware chassis, not a web dashboard: brushed-metal or tolex ground, screen-printed
legends in a condensed face, skirted knobs with pointer lines, an LED-style engage
indicator, a VU-flavoured input meter. Implemented in CSS plus the knob canvases — no
image assets required.

Dark by default with a light variant; both must be explicitly painted, never inherited.

---

## 9. PWA shell

- `manifest.webmanifest`: name, short name, icons (192/512 plus maskable), `display:
  standalone`, `orientation: any`, theme and background colours matching the panel
- Service worker via `vite-plugin-pwa` in `generateSW` mode, precaching the app shell,
  the WASM binary and the fonts. Runtime caching is not needed — this app talks to no
  network service.
- **Offline is a real requirement**: once installed, the app must fully function with no
  network, including any models the user has saved (Phase 2 stores them in OPFS).
- An update prompt when a new service worker is waiting — never auto-reload, because a
  reload mid-session kills the audio stream.
- Installable on desktop Chromium and on tablets; layout must work from ~768 px tablet
  portrait upward, with the panel reflowing to a single column of effect rows.

---

## 10. Phase 1 — live monitoring and tone stack

**Goal: plug in, hear yourself in real time, and shape the tone with knobs.**

### Signal chain

```
Input device → InputGain → Eq (bass / mid / treble) → OutputVolume → Output device
```

### Engine (`engine/`)

- `Processor.h` — the interface from §5.4
- `SmoothedValue.h` — one-pole smoother; every parameter target passes through one
- `ProcessorChain.{h,cpp}` — owns the ordered `std::vector<Processor*>`, runs enabled
  processors in order, dispatches the k-rate param slice to each
- `EqProcessor.{h,cpp}` — three RBJ biquads: low shelf (bass), peaking (mid), high shelf
  (treble). ±12 dB per band. Coefficients recomputed only when the smoothed target has
  actually moved past a small epsilon, not every block.
- `GainProcessor.{h,cpp}` — smoothed linear gain, used for both input and output stages
- `bindings.cpp` — `createEngine`, `prepare`, `chainProcess`, `setParamBlock`,
  `getInputPtr` / `getOutputPtr` / `getParamPtr`
- `build-wasm.sh` — `emcc -O3 -msimd128 -sMODULARIZE=1 -sENVIRONMENT=web
  -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=…`
- `CMakeLists.txt` + `tests/` — host build of the same sources for DSP unit tests

### TypeScript (`src/`)

- `nam-engine.worklet.ts` — the `AudioWorkletProcessor`: instantiates WASM from the
  bytes in `processorOptions`, declares the parameter pool, marshals the quantum
- `AudioEngine.ts` — creates the `AudioContext`, loads the worklet module, wires the
  graph, exposes typed parameter handles and the panic mute
- `DeviceRepository.ts` — permission flow, enumeration, hotplug, defaults, constraint
  verification (§7)
- `params.ts` — every parameter's id, range, default, taper and formatter, in one place
- `ui/Knob/` — the knob component per §8
- `ui/panel/` — chassis, legends, engage LED, input meter, status line
- Status line: engage state, selected devices, estimated latency, and a warning if input
  constraints were not honoured

### Verification gate — Phase 1 is done when all pass with a real guitar

1. App installs as a PWA and launches offline
2. Microphone permission flow works; both device lists populate with real labels; the USB
   interface is offered and selectable
3. Plugging/unplugging an interface refreshes both lists live, and a disappearing
   selected device falls back gracefully with a visible message
4. Output device switching works in Chromium and degrades with a clear message elsewhere
5. `track.getSettings()` confirms `echoCancellation`, `noiseSuppression` and
   `autoGainControl` are all off
6. Monitoring is audibly clean — no clicks, no dropouts, no added noise, playable latency
7. All three EQ bands and both gain stages audibly do the right thing in real time with
   **no zipper noise** on fast knob moves
8. Knobs feel right: pointer lock engages, fine/coarse modifiers work, double-click
   resets, centre detents snap, tapers put the useful range in the middle of the travel
9. Knobs are fully keyboard-operable and announce formatted values to a screen reader
10. Status line shows a plausible estimated latency
11. Spacebar panic mute cuts audio instantly from any focus state
12. Dragging a knob continuously for 30 s produces no audio dropouts (the React
    re-render rule is actually holding)

---

## 11. Phase 2 — NAM model loading (not in scope now)

- NeuralAmpModelerCore added as a **pinned git submodule**; built by `emcc` with SIMD
  into the same WASM module
- `NamProcessor` inserted after the EQ: `InputGain → Eq → Nam → OutputVolume`

  > **Superseded (2026-09-22):** the EQ now runs after the NAM stages —
  > see [rack-rewire §2](2026-09-22-rack-rewire-design.md).
- Model loading: `<input type="file">` plus the File System Access API where available.
  Bytes transferred to the worklet as an `ArrayBuffer` via `postMessage`; the worklet
  builds the model and swaps a pointer per §5.3 rule 3.
- **Persistence in OPFS** so a model library survives reload and works fully offline;
  metadata index in IndexedDB
- Model metadata surfaced in the UI; sample-rate mismatch detected and reported
- **Dropped-quantum counter and CPU-load meter shipped as part of this phase** — inference
  may not keep up, and that must be visible rather than guessed at
- Gate: a real `.nam` file loads and plays in real time with zero dropped quanta over
  several minutes

---

## 12. Phase 3 — stackable, interchangeable DSP (not in scope now)

- `ProcessorFactory` and a slot registry; the chain becomes an ordered list of slot
  descriptors mapped onto the pre-allocated processor pool (§5.3 rule 2)
- Effects: delay, chorus, tremolo, compressor, boost/overdrive, noise gate
- Drag-and-drop pedalboard reordering; reorder posts a new order and permutes pointers,
  calling `reset()` on moved processors so no stale tail leaks into a new position
- Each effect gets its own knob cluster drawn from the same `Knob` component, styled per
  pedal
- Presets saved to OPFS with JSON export/import
- Gate: reorder and enable/disable while playing with no glitch, every effect audibly
  correct, denormals not pinning the CPU on decaying tails

---

## 13. Testing strategy

Audio quality is verified by ear — that is the phase gate. Automated tests cover the
things that fail *silently*:

**Host C++ (`engine/tests/`, CMake, run on the workstation):**
- Biquad coefficients stay finite across the full ±12 dB range at 44.1 and 48 kHz
- Each EQ band's magnitude response at its centre frequency matches the target gain
- `SmoothedValue` converges monotonically and reaches target within the expected block
  count
- Delay-line index arithmetic never reads out of bounds at any time/feedback combination
  (Phase 3)
- Chain ordering and enable flags produce the expected processor call sequence

**Vitest (`src/`):**
- Taper round-trips: `valueToNormalized(normalizedToValue(x)) ≈ x` across every declared
  parameter
- Formatters produce the expected strings at min, default and max
- Device default-selection logic against fixture device lists
- Hotplug reducer: selected device disappearing falls back to default

**Manual, per phase:** the verification checklist in that phase's section, with a real
guitar and a real interface.

---

## 14. Explicitly out of scope

- Any NAM, delay, chorus or tremolo code in Phase 1 — Phase 1 is input, EQ, gain, output
- SharedArrayBuffer, WASM threads, COOP/COEP
- Multichannel or true stereo processing (see the channel-count decision in §5.1)
- IR / cabinet convolution (the Android project's Phase 3) — revisit only after Phase 3
  here is verified
- Measured hardware-loopback latency calibration
- Any backend, account system, or cloud model library
- App store packaging beyond PWA installability

---

## 15. Open risks

| Risk | Mitigation |
|---|---|
| Round-trip latency too high to play comfortably | Measure and report it in Phase 1 before writing any DSP beyond the tone stack. If it is unplayable on the target machine, that is a Phase 1 finding, not a Phase 2 surprise. |
| Browser silently ignores input constraints | Verify with `getSettings()` and warn in the status line (§7) |
| NAM inference too slow in WASM | Phase 2's xrun counter makes it visible immediately; fallback is a smaller model or a reduced internal rate |
| Main-thread jank causing dropouts | §8.5 rules, plus the 30-second continuous-drag item in the Phase 1 gate |
| `setSinkId` unavailable outside Chromium | Feature-detect and degrade with an explicit message; documented as a known limitation |
| Denormals pinning CPU in feedback tails | Explicit denormal flush on feedback state (§5.3 rule 4), covered by a Phase 3 gate item |
