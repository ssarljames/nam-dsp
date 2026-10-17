# Chorus — the second effect, and choosing the order of the POST effects

**Date:** 2026-09-25
**Status:** Approved (design agreed in conversation; this document records it).
**Refines:** [2026-09-25-delay-effect-design.md](2026-09-25-delay-effect-design.md), which built
the first effect and left "more than one effect, moving a placed effect, or reordering" out of
scope; the engine rules in [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §5.3 and
§12 (a reorder permutes pointers and resets the moved processors); the presets in
[2026-09-24-saved-settings-design.md](2026-09-24-saved-settings-design.md) §3.

---

## 1. Scope

The delay proved the whole path for one effect. This milestone adds a simple **chorus** with the
same panel, the same behaviour and the same way of being added, and lets the two POST effects be
**placed together and put in either order**.

In scope:

- `ChorusProcessor` in the C++ engine, one pre-allocated instance, in pooled slot 2
- A changeable order for the two POST stages, permuted in the engine between audio blocks
- A Chorus panel like the Delay panel: power, remove, three knobs
- The Chorus tray chip, draggable onto POST like Delay
- Dragging a placed effect panel by its **title** to change the order, and ← / → on the focused title
- The stored working state and saved presets carry the chorus and the order

Out of scope, on purpose:

- More than these two effects, the PRE slot, more than one of each effect, and moving an effect
  anywhere other than within POST.
- Stereo. The engine is mono and duplicates to both channels, so this is a **mono chorus**: the dry
  signal plus a swept, delayed copy.
- A tempo sync, a feedback control, a filter on the wet signal, or a waveform choice. Any of these
  can follow as extra params in the same slot.
- The click when a stage is switched on or off, or when the order changes (the known stage-switch
  gap, rack-rewire §8).

## 2. Approach and why

Everything the delay established still holds: one fixed processor per effect, pre-allocated at
construction, disabled until the UI places it, its params in a pooled slot, no allocation in
`process()`. The chorus is a second instance of the same pattern.

The new part is **order**. The design spec's rule (§12) is that reordering permutes pointers and
resets the moved processors, so the engine gets one command that swaps the two POST entries in the
chain. The engine still owns exactly the same processors; only their sequence changes.

To keep `MainScreen` from copying the delay's wiring a second time, the two effects share one
small piece of screen logic (placing, removing, applying, ordering), written once and used for
both. See §6.

## 3. Engine

### 3.1 Chain position

```
Gate -> InputGain -> Nam[0..kNamCount-1] -> Cab -> {Chorus, Delay in either order} -> Eq -> OutputVolume
```

The two POST processors are adjacent, between the cab and the EQ. The default order is **Chorus
then Delay** (the usual one: the echoes repeat the chorused sound). The EQ shapes both.

### 3.2 `ChorusProcessor`

A mono chorus: the dry signal plus one copy delayed by a short, slowly swept time. **Dry always
passes at full level; the swept copy is added on top.**

| Param | Range | Default | Notes |
|---|---|---|---|
| Level | 0 to 100 % | 50 % | How strongly the swept copy is added. 0 % leaves the dry signal unchanged. |
| Rate | 0.05 to 5 Hz | 0.8 Hz | Speed of the sweep. Skewed so 0.8 Hz sits at mid travel. |
| Depth | 0 to 100 % | 50 % | How far the delay is swept: 0 % is a fixed delay, 100 % is ±6 ms. |

Behaviour and rules:

- The delay time is `12 ms + depth × 6 ms × sin(phase)`, so it stays between 6 ms and 18 ms. The
  phase advances by `rate / sampleRate` per sample and wraps.
- The line is read with **linear interpolation**. Level, rate and depth are **smoothed** inside the
  processor (as everywhere, design spec §5.3), so moving a knob never zippers or clicks.
- **Fixed storage.** The line is a member array of 4096 samples, enough for 18 ms at rates up to
  96 kHz plus interpolation headroom. Nothing allocates in `process()`.
- **Non-finite input** (NaN or infinity) is treated as zero when written to the line, so one bad
  sample can never poison it. Denormals are flushed.
- **Parameters** are clamped to their ranges in the processor, and a non-finite value reads as a
  safe default, so a bad number can never index outside the line.
- **`reset()`** clears the line and the phase. As for the delay, the first `setParams` after a reset
  takes effect at once (the chain only calls `setParams` on an enabled stage, so the targets are
  stale until then).

### 3.3 Parameters and stage switch

- The three params live in **pooled slot 2**: `slot2_p0` level, `slot2_p1` rate, `slot2_p2` depth
  (`kChorusSlot = kNamCount + 1`, `kChorusParamIndex = kSlotBaseIndex + kChorusSlot × kParamsPerSlot`
  = 20). The delay stays in slot 1. The 56-float block does not change. `static_assert`s keep both
  slots inside the pool and clear of the NAM stages and of each other.
- `Engine::Stage::Chorus = 4`, mapped from `'chorus'` in the worklet. Like the delay it starts
  **disabled** and is reset on the false-to-true transition only.

### 3.4 Order

- New command `setPostOrder(first)`: which of `Chorus` / `Delay` runs first. The engine remembers the
  current order, so repeating a command is a no-op; a change swaps the two chain entries (a new
  `ProcessorChain::swapEntries(i, j)`) and **resets both processors**, so no stale tail leaks into a
  new position.
- It runs on the audio thread between render quanta like every other structural command, so nothing
  is mid-`process()` when the entries swap. It allocates nothing.
- The wire format is `'chorus' | 'delay'` in the worklet message, mapped to the `Stage` values;
  anything else changes nothing.
- The engine receives the order as **two facts**: which stages are enabled, and which comes first.
  Placing, removing and power are exactly as for the delay (§3.4 of that spec: enabled = placed and
  not bypassed).

## 4. Screen

### 4.1 The tray

Chorus becomes a live chip exactly like Delay: a `button` dragged with pointer events, Enter adds
it, Space does nothing (panic mute). Both live chips may be dragged only onto POST. A chip is shown
**in use** while its effect is placed. The hint reads "Drag an effect onto POST" while either is
missing, and "The effects are in the chain — remove one with its ✕" when both are placed. Compressor,
boost and tremolo stay inert.

### 4.2 The POST area

- The POST area shows the **placed effects in their order**, each as its own panel, followed by the
  thin **POST slot** while at least one of the two is missing. A dropped effect goes to the end, after
  whatever is already placed; the order is then changed by dragging (§4.4).
- The POST slot is a drop target for both chips and lights up while a chip that fits is dragged, as
  today. With both placed there is no slot, and both chips read "in use".

### 4.3 The Chorus panel

The same panel as Delay, titled CHORUS: a power switch, a small ✕ that removes it and returns its
chip, and three 56 px **knobs**: LEVEL, RATE, DEPTH, in that order (the same order as the delay's
LEVEL, TIME, FEEDBACK). The knobs write straight to the slot AudioParams while turned and sync
state and storage on release, so turning one never re-renders the chain. Its cell has the delay's
width, and the knob row uses the same narrowed gap so all three sit on one line.

### 4.4 Changing the order

- **Drag by the title.** The panel's title area is the handle. A press that moves past a small
  threshold starts a drag with a ghost of the title; the other placed effect panel is the drop
  target, split at its middle (release on its left half to go before it, right half to go after).
  Releasing anywhere else changes nothing. The power switch and ✕ are excluded from the handle, so
  they still click. Pointer events, so it works with a mouse and on touch; the title has
  `touch-action: none`.
- **Keyboard.** The title is focusable, with a label such as "Move Chorus. Left and right arrows
  reorder", and **← / →** move the effect one place. Alt and Ctrl combinations stay unused (browser
  back, desktop switching). The panic mute is untouched.
