# Delay — the first effect, dragged from the tray into the POST slot

**Date:** 2026-09-25
**Status:** Approved (design agreed in conversation; this document records it).
**Refines:** [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §5.3 (engine rules) and
§12 (Phase 3 effects); the fixed chain in
[2026-09-24-cab-ir-design.md](2026-09-24-cab-ir-design.md) §2; the presets in
[2026-09-24-saved-settings-design.md](2026-09-24-saved-settings-design.md) §3.

---

## 1. Scope

The effects tray holds five placeholder chips and the chain has thin PRE and POST placeholder
slots. Nothing behind them is real. This milestone makes **one** effect real, end to end, so the
whole path is proven before the rest are built: a simple **delay** with LEVEL, TIME and FEEDBACK,
dragged from the tray into the POST slot.

In scope:

- `DelayProcessor` in the C++ engine, one pre-allocated instance, between the cab and the EQ
- Three parameters in pooled slot 1, and a power switch
- The tray's Delay chip made draggable, and the POST slot made a drop target
- A Delay panel in the chain (power switch, remove button, three sliders)
- Persistence in the working state, and inclusion in saved presets

Out of scope, on purpose:

- The other four tray effects (compressor, boost, chorus, tremolo) and the PRE slot. They stay
  inert placeholders.
- More than one delay, moving a placed effect, or reordering.
- A processor factory, a slot registry, or a chain that can be reordered. That is Phase 3's
  general machinery (design spec §12); one effect does not justify it. See §2.
- Tap tempo, sync to a tempo, ping-pong, modulation, a filter or damping in the feedback loop.
  Any of these can follow as extra params in the same slot.
- Fixing the click when a stage is switched on or off (a known gap, rack-rewire §8). It applies
  here as it does to the other stages.

## 2. Approach and why

The engine keeps its rule that everything is pre-allocated at construction and that adding or
removing a stage flips a flag (design spec §5.3). So the delay is **one fixed
`DelayProcessor` member**, always present in the chain and disabled until it is placed, exactly as
the gate and cab are. The UI's notion of "placed in the slot" is a flag over it.

The alternative, building the general factory, registry and reorderable chain now, is the right
shape for many effects but is far larger than one delay needs. It is deferred until a second or
third effect shows what it should look like. The delay is written so that the next effect follows
the same pattern (a pooled slot for its params, a stage id, a chip, a slot).

## 3. Engine

### 3.1 Chain position

```
Gate -> InputGain -> Nam[0..kNamCount-1] -> Cab -> Delay -> Eq -> OutputVolume
```

The delay follows the cab and precedes the EQ. That matches the screen (the POST slot sits between
the Amp and Cab panel and the EQ), and it lets the EQ shape the repeats as well as the dry sound.

### 3.2 `DelayProcessor`

A mono delay line. **Dry always passes at full level; the repeats are added on top.**

| Param | Range | Default | Notes |
|---|---|---|---|
| Level | 0 to 100 % | 30 % | Strength of the repeats. 0 % is silent repeats, dry unchanged. |
| Time | 20 to 1000 ms | 350 ms | Skewed so 250 ms sits at mid travel. |
| Feedback | 0 to 90 % | 35 % | Capped below 100 % so a loop can never grow without bound. |

Behaviour and rules:

- **Time is smoothed** and read with linear interpolation, so changing it bends the pitch like a
  tape echo rather than clicking or zippering. Level and feedback are smoothed too. All smoothing
  is inside the processor, as everywhere else (design spec §5.3).
- **Fixed storage.** The line is a member array sized for 1 s at 48 kHz, plus interpolation
  headroom, about 190 KB. Nothing allocates in `process()`. The heap is 192 MB and cannot grow
  (`ALLOW_MEMORY_GROWTH=0`), so a fixed member is the only kind that is safe.
- **Denormals.** The feedback state is flushed to zero when it falls below a tiny threshold, so a
  decaying tail cannot pin the CPU (design spec §5.3 rule 4, and its Phase 3 gate item).
- **Non-finite input** is treated as zero when written to the line, so one bad sample can never
  poison the loop for good.
- **`reset()`** clears the line and the smoothers' history.
- **Time is clamped** to the supported range at the processor, whatever the parameter block holds.
- **Sample rate.** `prepare()` takes the actual rate. If it is above 48 kHz the maximum time is
  reduced to fit the fixed line rather than reading out of bounds.

### 3.3 Parameters and stage switch

- The three params live in **pooled slot 1** (`slot1_p0` level, `slot1_p1` time, `slot1_p2`
  feedback). Slot 0 belongs to the NAM. The 56-float parameter block does not change. Engine.h gains
  `kDelaySlot = kNamCount` with a `static_assert` that it lies inside the pool and clear of the NAM
  slots.
- `Engine::Stage` gains `Delay = 3`, and the worklet maps `'delay'` onto it. Like the cab, the
  delay starts **disabled**, and `setStageEnabled(Delay, true)` calls `reset()` on the
  false-to-true transition only, so re-engaging never plays a stale echo.
- **Removing the delay** (the UI's remove button) disables the stage, so its tail is cut at once.
  This is the same behaviour as switching any stage off.

### 3.4 The engine sees one flag

"Placed in the slot" and "powered on" are UI states. The engine receives one boolean: the stage is
enabled when the delay is placed **and** not bypassed.

## 4. Screen

### 4.1 The tray chip

The tray's Delay chip becomes a real control; the other four keep their placeholder look and
stay inert.

- It is a `button` that can be **dragged with pointer events**, so it works with a mouse and on
  a touch screen (HTML5 drag-and-drop does not work on touch). A drag shows a ghost of the chip.
- Delay may only be **dropped on POST**. Dragging it over PRE shows a no-drop cursor and does
  nothing on release.
- Pressing **Enter** on the focused chip adds it too, so the feature is usable without a pointer.
  Space is deliberately not used, because it is the panic mute.
- While a delay is placed, the chip is shown as **in use** and cannot be dragged again. Only one
  delay is supported.
- The hint text reads "Drag Delay onto POST" instead of "coming soon", and the chips that are
  still placeholders keep their "not available yet" tooltip.

### 4.2 The POST slot

- Empty, it stays the thin placeholder it is today.
- While the chip is being dragged, it **highlights and widens** slightly as a drop target.
- On drop it becomes the **Delay panel**.

### 4.3 The Delay panel

A panel like the others, in the POST position, with:

- a title, DELAY;
- the standard **power switch** (bypass keeps it in the slot);
- a small **remove button** (✕) that takes it out of the slot and returns the chip to the tray;
- three vertical sliders: LEVEL (%), TIME (ms), FEEDBACK (%), with the app's usual value readouts
  and a marked mid position.

The sliders are the same `LevelSlider` used elsewhere. They write straight to the `AudioParam` while
being dragged and update React state on release, so a drag never re-renders the page.
The panel's chain cell gets its own fixed size.

### 4.4 Behaviour

- Adding and removing are immediate and audible; a removed delay starts from silence when added
  again.
- The panel and the slot are part of the chain's scroll area and pan like the rest.
- A screen-reader user gets a labelled group for the panel, a labelled remove button, and a labelled
  chip whose state (available or in use) is announced.

## 5. State

### 5.1 The working state

`StoredControls` gains one optional record, read like the NAM slot:

```
delay?: { present: boolean; bypassed: boolean; level: number; time: number; feedback: number }
```

Values are stored in their own units (percent, milliseconds, percent) and clamped on read.
Absent, or anything that fails to read, means **no delay**: `present: false`, defaults for the
rest. A record written before this feature therefore stays valid, and nothing that was stored
before can come back with a delay. `bypassed` defaults to `false`.

The same keys, `nam-pwa.controls.v1`, are used; no migration is needed because the field is
optional.

### 5.2 Presets

A preset is "the sound" (saved-settings §3), so **the delay is part of it**: `SettingsSnapshot`
gains the same `delay` record.

- **Capture and compare.** `captureSettings` reads it through the same sanitiser, and
  `settingsEqual` includes it, so adding a delay or moving its sliders makes the preset show as
  changed.
- **Applying.** `applyControlsToEngine` sets the three slot params and the delay stage, so a preset
  with a delay adds it, one without **removes** it, and one with different values changes them.
  `settingsToControls` carries it into the working state, and the chain re-keys, so the panel and
  the slot show the new state. The device ids and the live state are still untouched.
- **Old presets** have no `delay` and load as "no delay". Loading one on top of a sound that has a
  delay removes it. That is the correct reading of "a preset is the sound"; saving over a preset
  stores the delay from then on.
- **The list summary** (`summarise`) mentions the delay when a preset has one, for example
  "Slo 100 · Cab · Delay".
- The saved-settings storage version stays 1: the field is optional and read defensively, as the
  spec's §3.4 rule allows.

### 5.3 Reload

The delay is restored on start like every other control: whether it is placed, its power, and its
three values. Nothing about it is loaded asynchronously, so it adds nothing to the startup order
that the SIGILL fix protects.

## 6. Files and boundaries

| File | Change |
|---|---|
| `engine/DelayProcessor.{h,cpp}` | New. The processor. No browser or Emscripten headers. |
| `engine/Engine.{h,cpp}` | Member, chain entry, `kDelaySlot`, `Stage::Delay`, reset on enable. |
| `engine/bindings.cpp` | Nothing new if `setStageEnabled` is already generic; otherwise the `Delay` id. |
| `engine/CMakeLists.txt`, `engine/build-wasm.sh` | Add the new source. |
| `engine/test_delay_processor.cpp` | New host tests (§7). |
| `engine/test_engine.cpp` | Chain order and param offsets updated. |
| `src/audio/params.ts` | Slot-1 specs (level, time, feedback), formatters, and the taper. |
| `src/audio/engineMessages.ts`, `nam-engine.worklet.ts` | `'delay'` stage id and its mapping. |
| `src/audio/applyControls.ts` | Delay params and stage. |
| `src/state/persistence.ts` | The optional `delay` record, sanitising, defaults. |
| `src/state/savedSettings.ts` | Snapshot, equality, summary. |
| `src/ui/panel/Chain.tsx`, `DelayPanel.tsx`, `panel.css` | Draggable chip, drop target, panel. |
| `src/ui/panel/effectDrag.ts` | New. Pure drag logic (below). |
| `src/ui/screens/MainScreen.tsx` | Wiring: state, the AudioParams, drop and remove, apply. |
| `README.md` | Feature list and test counts. |

`effectDrag.ts` holds the small pure parts (whether a drag is over a valid target for an effect,
whether a pointer moved far enough to count as a drag and not a click) so they are unit-tested
without a browser.

## 7. Verification

**Host C++ (CMake).** `DelayProcessor`:

- an impulse returns at exactly the set time, in samples, at 48 kHz;
- successive repeats fall by the feedback ratio, within a small tolerance;
- at maximum feedback the output decays and never grows over a long run;
- the level parameter scales the repeats and leaves the dry signal unchanged;
- the time range is clamped, and a huge or NaN value cannot read out of bounds;
- denormals are flushed, so a long decay ends in exact zeros;
- `reset()` clears the line;
- a disabled stage is skipped and passes the signal through;
- a non-finite input sample does not poison later output.

`Engine`: the chain order, the slot-1 parameter offsets, `Stage::Delay` enabling with a reset on
the false-to-true transition only, and the `kDelaySlot` asserts.

**Vitest.** The tapers round-trip and the formatters at minimum, default and maximum; the
sanitiser reads a missing, partial, out-of-range and hostile `delay` record; capture, equality,
summary and apply for presets with and without a delay; old presets; and `effectDrag`.

**Browser** (the same method as the presets: read the DOM, stub the microphone):

1. The tray shows the Delay chip as draggable, the others inert, and PRE refuses a drop.
2. Dragging Delay onto POST adds the panel; the chip shows "in use"; Enter on the chip also adds it.
3. The three sliders move their `AudioParam`s and read out sensible values; a drag does not
   re-render the chain.
4. The power switch and the remove button behave; removing returns the chip.
5. A reload restores the placement, the power and the values.
6. A preset saved with a delay restores it, a preset without one removes it, and the unsaved-changes
   dot appears when a slider moves.
7. The layout at 1900 px and at 375 px, with the panel scrolling in the chain.

**By ear (yours).** Set the time by feel and sweep it: no zipper noise, just a tape-like bend.
Feedback at maximum builds a long tail that still dies away. The repeats are shaped by the EQ. The
tail is clean when the delay is bypassed and re-engaged. Nothing clicks when it is dropped in or
removed beyond the known stage-switch gap.

## 8. Risks

| Risk | Answer |
|---|---|
| A runaway feedback loop is loud and hurts headphone users | Feedback is capped at 90 %, non-finite input is zeroed, the loop is covered by a decay test, and the panic mute still works. |
| Denormals in the tail pin the CPU | Explicit flush plus a host test that a long decay reaches exact zero. |
| Touch drag conflicts with panning the chain by dragging | The chip's drag starts only from the chip, which is a control, and the chain's pan already ignores drags that begin on a control. |
| Adding a field to presets confuses old data | The field is optional, read defensively, and covered by tests for missing and hostile records. |
| The chain's fixed panel width does not fit three sliders | The panel gets its own fixed size; checked at both widths. |
| A second effect wants a different pattern | Accepted. This milestone exists to find out; the general machinery is written afterwards, from a working example. |
