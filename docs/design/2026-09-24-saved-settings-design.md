# Saved settings — named presets you can step through

**Date:** 2026-09-24
**Status:** Draft, awaiting review.
**Builds on:** [2026-09-24-cab-ir-design.md](2026-09-24-cab-ir-design.md) (the cab stage),
the upload store (`src/state/uploadStore.ts`), and the layout on `horizontal-rack`
(top bar, pinned chain). Its Phase 3 counterpart is main spec
[2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §12, "Presets saved to OPFS with
JSON export/import" — this spec replaces the OPFS part (see §4).

---

## 1. Scope

A **saved setting** is a named snapshot of the rack: every level, every stage's power state, and
which NAM model and cab IR are selected. A player can save the current sound under a name, come
back to it later, and step through their saved sounds quickly — with a mouse, a keyboard or a
touch screen.

**Naming.** The interface says **Preset**. In code the type is `SavedSetting`, because the
codebase already uses "preset" for the bundled model and IR lists (the panels'
`presets` state, "a preset URL"). Those keep their meaning; nothing here renames them.

In scope:

- Save, save as new, rename, duplicate, delete (with undo), revert
- A preset bar docked at the bottom of the screen: previous, name and list, next, save, menu
- A searchable list; keyboard shortcuts; swipe on touch
- Knowing when the rack differs from the loaded preset ("unsaved changes")
- Applying a preset to the running engine, including loading a different model or IR
- Export and import as JSON
- What happens when a preset names a model that is not on this device

Out of scope, on purpose:

- Reordering presets by dragging, folders, tags, or a setlist
- Bundling model or IR **files** inside an export (presets store names, not audio)
- MIDI program-change control (§9 records it as the natural next step)
- The Phase 3 custom-effect chain — presets are versioned so they can carry it later (§3.4)
- Cloud sync or sharing

---

## 2. Layout — a bar along the bottom

```
┌ top bar: name · live · devices · latency · level · tuner ────────┐
│                                                                  │
│                     the signal chain                             │
│                                                                  │
├ preset bar ──────────────────────────────────────────────────────┤
│ PRESET     [◀] [ Crunch rhythm    2 / 4 ●  ▴ ] [▶] [Save] [⋯]    │
└──────────────────────────────────────────────────────────────────┘
```

- **Why the bottom.** It is under the thumb on a phone or tablet, and near where the eyes rest
  on a desktop. It also separates "which sound am I on" from the controls that shape it, so
  switching reads like a footswitch. The top bar keeps only session controls.
- **The name button** shows the preset name, its position ("2 / 4") and, when the rack differs
  from what was saved, an amber dot. Clicking it opens the list.
- **The list** opens **upward**. It has a search box (matches names and the model or IR
  summary), one row per preset (name, then a one-line summary such as "Slo 100 · 4x12
  Greenback"), a check on the loaded one, rename and delete icons on hover or focus, and a
  "Save as new" field at the bottom. Enter in that field saves.
- **Save** reads "Saved" (quiet) when nothing changed and "Save changes" (accented) when
  something did. It never blocks: there is no confirmation on save.
- **⋯ menu:** Save as new…, Rename, Duplicate, Revert changes, Export all as JSON, Import from
  JSON, Delete, Keyboard shortcuts.
- **Feedback.** Every action shows a one-line toast above the bar ("Loaded “Crunch rhythm”",
  "Deleted “Lead boost” · Undo"), announced through a polite live region.
- **Phones (≤ 640 px).** The name button shrinks, Save moves into the ⋯ menu, and the arrows
  keep their size. The name button also takes a left or right swipe for previous and next.
- **The log button.** The floating log button currently sits at the bottom-right and would
  collide with the bar. It moves to the bar's right edge as an icon button.
- **Height.** The bar costs about 55 px of page height. It is sticky, so the chain has that
  much less room on a short window.
- **Empty state.** With no saved presets the name button reads "No preset · Save current…",
  the arrows do nothing, and the list shows only "Save as new".

---

## 3. What a preset contains

### 3.1 Saved

Everything a player would call "the sound":

| Field | Source today |
|---|---|
| Core levels: input gain, gate threshold, EQ bass / mid / treble / level, cab level, output volume | `StoredControls.params` |
| Each NAM stage: selected model, level, power | `StoredControls.nam[slot]` |
| Cab: selected IR, power | `StoredControls.cabIr`, `cabBypassed` |
| Gate power, EQ power | `gateBypassed`, `eqBypassed` |

Models and IRs are stored **by reference**: a bundled model by its URL, an uploaded one as
`upload:<name>` (the id the upload store already uses). A preset never contains audio bytes.

### 3.2 Not saved, by design

- **The audio devices** (`inputId`, `outputId`). They belong to the machine, not the sound;
  loading a preset must not re-route audio.
- **Whether the app is live.** Loading a preset never un-mutes. The engine starts muted and
  only an explicit throw of the live switch makes sound (main spec §7); nothing here may
  weaken that.
- Tuner state, panel collapse state, scroll position.

### 3.3 Shape

```ts
interface SavedSetting {
  id: string;          // stable, generated once; names may change, ids do not
  name: string;        // 1–40 characters after trimming
  settings: {
    params: Partial<Record<CoreParamId, number>>;
    nam: Record<number, { url: string | null; bypassed: boolean; level: number }>;
    cabIr: string | null;
    cabBypassed: boolean;
    gateBypassed: boolean;
    eqBypassed: boolean;
  };
}
```

`settings` is deliberately the same shape as the slice of `StoredControls` above, so capturing
the rack and applying a preset reuse the existing read and write paths.

### 3.4 Versioning

The stored record carries `version: 1`. Reading sanitises every field the way
`sanitiseControls` does (clamp, drop what is not a number, ignore unknown keys), so a hand-edited
or older record can never put a NaN on an `AudioParam`. When Phase 3 adds a custom-effect chain,
`settings` gains a `chain` field; a record without one means "the default chain".

---

## 4. Storage

`localStorage`, one key `nam-pwa.saved-settings.v1`:

```ts
{ version: 1, activeId: string | null, order: string[], byId: Record<string, SavedSetting> }
```

- **Why not IndexedDB or OPFS.** A preset is about a kilobyte of JSON, so hundreds fit easily,
  reads are synchronous at start, and the sanitising code already exists for this shape. The
  large things — model and IR bytes — are already in IndexedDB and are referenced, not copied.
  This supersedes main spec §12's "presets saved to OPFS".
- **Never throws.** As in `persistence.ts`, a storage failure (private mode, quota) is logged
  once and the session carries on with in-memory presets that will not survive a reload.
- **Order** is creation order and is what "next", "previous" and `1`–`9` follow. Duplicate
  inserts the copy right after the original.
- **Names are unique, case-insensitively.** A collision on save, rename, duplicate or import
  appends " 2", " 3", … rather than refusing. Names are trimmed; empty is rejected inline.

### 4.1 The working state and "unsaved changes"

Today `nam-pwa.controls.v1` holds the live state and is written on every change. That stays: it
is the **working state**, and it survives a reload including edits nobody saved.

The active preset is a separate pointer (`activeId`). The rack is **dirty** when the sanitised
working state differs from the active preset's `settings`. This is a plain deep comparison run
after each committed change — not during a slider drag, so the knob rule (React stays out of the
way while a control moves) is untouched.

- After a reload the dirty dot returns if there were unsaved edits.
- Deleting the active preset leaves the working state as it is; the bar reads "No preset" (unsaved, with no dirty dot).
- A rack with no active preset is never "dirty", it is simply unsaved; Save then behaves as
  Save as new and focuses the name field.

---

## 5. Applying a preset

Applying is the delicate part. It changes parameters (cheap), stage switches (audible), and
possibly models (slow). In order:

1. **Parameters.** Written to the core `AudioParam`s. The engine already smooths every one
   inside its processor, so a level change does not zipper.
2. **Stage power.** `setStageEnabled` and `setNamEnabled`. These click today — the crossfade gap
   recorded in rack-rewire §8. **Precondition:** that gap is closed before presets are advertised
   for live switching, or the release notes say plainly that switching can click.
3. **Models and IRs.** Only stages whose selection **differs** from what the engine already has
   are reloaded. The engine tracks the identity it last loaded per stage, so applying a preset
   that shares the amp model with the current one loads nothing.
4. **The working state** is written, `activeId` is set, dirty clears.

### 5.1 Coalescing

A NAM load runs on the audio thread and is heavy. Stepping with `]` four times must not queue four
loads. The bar updates the name **immediately**, but the engine only applies the preset after
**200 ms with no further step**. Applying is one operation, so a burst of steps loads at most the
last preset's models. While a model is loading the name button shows a small spinner and the
previous sound keeps playing until the new model is ready.

### 5.2 Rebuilding the panels

The sliders are uncontrolled (they seed from an initial value and then write straight to their
`AudioParam`). To show a newly applied preset they need new positions. The recommended route is to
**re-key the chain** with a counter bumped on apply, so panels remount from the working state. This
is simple and robust, but a remount would re-run each panel's "restore" step and reload models the
engine already holds — hence the loaded-identity check in step 3, which turns those into no-ops.
The alternative, giving each control an imperative `setValue`, avoids the remount but touches every
control; it is noted here so the plan can weigh it.

### 5.3 A missing model

A preset can name a model that is not on this device: an `upload:` file that was removed, an
export imported from another machine, a bundled URL that 404s.

- Everything else in the preset **is** applied.
- That stage is left **bypassed** for the session, so the wrong sound is never played, and its
  picker reads "Missing: Slo 100".
- A warning toast says so, and the preset's row in the list carries a warning icon.
- The stored preset is **not** altered. Uploading a file with that name later makes it work; picking
  another model and saving fixes the preset.

---

## 6. Keyboard and touch

| Key | Action |
|---|---|
| `[` and `]` | Previous and next preset |
| `1`–`9` | Jump to the preset at that position |
| `/` or `Ctrl/Cmd+K` | Open the list with search focused |
| `Ctrl/Cmd+S` | Save (cancels the browser's Save page) |
| `Ctrl/Cmd+Shift+S` | Save as new; opens the name field |
| In the list: `↑` `↓`, `Enter`, `Home` `End`, `Esc`, `F2`, `Delete` | Move, load, first or last, close, rename, delete with undo |

**Deliberately unused:** Space (the panic mute), plain arrows (the sliders), Alt combinations
(browser Back and Forward, and Alt-drag pans the chain), Ctrl+arrows (desktop switching on some
systems).

### 6.1 Rules

- **One resolver.** `resolveShortcut(eventLike, context): Action | null` is a pure function, so the
  whole table is unit-tested. `context` says whether focus is in a text field and whether a modal
  (the tuner) is open.
- **One listener.** A `usePresetShortcuts` hook registers a single window `keydown` handler, beside
  `usePanicKey`.
- **Ignored** while typing in a text field or the search box, while the tuner modal is open, during
  IME composition, and on **key repeat** — holding `]` does not run through the whole list.
- **Focus.** Closing the list returns focus to the name button.
- **Touch.** A swipe on the name button steps previous or next; a tap opens the list. There is no
  long-press.
- **Discoverability.** Buttons carry the key in their tooltip, and the ⋯ menu lists every shortcut.

### 6.2 Leaving unsaved changes

Stepping away from a changed preset **discards the edits** and shows "Changes discarded · Undo".
Undo restores the previous working state and re-applies it. There is no confirmation dialog —
stopping to confirm in the middle of a song is the wrong behaviour for a live tool.

---

## 7. Export and import

Export writes a file, `sarlifier-presets.json`:

```json
{ "format": "sarlifier-presets", "version": 1,
  "presets": [ { "name": "Crunch rhythm", "settings": { … } } ] }
```

Import reads a file the user picked, treats it as untrusted, and sanitises every field through the
same reader as §3.4. Names that collide are suffixed (§4). It reports "Imported 5 presets" or, for
a file that is not ours, an error that says what was wrong. Model and IR references come across as
names only, so an imported preset may hit §5.3 until the same files are uploaded.

---

## 8. Files and boundaries

| Unit | Responsibility |
|---|---|
| `src/state/savedSettings.ts` | Types, sanitising reader, storage (never throws), and the pure operations: capture, dirty comparison, unique naming, add / rename / duplicate / delete / reorder |
| `src/state/savedSettings.test.ts` | Sanitising, dirty comparison, naming, and every operation |
| `src/ui/presets/presetShortcuts.ts` | `resolveShortcut` and its table |
| `src/ui/presets/usePresetShortcuts.ts` | The single window listener, with the ignore rules |
| `src/ui/presets/applyCoalescer.ts` | The 200 ms coalescing, pure and testable with fake timers |
| `src/ui/presets/PresetBar.tsx` (+ list and menu) | The bar, the list, the menu, the toasts |
| `MainScreen.tsx`, `AudioEngine.ts` | Applying a preset: re-key the chain, and track the loaded identity per stage |

`savedSettings.ts` depends on `params.ts` and the shape of `StoredControls` only; the UI depends on
it, never the other way round.

---

## 9. Verification

Automated (Vitest):

- The sanitising reader: clamps, drops NaN, ignores unknown keys, accepts an older or hand-edited record
- Dirty comparison: equal, changed level, changed selection, key-order independence
- Naming: trimming, length limit, case-insensitive uniqueness, suffixing
- Every operation, including duplicate placement and delete-then-undo
- `resolveShortcut`: each key, with focus in a text field, with a modal open, with key repeat, with modifiers
- The coalescer: a burst of steps applies once, with the last target

Browser (headless Chrome, as for earlier work): save and reload with an unsaved edit; step with the
arrows and keys and confirm one load per burst; a preset naming a removed upload applies the rest and
leaves the stage bypassed; export then import on a clean profile; the bar at 375 px and at 1900 px; the
list opening upward without clipping.

By ear, guitar and headphones:

- Stepping between presets with the **same** amp model is seamless
- Stepping to a preset with a **different** model recovers within a moment, with no runaway
- Stage power changes during a switch do not click (or the known gap is stated)
- The app never un-mutes when a preset loads

---

## 10. Risks

| Risk | Handling |
|---|---|
| A model load on the audio thread drops audio when a preset changes the model | Coalescing (§5.1) so a burst loads once; the previous sound keeps playing until the new model is ready; measure on the real machine and consider a worker load later |
| Stage power clicks when a preset flips several switches | The crossfade gap is a stated precondition (§5 step 2) |
| Re-keying the chain reloads models the engine already has | The loaded-identity check makes them no-ops (§5.2) |
| A preset silently plays the wrong sound when a model is missing | The stage stays bypassed and says so (§5.3) |
| A shortcut fires while someone types a name | The resolver ignores text fields (§6.1) |
| `localStorage` is unavailable or full | Logged once; in-memory presets for the session (§4) |
| "Preset" already means "bundled model" in the code | The feature is `SavedSetting` in code; existing names are untouched (§1) |

---

## 11. Phasing

1. **First milestone.** Save, save as new, rename, duplicate, delete with undo, revert; the bottom
   bar with the searchable list; previous / next; the dirty indicator; the shortcuts; missing-model
   handling; coalesced apply.
2. **Then.** Export and import; touch swipe; the crossfade fix if it has not landed.
3. **Later.** Numbered quick slots, and Web MIDI program-change / CC control for a foot controller
   (Chromium only, behind a permission prompt) — the natural fit for live use.
