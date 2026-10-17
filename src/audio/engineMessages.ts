/**
 * Structural events between the main thread and the engine worklet. Continuous
 * control values do NOT travel here — they are k-rate AudioParams (spec §5.2).
 * Both sides import these types so the protocol has one definition.
 */

/** The named core stages with a power button. NAM stages are slot-addressed instead. */
export type StageId = 'gate' | 'eq' | 'cab' | 'delay' | 'chorus' | 'drive' | 'reverb' | 'tremolo';

/** The effects that share the POST position, in an order of the player's choosing. */
export type PostEffectId = 'chorus' | 'tremolo' | 'delay' | 'reverb';

/**
 * Every POST effect, in the default order: modulation before the time effects,
 * so the echoes repeat the chorused, pulsing sound, and the reverb tails the lot.
 */
export const POST_EFFECTS: readonly PostEffectId[] = Object.freeze(['chorus', 'tremolo', 'delay', 'reverb'] as PostEffectId[]);

/** Whether `value` names every POST effect exactly once: the only order the engine accepts. */
export function isPostOrder(value: unknown): value is PostEffectId[] {
  return (
    Array.isArray(value) &&
    value.length === POST_EFFECTS.length &&
    POST_EFFECTS.every((effect) => value.filter((v) => v === effect).length === 1)
  );
}

/** Main thread → worklet. */
export type EngineCommand =
  | { type: 'loadModel'; slot: number; bytes: ArrayBuffer }
  | { type: 'setEnabled'; slot: number; enabled: boolean }
  | { type: 'setStageEnabled'; stage: StageId; enabled: boolean }
  /**
   * The POST effects, first to last. A real change restarts the ones that
   * moved (spec 2026-10-01-reverb-effect §3.3, 2026-10-06-tremolo-effect §3.3).
   */
  | { type: 'setPostOrder'; order: PostEffectId[] }
  /** Trails: closed, an enabled reverb lets its tail ring out and passes the dry (spec 2026-10-01-reverb-effect §3.4). */
  | { type: 'setReverbInput'; open: boolean }
  /** Raw little-endian Float32 taps — mono, 48 kHz, already prepared by irPrep.ts. */
  | { type: 'loadIr'; bytes: ArrayBuffer };

/** Worklet → main thread. */
export type EngineMessage =
  /**
   * `maxModelBytes` is read out of the engine rather than restated on the main
   * thread: the UI has to name the limit when refusing an oversized file, and
   * two hardcoded copies of a cross-language constant is exactly the drift the
   * layout checks exist to prevent. `maxIrTaps` is read out of the engine for the
   * same reason as `maxModelBytes` — the main thread truncates to it.
   */
  | { type: 'ready'; sampleRate: number; maxBlock: number; maxModelBytes: number; maxIrTaps: number }
  | { type: 'error'; message: string }
  | { type: 'modelLoaded'; slot: number; ok: boolean; message: string }
  /** Exactly one per `loadIr`, in order — a panel matches replies to sends first-in first-out. */
  | { type: 'irLoaded'; ok: boolean; message: string };
