# Sarlifier

A guitar amp rig that runs in your browser. Plug a guitar into an audio interface, open
the page, and play through a noise gate, a drive pedal, an amp, a cab impulse response,
chorus, tremolo, delay, reverb and a three-band EQ, all running in a single WebAssembly audio worklet.
The amp stage loads [Neural Amp Modeler](https://www.neuralampmodeler.com/) (`.nam`)
captures, so any amp someone has profiled can sit in the chain. It installs as a
Progressive Web App and works offline.

The controls are built to feel analog: non-linear tapers, centre detents, and knobs and
sliders that write straight to the audio engine while you drag.

## Contents

- [Features](#features)
- [Using it](#using-it)
- [The signal chain](#the-signal-chain)
- [Presets](#presets)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [What is stored, and where](#what-is-stored-and-where)
- [Status and known gaps](#status-and-known-gaps)
- [Requirements](#requirements)
- [Commands](#commands)
- [Architecture](#architecture)
- [Testing](#testing)
- [Licences](#licences)

## Features

- **Live monitoring** with a start screen, an explicit **Start audio** step and a
  headphones advisory. The engine starts muted.
- **Signal chain:** Noise gate, Input gain, Drive (optional, PRE), NAM amp model, Cab IR, Chorus,
  Tremolo, Delay and Reverb (optional, in any order), EQ, Output volume.
- **NAM models:** select your own `.nam` files from your device. None are bundled (see [Licences](#licences)).
- **Cab impulse responses:** select your own `.wav` from your device. None are bundled.
- **Your files persist.** Models and IRs you select are stored locally in IndexedDB, never sent to a server, always appear in
  their dropdown, and can be removed with a small trash button.
- **Noise gate** with a threshold slider beside a live level meter; signal below the
  threshold shows in grey.
- **Three-band EQ** (bass, mid, treble) with its own level.
- **Delay effect:** drag it from the effects tray into the POST slot. LEVEL, TIME and
  FEEDBACK knobs; a power switch and a remove button on its panel. **Tap tempo:** click the
  TIME knob in rhythm. The last few taps (up to four intervals) set the time, a pause of more
  than two seconds starts over, and the result stays within 20 to 1000 ms. Dragging the knob
  still turns it; because two quick clicks are two taps, double-click does not reset TIME.
- **Chorus effect:** drag it from the effects tray into POST, like the delay. LEVEL, RATE and
  DEPTH knobs; a power switch and a remove button on its panel. A mono chorus: the dry
  signal plus one copy delayed 12 ms and swept by up to ±6 ms.
- **Drive effect:** drag it from the effects tray into the PRE slot, before the amp model. GAIN
  (+6 to +48 dB), TONE (800 Hz to 12 kHz low-pass) and LEVEL (±24 dB) knobs, and a SOFT / HARD /
  ASYM clipping switch. Anti-aliased clipping (first-order ADAA) and automatic level matching.
- **Reverb effect:** drag it from the effects tray into POST. Six types on a 2×3 switch:
  ROOM, HALL, PLATE, SPRING, SHIMMER and AMBIENT. MIX, DECAY (read out in seconds for the
  type), TONE and PRE-DELAY knobs, plus a fifth knob whose job follows the type: EARLY
  (room reflections), MOD (hall and plate movement), DRIP (spring dispersion), SHIMMER
  (octave-up amount) or BLOOM (how slowly the ambient wash swells in). A **TRAILS** switch
  lets the tail ring out when the reverb is switched off. Mono, like the rest of the rig.
- **Tremolo effect:** drag it from the effects tray into POST. LEVEL (±24 dB), RATE (0.5 to
  15 Hz) and DEPTH knobs, and a WAVE switch of four drawn waves: sine, triangle, square and a
  saw that swells then drops. The square's and the saw's edges are softened over 2 ms so they
  never click. **Tap tempo:** click the RATE knob in rhythm for one pulse per tap, as on the
  delay's TIME.
- **Effect order:** with two or more POST effects in the chain, drag a panel by its title
  onto another (its left half puts it before, its right half after), or focus the title and
  press ← or →. Chorus, tremolo, delay, reverb is the default.
- **Presets:** save, recall, rename, duplicate, delete and undo named sounds, with a
  bottom preset bar and keyboard shortcuts.
- **Tuner** in a popup modal: a large note name with a cent meter.
- **Device handling:** pick the input and output, with hot-plug fallback. Latency is
  shown in the top bar.
- **Panic mute** on the spacebar, from anywhere.
- **Installable and offline:** a PWA with a precached shell and an update prompt.
- **Message log:** a small terminal-style log for warnings and errors.
- **Guide and tour:** the ? button in the top bar opens a guide to every panel. The first
  time the rig is ready, a guided tour dims the page and walks through each control with
  Back and Next; replay it from the guide's **Take the tour** button.

## Using it

1. Wear **headphones**. Monitoring a guitar through speakers is a feedback loop.
2. Open the app and press **Start audio**, then allow the microphone. The engine begins
   muted; turn the **Live** switch in the top bar to hear it. Press **Space** at any time
   to mute.
3. Pick your interface in **Input** and **Output**. Echo cancellation, noise suppression
   and auto gain are always off; the app checks that the browser honoured that.
4. Select a `.nam` file from your device in the **Amp and Cab** panel (for example one from
   [TONE3000](https://www.tone3000.com/)). Optionally load a cab impulse response.
5. Shape the tone with the sliders, and save the result as a preset.

### The screen

- **Top bar:** the Live switch, the app name, input and output pickers, the input level
  meter, the latency readout and a tuning-fork button that opens the tuner. On phones and
  tablets it reflows to fit.
- **Effects tray:** a row of effects. **Delay**, **Chorus**, **Reverb**, **Tremolo** and **Drive** are real.
  Drag Delay, Chorus, Reverb or Tremolo onto the POST slot; a line shows the gap it will go into among the
  effects already there, and it lands there. Focus a chip and press Enter to add it after
  the others instead. Drag Drive onto the PRE slot to add it before the amp model; the PRE
  slot only takes Drive. An empty slot is a thin dashed marker; once it holds effects it
  is a dashed box around their panels. Compressor and boost are placeholders and not functional yet.
- **The chain:** panels laid out left to right, scrollable by dragging the empty
  background (or Alt-drag anywhere that isn't a control). Space is not used for panning,
  because it is the panic mute.
- **Preset bar:** docked at the bottom, with the message-log button in its right corner.

### Controls

Every level control is a vertical slider with a marked mid position where it has a
neutral point. Dragging writes directly to the audio engine and does not re-render the
page, so a drag can't starve the audio. A focused slider can also be nudged with the
arrow keys.

## The signal chain

```
Noise gate → Input gain → Drive (optional) → NAM amp model → Cab IR → Chorus / Tremolo / Delay / Reverb (optional, any order) → EQ → Output volume
```

Mono in, processed once, duplicated to both output channels.

| Stage | Controls | Notes |
| --- | --- | --- |
| Noise gate | Threshold, −80 to 0 dB; power | Always first. Opens above the threshold and closes after the level has fallen back below it. At the minimum it never closes. |
| Input | Gain, −24 to +24 dB | Unity at mid travel. |
| Drive (optional) | Gain +6 to +48 dB, Tone 0 to 100 %, Level ±24 dB, Type SOFT / HARD / ASYM; power | Only in the chain once dropped into PRE. 100 Hz tightening high-pass, ADAA clipping, DC blocker, level matching, a 2nd-order low-pass tone, then level. A type change crossfades over 10 ms. |
| NAM amp model | Model picker, level, power | One model slot. Models are 48 kHz `.nam` files. |
| Cab IR | IR picker, level, power | Direct convolution, up to 4096 taps (about 85 ms at 48 kHz). Longer IRs are truncated with a short fade-out. Passes audio through unchanged when no IR is loaded. |
| Delay (optional) | Level 0 to 100 %, Time 20 to 1000 ms, Feedback 0 to 90 %; power | Only in the chain once dropped into POST. Dry passes at full level and the repeats are added on top. Time changes bend the pitch like a tape echo. Feedback is capped at 90 %, so it cannot run away. |
| Chorus (optional) | Level 0 to 100 %, Rate 0.05 to 5 Hz, Depth 0 to 100 %; power | Only in the chain once dropped into POST. Mono: dry at full level plus one copy delayed 12 ms, swept ±6 ms at full depth. Runs before the delay by default; changing the order restarts the effects that moved. |
| Reverb (optional) | Mix 0 to 100 %, Decay 0 to 100 % (shown in seconds), Tone 0 to 100 %, Pre-delay 0 to 250 ms, the type's knob 0 to 100 %, Type ROOM / HALL / PLATE / SPRING / SHIMMER / AMBIENT; Trails; power | Only in the chain once dropped into POST. One eight-line feedback delay network voiced per type, with an add-on each: early reflections, spring dispersion loops, an octave-up shifter in the loop, bloom diffusers. Up to 50 % MIX adds the reverb to a full dry signal; above it the dry fades out. A type change fades the tail out over 30 ms and restarts it. With Trails on, power-off lets the tail ring out. |
| Tremolo (optional) | Level ±24 dB, Rate 0.5 to 15 Hz, Depth 0 to 100 %, Wave SINE / TRI / SQUARE / SAW; power | Only in the chain once dropped into POST, after the chorus by default. The gain follows the wave between full level and 1 − depth, so it only ever turns down; Level makes up for it. The wave passes a 2 ms smoother, so the square's and the saw's jumps, and a wave change, never click. Tap tempo on Rate. |
| EQ | Bass (100 Hz shelf), Mid (800 Hz peak), Treble (3.2 kHz shelf), each ±12 dB; level; power | Bypassing the EQ also bypasses its level. |
| Output | Volume, −60 to +6 dB | Default −6 dB. |

A bypassed stage is skipped entirely.

### Loading models and IRs

- Selecting a `.nam` or `.wav` file from your device loads it and saves it to IndexedDB in one step.
- IRs are decoded at 48 kHz on the main thread, mixed down to mono, truncated if needed,
  normalised to unit energy, and rejected if empty, silent or not finite. Stereo IRs are
  supported by downmixing.
- The trash button removes the selected saved file. The model or IR that is playing
  is not unloaded, but the stage is then treated as **missing** (see below).
- A model that fails to load, or is larger than the size limit, is logged and the panel
  does not claim it is loaded.

## Presets

A preset ("saved setting" in the code) is a named snapshot of the sound. Use the bar at
the bottom of the screen.

**What a preset stores:** the parameter values (input gain, gate threshold, EQ bands and
level, cab level, output volume), each NAM slot's model, level and power, the cab IR, the
drive (placed, power, values and type), the delay, the chorus, the tremolo and the reverb
(whether each is in the chain, its power and its values; the tremolo's wave and the reverb's
type and trails too), the order of the
placed POST effects, and the power state of the gate, EQ and cab. Models and IRs are stored by **reference**, not
by content.

**What it does not store:** the audio devices (they belong to the machine, not the
sound), the Live switch, and the engaged state. Loading a preset never changes any of
those and never un-mutes the engine.

### The bar

- A **name button** shows the current preset and its position ("2 / 5"); a dot appears
  when the sound has **unsaved changes**. Click it to open the list.
- **Previous / next** buttons step through the presets.
- **Save** overwrites the current preset; it reads "Save changes" when there is
  something to save and "Saved" when there isn't. With no preset, it asks for a name.
  On phones the button is hidden and Save lives in the ⋯ menu.
- The **⋯ menu:** Save changes, Save as new, Rename, Duplicate, Revert changes, Delete
  and the keyboard-shortcut list.

### The list

Opens upward from the name button with a search box at the top. Search matches preset
names and the model or IR each one uses. Each row shows the name and a one-line summary,
with a check on the loaded one. Hover a row (or move to it with the arrow keys) for
rename and delete; the bottom of the list has a **Save as new** field.

- **Rename** is inline (pencil icon or `F2`); names are trimmed, capped at 40 characters
  and kept unique.
- **Delete** shows a toast with **Undo**, which restores the preset in its old position.
- **Empty names are never saved.**

### Loading a preset

- The name updates at once; the sound follows after about **200 ms**, so a quick run of
  `[` and `]` presses applies only the last one.
- Only what differs is applied. A model that is already loaded is not reloaded, so
  stepping between presets that share an amp model is seamless.
- **Unsaved changes are discarded** when you leave a changed preset, with a
  "Changes discarded" toast and **Undo**. There is no confirmation dialog.
- The working sound also survives a reload: unsaved edits and the current preset are
  still there, dot included.

A preset **without** a delay, chorus, tremolo or reverb removes one that is in the chain, since a
preset is the whole sound; presets saved before an effect existed load without it. The list
summary names the placed effects in chain order, for example
`Drive · slo.nam · cab.wav · Chorus · Tremolo · Delay · Reverb`.

### A missing model

A preset can name a model or IR that isn't on this device: a file you removed, or an
export from another machine. Then:

- everything else in the preset is applied;
- that stage stays **off** for the session, so the wrong sound is never played, and its
  picker reads "Missing: name";
- a toast and a log warning say so, and the preset's row in the list shows a "!";
- **the stored preset is not altered.** Selecting a file with the same name later makes
  it work; picking another model and saving fixes the preset.

Removing a saved file that the current sound uses is treated the same way, so it does
not turn the current preset into an unsaved change.

## Keyboard shortcuts

Shortcuts are ignored while a modal (the tuner) is open, during text composition, and on
key repeat. Single-key shortcuts are also ignored while you type in a text field.

| Key | Action |
| --- | --- |
| `[` / `]` | Previous / next preset |
| `1`–`9` | Jump to that preset |
| `/` or `Ctrl/Cmd+K` | Open the list with search focused |
| `Ctrl/Cmd+S` | Save (and stop the browser's own Save dialog) |
| `Ctrl/Cmd+Shift+S` | Save as new (opens the name field) |
| In the list: `↑` `↓`, `Enter`, `Home` `End`, `Esc`, `F2`, `Delete` | Move, load, first or last, close, rename, delete |
| `←` / `→` on a focused effect title | Move that effect one place in the chain |
| `Space` | **Panic mute**, everywhere |

Deliberately unused: Space for anything but the mute, plain arrows (they nudge sliders and knobs, and move a focused effect title),
Alt combinations (browser back and forward; Alt-drag pans the chain) and Ctrl+arrows
(desktop switching on some systems).

## What is stored, and where

Everything lives in the browser; nothing is sent anywhere. The keys keep the project's
original `nam-pwa` prefix, because renaming them would drop everyone's saved sounds.

| Data | Where | Key |
| --- | --- | --- |
| The current sound (controls, devices, models, bypass states, the effects and their order) | `localStorage` | `nam-pwa.controls.v1` |
| Presets | `localStorage` | `nam-pwa.saved-settings.v1` |
| `.nam` and `.wav` files you selected | IndexedDB, database `nam-pwa`, store `uploads` | `upload:<file name>` |
| The dismissed headphones advisory | `localStorage` | `nam-pwa.headphones-advisory-dismissed` |
| The guided tour has been finished or skipped | `localStorage` | `nam-pwa.tour-done` |

Stored data is sanitised when read and never throws. In a browser that refuses
`localStorage` writes (private mode) presets still work from memory for the session, but
the unsaved-changes dot cannot update.

## Status and known gaps

The rack, the presets and the cab stage are implemented and build. Outstanding:

- **By-ear acceptance.** The Phase 1 gate (a twelve-item checklist with a real guitar and
  interface, design spec §10) and the cab and preset listening checks are for a human.
  Phases 2 and 3 are out of scope until the first gate passes.
- **Five real effects.** Drive, chorus, tremolo, delay and reverb process audio; compressor and
  boost do not yet, and only one of each effect can be placed. Changing the POST order
  restarts the effects that moved, which cuts their tails; switching a stage on or off can
  still click at that moment (with Trails on, switching the reverb off does not).
- **The reverb is mono,** like the whole engine: it adds depth, not stereo width.
- **One amp slot** in the UI, though the engine is built for more.
- **No bundled cab IRs.** Select your own from your device.
- **Presets are local.** There is no export or import yet, no touch swipe on the preset
  name, and switching stages on or off can still click at the moment of the change.
- **Chrome only in practice.** Output selection needs `setSinkId`; other browsers show a
  message instead.
- **Latency** is 15–40 ms round trip on desktop Chromium.

- [NAM PWA design](docs/design/2026-09-18-nam-pwa-design.md)
- [NAM loader](docs/design/2026-09-20-nam-phase2-loader-design.md)
- [Fixed noise gate](docs/design/2026-09-22-fixed-noise-gate-design.md)
- [Rack rewire](docs/design/2026-09-22-rack-rewire-design.md)
- [Cab IR](docs/design/2026-09-24-cab-ir-design.md)
- [Saved settings](docs/design/2026-09-24-saved-settings-design.md)
- [Chorus](docs/design/2026-09-25-chorus-effect-design.md)
- [Delay](docs/design/2026-09-25-delay-effect-design.md)
- [Drive](docs/design/2026-09-25-drive-effect-design.md)
- [Reverb](docs/design/2026-10-01-reverb-effect-design.md)
- [Tremolo](docs/design/2026-10-06-tremolo-effect-design.md)

## Requirements

- Node 20+
- Chromium 110+
- A USB audio interface and **headphones** (speakers + monitored input is a feedback loop)
- Emscripten SDK — pinned under `.emsdk/`, set up automatically by `npm run build:wasm`
- NeuralAmpModelerCore — a pinned git submodule under `engine/third_party/`. Clone with
  `git clone --recurse-submodules`, or in an existing checkout run
  `git submodule update --init --recursive`; the engine does not build without it
- CMake/CTest for the C++ host tests (not on PATH by default — see below)

## Commands

```bash
npm run dev          # Vite dev server + HMR for the UI
npm run build:wasm   # emcc build of the DSP engine, then rebuilds the worklet bundle
npm run build        # build:wasm -> tsc -b -> vite build
npm test             # Vitest (TypeScript units) — currently 434 passing in 21 files
npm run gen:licenses # regenerate public/third-party-licenses.txt after a dependency bump
```

C++ DSP tests build with CMake against a host compiler (not emcc):

```bash
npm run test:cpp     # needs cmake >= 3.16 and ctest on your PATH
```

## Architecture

A single `AudioWorkletProcessor` hosts the whole C++ `Processor` chain, compiled by
Emscripten with SIMD — not a graph of per-effect `AudioWorkletNode`s, and not DSP in
TypeScript. Knob values travel as k-rate `AudioParam`s through a fixed pre-declared
parameter pool (a 56-float core block); `postMessage` is only for one-shot structural
events (model and IR load, reorder, enable/disable, telemetry). Every processor is
pre-allocated at construction — `process()` never allocates, frees, locks, or throws.

The input meter and tuner tap the signal before the worklet, so they show what the
interface is sending; the panic mute is a plain gain node after it, so it still works if
the WASM module has faulted.

`engine/` builds two ways from the same sources: emcc for the browser, CMake for host
unit tests.

See the [NAM PWA design](docs/design/2026-09-18-nam-pwa-design.md) for the locked
architectural decisions and known constraints (input settings, sample rate, knob
rendering, and device switching order).

## Testing

Audio quality is verified by ear, not by unit test. Automated tests cover what fails
silently: C++ DSP math (CMake/CTest), and in Vitest the parameter tapers and formatters,
device selection, IR preparation, saved-file and control persistence, and the preset logic
(storage, sanitising, the shortcut resolver, the apply coalescer, loaded-model tracking).
Layout, the preset bar and the panels are verified in the browser.

## Licences

Sarlifier's own code is released under the [MIT License](LICENSE).

**No amp models or impulse responses are distributed with the app.** Captures on sites
such as [TONE3000](https://www.tone3000.com/) belong to their creators, and TONE3000's
terms forbid bundling or redistributing them through another platform. Users select their
own files, which stay in their browser. Keep any local test models in
`local-models/` (gitignored), not `public/`, because everything in `public/` is copied
into the build.

The third-party code that ships in the app is listed, with full licence texts, in
[`public/third-party-licenses.txt`](public/third-party-licenses.txt). The app serves it at
`/third-party-licenses.txt` and links to it from the guide. It covers
NeuralAmpModelerCore (MIT), Eigen (MPL 2.0), nlohmann/json (MIT), the Emscripten runtime
(MIT/NCSA), React (MIT) and Workbox (MIT). It is generated from those components' own
licence files by `npm run gen:licenses`.

Sarlifier is not affiliated with or endorsed by Neural Amp Modeler or TONE3000.
