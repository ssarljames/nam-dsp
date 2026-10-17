# Rack rewire — EQ last, engaged levels, EQ bypass

**Date:** 2026-09-22
**Status:** Approved.
**Refines:** [2026-09-18-nam-pwa-design.md](2026-09-18-nam-pwa-design.md) §11 and
[2026-09-20-nam-phase2-loader-design.md](2026-09-20-nam-phase2-loader-design.md) §2.

---

## 1. Scope

The rack was reorganised in signal order (commit `abea713`) but the engine still runs the
old chain, and every LEVEL knob is unwired. This milestone makes the audio match the
panels for every stage that exists:

- the EQ moves after the amp model
- the NAM stage and the EQ each gain an engaged LEVEL
- the EQ's power button bypasses it

Out of scope: the noise gate and the cab/IR stage. Neither has DSP behind it; their panels
stay visibly unwired. The gate is the next milestone on its own; IR convolution follows a
feasibility spike, since it carries the same real-time question NAM did.

---

## 2. Chain order — a deliberate change to the approved spec

§11 of the design spec placed the NAM stage after the EQ: `InputGain → Eq → Nam →
OutputVolume`. The user directed the EQ to the end, and it is the better order: an amp
model's gain and saturation flatten most of what a pre-EQ does, so a tone stack ahead of it
barely changes the tone. After the model, it shapes the finished sound.

```
InputGain → Nam[0 .. kNamCount-1] → Eq → OutputVolume
```

The gate will slot in before the NAM stages and the IR after them; neither exists yet.

> **Superseded (2026-09-22):** the gate runs before `InputGain` too, not just before
> the NAM stages — see [fixed-noise-gate §2](2026-09-22-fixed-noise-gate-design.md).

---

## 3. Engaged level — each stage owns its own

**An engaged level is gain applied at a stage's output only while the stage is on**, so
the engaged sound can be matched against bypass. Measured need: models land anywhere from
~7 dB below the clean signal to ~4 dB above it.

Each stage applies its level as the last step of its own `process()`. Because
`ProcessorChain` skips a disabled processor entirely, "only while engaged" needs no
further code: bypassed, the stage — level included — is simply not run.

Rejected: a separate `GainProcessor` after each stage. Every power button would then have
to switch two processors in lockstep, which is two sources of truth for one switch.

Levels follow the existing gain stage exactly: target in dB, converted to linear, a
per-sample one-pole smoother (the project's anti-zipper rule), snapped to unity at
`prepare()` so a stage never fades in from silence on first engage. A NAM stage with no
model loaded passes the signal through and still applies its level — the knob means one
thing whenever the stage is on.

**Range:** −24 dB to +24 dB, unity default, centre detent. This is the existing
`levelSpec()` in `params.ts`.

---

## 4. Where each level lives in the parameter block

**NAM level: its stage's first pooled parameter.** NAM stage `i` already occupies pool
slot `i` (spec 2026-09-20 §2) and receives that slot's six-float slice through
`setParams()`, which it currently ignores. Its level is `params[0]` of that slice —
`slot{i}_p0`. No layout change: this is exactly what the pool was reserved for.

**EQ level: a new core parameter.** The EQ is a core processor, not a slot occupant, so its
level joins its core slice directly after TREBLE. The block grows from 53 to 54:

| index | parameter |
|---|---|
| 0 | inputGain |
| 1–3 | bass, mid, treble |
| **4** | **eqLevel** (new) |
| 5 | outputVolume (was 4) |
| 6–53 | slot pool, 8 × 6 (was 5–52) |

> **Superseded (2026-09-22):** a seventh core param, `gateThreshold`, follows
> `outputVolume`; the block is 55 floats, `gateThreshold` is at index 6 and the slot pool
> now starts at 7 — see [fixed-noise-gate §4](2026-09-22-fixed-noise-gate-design.md).

This moves `outputVolume` and the slot base, which is a change to the cross-language
contract between `engine/Engine.h` and `src/audio/params.ts`. The static asserts in
`Engine.h` and the worklet's instantiation-time layout checks exist for exactly this; a
new `eqLevel` check joins them. Stored control values are keyed by id, not index, so saved
settings survive the renumbering.

---

## 5. EQ bypass

A structural event, like NAM's: `{ type: 'setEqEnabled', enabled }` over the worklet port,
flipping `Processor::enabled` on the EQ. The EQ starts enabled, as it does today, and its
state persists.

> **Superseded (2026-09-22):** `setEqEnabled` was replaced end to end by the generic
> `setStageEnabled` — see [fixed-noise-gate §5](2026-09-22-fixed-noise-gate-design.md).

Only the EQ gets its own command for now. A generic "enable stage X" message is the obvious
next shape, but with two switchable kinds of stage it would be speculative; it is worth
doing when the gate arrives as the third.

---

## 6. Persistence

- `StoredNamSlot` gains `level` (dB). Validated like everything else read from storage:
  a non-finite value is dropped to unity, an out-of-range one clamped.
- `StoredControls` gains `eqBypassed` (boolean, default `false`).
- `eqLevel` is a core parameter, so it persists through the existing `params` record with
  no new code; `sanitiseControls` already walks every core parameter.

On start, each stored NAM level is written to its slot parameter and the EQ's stored bypass
is pushed to the engine, before any audio flows.

---

## 7. Verification

Host C++:

- the parameter layout is 54 floats with `eqLevel` at 4, `outputVolume` at 5 and the pool at 6

  > **Superseded (2026-09-22):** the layout is 55 floats, `gateThreshold` at 6 and the
  > pool at 7 — see [fixed-noise-gate §4](2026-09-22-fixed-noise-gate-design.md).
- the chain order is `InputGain → Nam → Eq → OutputVolume`, and each stage is bound to its
  parameter offset — asserted directly against the chain, not inferred from audio
- the EQ's level scales its output (+6 dB ≈ ×2) and a bypassed EQ changes nothing
- a loaded NAM model's output scales with its level, and an empty engaged NAM stage applies
  its level to the pass-through

Vitest: the 54-parameter layout; `nam[i].level` and `eqBypassed` sanitisation.

In the browser, against real models: with a model engaged, moving TREBLE audibly reshapes
the distorted tone (it could not before); LEVEL brings a model's engaged loudness to match
bypass; the EQ switch removes the tone stack; all three survive a reload.

---

## 8. Known gap, not addressed here

Engaging or bypassing a stage switches the signal instantly, which can click. A short
crossfade on enable/disable is the fix; it is a separate change to `ProcessorChain` and is
noted for the milestone after this one.