- The panels re-render once when the order changes (the layout changes), never on a pointer move;
  the hover highlight is a class toggled directly, as for the tray.
- Reordering is immediate and audible: the screen writes the new order to storage, tells the engine
  (`setPostOrder`), and both effects restart clean (§3.4).

### 4.5 Accessibility

The chip states are announced ("in use" or the instruction to add), each panel is a labelled group
with a labelled power switch and remove button, and the title handle has the label in §4.4. The
focus problem seen with the delay (focus falls to the page after an Enter-add) is fixed here for
both effects: after adding an effect from the keyboard, focus moves to the new panel's power switch.

## 5. State

### 5.1 The working state

`StoredControls` gains two fields, read like `delay`:

```
chorus: { present: boolean; bypassed: boolean; level: number; rate: number; depth: number }
effectOrder: ('chorus' | 'delay')[]   // always a permutation of both; default ['chorus', 'delay']
```

Absent, unreadable or out of range values read as **no chorus** with defaults, and an order that is
not a permutation of the two ids reads as the default. A record stored before this feature therefore
stays valid and cannot come back with a chorus. Values are stored in their own units and clamped on
read. The same storage key is used; no migration is needed. As for the delay, the values are kept
while the chorus is removed.

Placing an effect moves it to the **end** of `effectOrder`; removing one leaves the order alone.

