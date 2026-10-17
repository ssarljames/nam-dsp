# Phase 2 (first milestone) — NAM loader plumbing

**Date:** 2026-09-20
**Status:** Approved.
**Refines:** [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §11. That spec
remains the source of truth; this document narrows its Phase 2 bullet list into one
implementable milestone and records the decisions that list left open.

---

## 1. Scope

Phase 2 as specified in §11 is several distinct pieces of work: a pinned
`NeuralAmpModelerCore` submodule with real WaveNet/LSTM inference, OPFS model storage
with an IndexedDB metadata index, a dropped-quantum counter and CPU-load meter, and
sample-rate mismatch detection. Building all of it in one pass would mean a large,
untestable step.

**This milestone builds the transport and the seam, not the inference.** When it is
done, a `.nam` file selected or uploaded in the existing UI travels as real bytes into
the WASM engine, lands in a real `Processor` occupying a real position in the chain, and
the UI reflects what actually happened. The DSP inside that processor is a pass-through
until the inference work lands behind the same seam.

In scope:

- `NamProcessor` in the C++ engine, in the chain, toggleable
- Model bytes from the main thread to the worklet to the WASM heap
- The existing NAM loader panel driving that, instead of local component state
- Bypass and model selection persisted across reload
- An architecture that admits several NAM instances without restructuring

Out of scope, deferred to later milestones: real inference and the
`NeuralAmpModelerCore` submodule, OPFS/IndexedDB model storage, the dropped-quantum and
CPU-load meters, sample-rate mismatch detection, multi-instance UI, chain reordering.
The cab/IR panel stays UI-only — convolution is a different processor and is not part of
"Phase 2 for the NAM loader".

---

## 2. A NAM instance is a slot occupant

The decision that shapes everything else.

`Engine` holds `NamProcessor nam_[kNamCount]` with `kNamCount = 1`, added to the chain in
a loop. Each instance `i` binds `paramOffset = kSlotBaseIndex + i * kParamsPerSlot`
(`kParamsPerSlot = 6`, mirroring `PARAMS_PER_SLOT` in `params.ts`), drawing its k-rate
parameters from the pre-declared pool that §5.2 reserved for exactly this purpose.

```
InputGain → Eq → Nam[0 .. kNamCount-1] → OutputVolume
```

> **Superseded (2026-09-22):** the EQ now runs after the NAM stages —
> see [rack-rewire §2](2026-09-22-rack-rewire-design.md).

The position matches §11. What this adds is that *several* NAM stages are a change to one
constant rather than a change to the parameter layout — a distortion model, an amp model
and a cab model in series are `nam_[0]`, `nam_[1]`, `nam_[2]`, already in chain order.

The alternative considered was giving NAM its own named core parameter index beside
`outputVolume`. It is simpler today and was rejected: the core layout is fixed at
class-definition time on both sides of the contract, so hard-coding "exactly one NAM"
into it makes the multi-instance case a layout migration rather than a constant.

Consequence: the Phase 3 FX pool begins at slot `kNamCount`, not slot 0. A static assert
keeps `kNamCount * kParamsPerSlot` inside the pool.

---

## 3. Model bytes into WASM

Three mechanisms, satisfying §5.3 rule 3 (build off to the side, swap one pointer) and
rule 1 (nothing allocated, freed, locked or thrown on the `process()` path).

**Staging buffer.** One fixed `Engine::kMaxModelBytes` region (8 MiB) inside the engine.
Its pointer is derived once at worklet construction alongside the existing input, output
and parameter pointers, because the module is built with `ALLOW_MEMORY_GROWTH=0` and a
re-derived view would be the one bug this whole convention exists to prevent. 8 MiB fits
inside the module's 32 MiB `INITIAL_MEMORY` with room for the rest.

The cap is exported so the main thread can reject an oversized file with a message that
names the limit, *before* posting it. A size check that happens on the audio thread can
only truncate or fail silently; one that happens in the UI can explain itself.

**Double buffer and pointer swap.** `NamProcessor` owns two model slots and an `active_`
pointer. A load builds into the inactive slot and then swaps the pointer. The previously
active slot is left untouched and is reused by the *next* load, never released mid-swap.
No `reset()` is needed on swap: the newly activated slot was built clean.

**Placeholder DSP.** `NamProcessor::process()` is an identity pass-through. Deliberately
not silence: the chain passes audio today, and a placeholder that muted it would present
as a regression rather than as unfinished work. Real inference replaces the contents of a
model slot; it does not change the staging, swapping or messaging above.

---

## 4. Message protocol

`postMessage` carries structural events only, per §5.2. Every message is slot-indexed
from the start, so the multi-instance case needs no protocol change.

Main thread → worklet:

| Message | Effect |
|---|---|
| `{ type: 'loadModel', slot, bytes }` | `bytes` (an `ArrayBuffer`, transferred) copied into the staging buffer, then `loadNamModel(slot, byteLength)` |
| `{ type: 'setEnabled', slot, enabled }` | `setNamEnabled(slot, enabled)` — flips `Processor::enabled` |

Worklet → main thread:

| Message | Meaning |
|---|---|
| `{ type: 'modelLoaded', slot, ok, message }` | Outcome of a load. `ok: false` carries the reason |

Bypass is a structural event, not an `AudioParam`. §5.2 lists enable/disable among the
events `postMessage` exists for, and `Processor::enabled` is the flag §5.3 rule 2
reserves for it.

Rejected loads — zero length, over `kMaxModelBytes`, slot out of range — leave the
active model untouched and report `ok: false`. A failed load never silently mutes.

Transferring an `ArrayBuffer` detaches it on the sender, so nothing retains the bytes
after posting; a later reload re-fetches or re-reads the file.

---

## 5. Persistence

`MainScreen` currently persists by writing a whole `StoredControls` assembled from its own
refs. A second writer — the NAM panel — would clobber whichever fields it did not know
about. That has to be fixed before adding the second writer, not after.

`persistence.ts` gains `updateControls(partial)`: read the stored record, merge the
partial over it, write it back. Knob commits and NAM panel changes both go through it.
The existing debounce still coalesces rapid commits.

`StoredControls` gains one additive field:

```ts
nam: Record<number, { url: string | null; bypassed: boolean }>
```

keyed by slot, so several instances persist without a shape change. `sanitiseControls`
validates it like everything else: non-object dropped, unknown or out-of-range slots
dropped, non-boolean `bypassed` defaulted, and `custom:` URLs dropped on read because the
bytes they named are gone. The field is absent-means-default, so no `STORAGE_KEY` version
bump is required and existing stored records stay readable.

With nothing stored, a slot starts `bypassed: true` with no model — the state the panel
already presents today, and the one that cannot surprise anyone with sound.

On start, after the engine exists: apply each slot's `bypassed`, and re-fetch a stored
preset URL to reload its bytes. A restore fetch that fails is reported to the log and
leaves the slot modelless; it never blocks startup, because a model that has moved or
gone offline must not cost the user their working tone stack. Custom uploads do not
return — their bytes were never stored, and the panel says so rather than showing a
selection that is not loaded. Persisting multi-megabyte model bytes needs OPFS (§11),
which is a later milestone; `localStorage` holds the metadata that points at them.

---

## 6. Files

New:

- `engine/NamProcessor.h`, `engine/NamProcessor.cpp`
- `engine/tests/test_nam_processor.cpp`
- `src/audio/engineMessages.ts` — the command and message unions, imported by both
  the worklet and `AudioEngine` so the protocol has one definition

Changed:

- `engine/Engine.h`, `engine/Engine.cpp` — the instance array, chain wiring, the staging
  buffer, `kMaxModelBytes`, `kNamCount`, and the static asserts holding the pool bound
- `engine/bindings.cpp` — `getModelStagingPtr`, `getMaxModelBytes`, `getNamCount`,
  `loadNamModel`, `setNamEnabled`
- `engine/build-wasm.sh` — `NamProcessor.cpp` in the source list, `HEAPU8` in
  `EXPORTED_RUNTIME_METHODS`, the new surface in the generated `.d.ts`
- `engine/CMakeLists.txt` — the new test, and `NamProcessor.cpp` in the engine test's
  sources
- `src/audio/nam-engine.worklet.ts` — `port.onmessage`, the staging pointer, and a
  `getNamCount()` layout check beside the existing three
- `src/audio/AudioEngine.ts` — `loadNamModel`, `setNamEnabled`, widened `EngineMessage`
- `src/audio/params.ts` — `NAM_SLOT_COUNT`, mirroring `kNamCount`
- `src/state/persistence.ts` — `updateControls`, the `nam` field, its validation
- `src/ui/panel/NamLoaderPanel.tsx` — a `slot` prop; drives the engine and persistence
  instead of local-only state
- `src/ui/screens/MainScreen.tsx` — passes the slot, restores stored NAM state on start,
  routes its own writes through `updateControls`

---

## 7. Verification

Automated coverage targets what fails silently, per the repository's testing policy.

Host C++ (CMake):

- pass-through leaves the buffer bit-identical
- `enabled = false` skips the stage entirely
- a load swaps the active model pointer
- zero-length, oversized and out-of-range loads are rejected and leave the active model
  and the audio path untouched
- the chain runs `InputGain → Eq → Nam → OutputVolume` in that order, with each stage
  receiving its own parameter slice

  > **Superseded (2026-09-22):** the EQ now runs after the NAM stages —
  > see [rack-rewire §2](2026-09-22-rack-rewire-design.md).

Vitest:

- `sanitiseControls` on the `nam` field: malformed shapes, unknown slots, non-boolean
  `bypassed`, `custom:` URLs dropped
- `updateControls` merges without clobbering sibling fields

By ear, with a guitar and headphones — the automated tests cannot cover these:

- engaging with no model loaded sounds exactly as it did before this milestone
- loading a model produces no click, dropout or level jump at the swap
- the bypass switch takes effect immediately and audibly rejoins at unity
- a failed load leaves audio running unchanged and says so in the terminal dock
- settings survive a reload: bypass state and selected preset return, custom uploads
  report that they must be re-uploaded

---

## 8. Risks

| Risk | Handling |
|---|---|
| Real models exceed the 8 MiB staging cap | The cap is one constant, exported to the UI, enforced with a message that names it. Raising it is a build-flag change checked against `INITIAL_MEMORY`. |
| The pass-through placeholder is mistaken for working inference | The panel reports loaded model metadata but never claims processing; the follow-up milestone that adds inference owns that claim. |
| A load on the audio thread overruns a quantum | The load copies bytes and swaps a pointer. The expensive part — building a model from those bytes — arrives with inference and must be measured then, against the xrun counter §11 schedules for the same phase. |
| Slot numbering drift between C++ and TS | `getNamCount()` joins the three layout checks the worklet already performs at instantiation. |