### 5.2 Presets

The chorus and the order are part of a preset (a preset is "the sound"):

- **Capture and compare.** `SettingsSnapshot` gains `chorus` and `effectOrder`. A chorus that is not
  placed carries default values, and the order is the default unless **both** effects are placed
  (the order of a missing effect is not part of the sound), so hidden state never makes two presets
  differ. `settingsEqual` includes them.
- **Applying.** `applyControlsToEngine` sets the chorus params and stage, and the order. A preset
  without a chorus **removes** a placed one; an old preset (no `chorus`, no `effectOrder`) loads as
  no chorus and the default order. The chain re-keys as for the delay so the panels and their order
  show the new state. The device ids and the live state are still untouched.
- **The list summary** mentions each placed effect, in order, for example `slo.nam · cab.wav ·
  Chorus · Delay`. The saved-settings storage version stays 1.

### 5.3 Reload

The chorus, its power, its values and the order are restored on start like the delay, and pushed to
the engine before audio flows. Nothing about them is asynchronous, so the startup order protections
(the SIGILL fix) are unaffected.

## 6. Files and boundaries

| File | Change |
|---|---|
| `engine/ChorusProcessor.{h,cpp}` | New. The processor. No browser or Emscripten headers. |
| `engine/ProcessorChain.{h,cpp}` | `swapEntries(i, j)`. |
| `engine/Engine.{h,cpp}` | Member, slot 2, `Stage::Chorus`, the order and `setPostOrder`. |
| `engine/bindings.cpp` | `setPostOrder` binding. |
| `engine/CMakeLists.txt`, `engine/build-wasm.sh` | Add the source and the test. |
| `engine/tests/test_chorus_processor.cpp` (new), `test_engine.cpp`, `test_processor_chain.cpp` | Host tests (§7). |
| `src/audio/engineMessages.ts`, `nam-engine.worklet.ts`, `AudioEngine.ts` | `'chorus'` stage and `setPostOrder`. |
| `src/audio/params.ts` | `CHORUS_SLOT`, `CHORUS_PARAMS`, `CHORUS_PARAM_INDEX`. |
| `src/state/persistence.ts` | `StoredChorus`, `effectOrder`, sanitising, `updateChorus`, `updateEffectOrder`. |
| `src/state/savedSettings.ts`, `src/audio/applyControls.ts` | Snapshot, equality, controls, summary, apply. |
| `src/ui/panel/effectDrag.ts`, `useEffectDrag.ts` | `EffectId` gains `'chorus'`; both drop on POST. |
| `src/ui/panel/effectOrder.ts` (new) | Pure ordering rules (place at end, move, drop before or after). |
| `src/ui/panel/usePanelDrag.ts` (new) | Pointer-event drag of a panel title, and the arrow keys. |
| `src/ui/panel/EffectPanel.tsx` (new) | The panel shared by Delay and Chorus: power, remove, title handle, knob row. `DelayPanel.tsx` becomes a thin use of it or is replaced. |
| `src/ui/panel/Chain.tsx`, `panel.css` | Live Chorus chip, POST area, title handle, panel-drag ghost and highlight. |
| `src/ui/screens/MainScreen.tsx` and a shared rack hook | State and wiring for both effects and the order (§2). |
| `README.md` | Feature list, chain, presets, test counts. |

The pure parts (`effectOrder.ts`, and the drag rules) are unit-tested without a browser.

## 7. Verification

**Host C++ (CMake).** `ChorusProcessor`:

- with depth 0, a fixed 12 ms delay: an impulse returns at exactly 576 samples (48 kHz) at the set
  level, and dry is unchanged;
- with depth above 0 the returned delay moves within 6 to 18 ms over a rate period, never outside it;
- level 0 leaves the output equal to the input;
- rate, depth and level clamp, and NaN, infinity or an absurd value cannot read outside the line;
- a non-finite input sample cannot poison later output (NaN, +inf and -inf, over many seconds);
- `reset()` clears the line and the phase; the first params after a reset take effect at once;
- changing rate or depth mid-stream never jumps by more than a small bound (the smoothing works);
- the line and limits are safe at 44.1, 48 and 96 kHz.

`ProcessorChain`: `swapEntries` swaps two entries and their offsets and rejects a bad index.
`Engine`: the chain order in both orders and the param offsets (delay 14, chorus 20); `Stage::Chorus`
starts disabled, enables independently and resets on false-to-true only; `setPostOrder` swaps, is a
no-op when repeated, resets both processors, and leaves every other stage in place; audio through
both orders differs as expected (chorus into delay is not delay into chorus).

**Vitest.** Tapers and formatters for the chorus params; the sanitiser for a missing, partial,
out-of-range and hostile `chorus` and `effectOrder`; the order rules (place at end, move, drop
before or after, the arrow-key move); capture, equality, apply and summary for presets in every
combination (none, either, both, both orders), and old presets; the panel-drag rules.

**Browser** (the same method as the delay: read the DOM, stub the microphone):

1. Both chips are live buttons; the others inert; both drop only on POST.
2. Drop each; the panels appear in the order dropped; the chips read "in use"; the POST slot goes
   away only when both are placed.
3. Drag a panel by its title over the other: the order swaps, the engine is told, and a release
   elsewhere does nothing; the power switch and ✕ still click. Focus the title and press ← and →.
4. Knobs, power and remove behave like the delay's; a drag never re-renders the chain.
5. A reload restores placement, power, values and order.
6. Presets: each combination and order round-trips; an old preset removes both effects.
7. The layout at 1900 px and at 375 px with both panels placed.

**By ear (yours).** A smooth, musical sweep at typical settings with no zipper noise or clicks
when a knob moves; depth 0 sounds like a short slapback; order audibly changes the sound; nothing
misbehaves at extreme settings; the panic mute still silences everything.

## 8. Risks

| Risk | Answer |
|---|---|
| A reorder click or a stale tail in the new position | Both processors reset on a real change, and the swap happens between blocks; host-tested. The click at the moment of a swap is the known stage-switch gap. |
| A bad number indexing outside the line | Every param is clamped in the processor, non-finite reads as a safe default, and the read index is built in integers as for the delay. |
| Drag conflicts: the title handle against the panel's controls | The power switch and ✕ are excluded; the drag starts only from the title text area, past a threshold. |
| Touch scrolling fights the drag | The handle has `touch-action: none`, as the tray chip does. |
| Two effects copy the delay's wiring and drift apart | One shared rack hook and one shared panel component (§6). |
| Adding fields to presets confuses old data | Both are optional and read defensively, and covered by tests for missing and hostile records. |
