import { CORE_PARAMS, slotParamId, type CoreParamId } from './params';
import { LoadedIdentity } from './loadedIdentity';
import type { EngineCommand, EngineMessage, PostEffectId, StageId } from './engineMessages';

/**
 * latencyHint: 0 asks for the smallest buffer the platform will give. Some
 * platforms reject the numeric form, so fall back rather than fail to start.
 */
function createContext(): AudioContext {
  try {
    return new AudioContext({ latencyHint: 0, sampleRate: 48000 });
  } catch {
    return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  }
}

export class AudioEngine {
  private constructor(
    private readonly ctx: AudioContext,
    private readonly worklet: AudioWorkletNode,
    private readonly muteGain: GainNode,
    private readonly analyser: AnalyserNode,
    private readonly tunerAnalyser: AnalyserNode,
  ) {}

  static async create(): Promise<AudioEngine> {
    const ctx = createContext();

    // The worklet scope has no fetch, so the main thread loads the bytes and
    // hands them over at construction.
    const [wasmBinary] = await Promise.all([
      fetch('/nam-engine.wasm').then((r) => {
        if (!r.ok) throw new Error(`nam-engine.wasm: ${r.status}. Run npm run build:wasm.`);
        return r.arrayBuffer();
      }),
      ctx.audioWorklet.addModule('/nam-engine.worklet.js'),
    ]);

    const worklet = new AudioWorkletNode(ctx, 'nam-engine', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { wasmBinary },
    });

    // Panic mute is a plain GainNode after the worklet, not a parameter inside
    // it, so it still cuts the signal if the WASM module has faulted.
    const muteGain = new GainNode(ctx, { gain: 0 });

    // The meter taps BEFORE the worklet: it shows what the interface is
    // actually sending, independent of any processing.
    const analyser = new AnalyserNode(ctx, { fftSize: 1024, smoothingTimeConstant: 0.3 });

    // A second, parallel tap for the tuner — also before the worklet, so it
    // reads the raw instrument and works whether or not the engine is
    // engaged (you can tune with the output muted). It cannot share the
    // meter's analyser: the tuner now covers bass as well as guitar, down to
    // low B (30.87 Hz, 1555-sample period at 48 kHz), and autocorrelation
    // needs three or more periods to be stable. 8192 samples at 48 kHz is
    // 171 ms — 5.3 periods of low B, 4.7 of a five-string drop-A (27.5 Hz).
    // Widening the meter's analyser instead would change its ballistics, so
    // this is a separate dead-end node — neither tap alters the signal.
    const tunerAnalyser = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0 });

    worklet.connect(muteGain).connect(ctx.destination);

    const engine = new AudioEngine(ctx, worklet, muteGain, analyser, tunerAnalyser);

    // A private listener, separate from onEngineMessage's subscribers: the
    // engine needs this value regardless of who else is listening.
    worklet.port.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as EngineMessage;
      if (message.type === 'ready') {
        engine.maxModelBytesValue = message.maxModelBytes;
        engine.maxIrTapsValue = message.maxIrTaps;
      } else if (message.type === 'modelLoaded') {
        engine.identity.namReply(message.slot, message.ok);
      } else if (message.type === 'irLoaded') {
        engine.identity.cabReply(message.ok);
      }
    });
    worklet.port.start();

    return engine;
  }

  private readonly identity = new LoadedIdentity();
  private source: MediaStreamAudioSourceNode | null = null;

  /**
   * Connect the new source first, then tear down the old one. Stopping first
   * leaves an audible hole.
   */
  attachInput(stream: MediaStream): void {
    const previous = this.source;
    const next = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream });
    next.connect(this.analyser);
    next.connect(this.tunerAnalyser);
    next.connect(this.worklet);
    this.source = next;

    if (previous) {
      previous.disconnect();
      // The caller owns the old MediaStream and stops its tracks.
    }
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  engage(): void {
    const now = this.ctx.currentTime;
    this.muteGain.gain.cancelScheduledValues(now);
    this.muteGain.gain.setValueAtTime(this.muteGain.gain.value, now);
    this.muteGain.gain.linearRampToValueAtTime(1, now + 0.02);
    this.engaged = true;
  }

  panicMute(): void {
    const now = this.ctx.currentTime;
    this.muteGain.gain.cancelScheduledValues(now);
    this.muteGain.gain.setValueAtTime(this.muteGain.gain.value, now);
    this.muteGain.gain.linearRampToValueAtTime(0, now + 0.005);
    this.engaged = false;
  }

  private engaged = false;
  isEngaged(): boolean {
    return this.engaged;
  }

  param(id: CoreParamId): AudioParam {
    const param = this.worklet.parameters.get(id);
    if (!param) throw new Error(`unknown engine parameter: ${id}`);
    return param;
  }

  /**
   * A pooled slot parameter — how a slot occupant such as a NAM stage receives
   * its knobs. Slot `slot`'s parameter `index` is `slot{slot}_p{index}`.
   */
  slotParam(slot: number, index: number): AudioParam {
    const id = slotParamId(slot, index);
    const param = this.worklet.parameters.get(id);
    if (!param) throw new Error(`unknown engine parameter: ${id}`);
    return param;
  }

  /** Applies every declared default. Called once after construction. */
  applyDefaults(): void {
    for (const spec of Object.values(CORE_PARAMS)) {
      this.param(spec.id as CoreParamId).value = spec.default;
    }
  }

  /**
   * Hands model bytes to the engine. The ArrayBuffer is TRANSFERRED, so it is
   * detached here and the caller must not reuse it — a later reload re-fetches
   * or re-reads the file.
   */
  loadNamModel(slot: number, bytes: ArrayBuffer, identity: string): void {
    this.identity.expectNam(slot, identity);
    const command: EngineCommand = { type: 'loadModel', slot, bytes };
    this.worklet.port.postMessage(command, [bytes]);
  }

  /** Bypass is a structural event, not an AudioParam (spec §5.2). */
  setNamEnabled(slot: number, enabled: boolean): void {
    const command: EngineCommand = { type: 'setEnabled', slot, enabled };
    this.worklet.port.postMessage(command);
  }

  /** A core stage's power button. A structural event, like the NAM stages' (spec §5.2). */
  setStageEnabled(stage: StageId, enabled: boolean): void {
    const command: EngineCommand = { type: 'setStageEnabled', stage, enabled };
    this.worklet.port.postMessage(command);
  }

  /** The POST effects, first to last. A structural event, like a stage's power (spec §5.2). */
  setPostOrder(order: readonly PostEffectId[]): void {
    const command: EngineCommand = { type: 'setPostOrder', order: [...order] };
    this.worklet.port.postMessage(command);
  }

  /** Trails: whether the reverb takes new input. A structural event (spec 2026-10-01-reverb-effect §3.4). */
  setReverbInput(open: boolean): void {
    const command: EngineCommand = { type: 'setReverbInput', open };
    this.worklet.port.postMessage(command);
  }

  /**
   * Hands prepared IR taps (mono, 48 kHz — see irPrep.ts) to the cab. The
   * buffer is TRANSFERRED, so `taps` is detached here and must not be reused.
   */
  loadCabIr(taps: Float32Array, identity: string): void {
    this.identity.expectCab(identity);
    const bytes =
      taps.byteOffset === 0 && taps.byteLength === taps.buffer.byteLength
        ? (taps.buffer as ArrayBuffer)
        : (taps.slice().buffer as ArrayBuffer);
    const command: EngineCommand = { type: 'loadIr', bytes };
    this.worklet.port.postMessage(command, [bytes]);
  }

  /**
   * Engine::kMaxModelBytes, learned from the worklet's `ready` message rather
   * than restated here — the UI needs it to refuse an oversized file with a
   * message that names the limit, and a second hardcoded copy of a
   * cross-language constant is exactly what drifts. The literal is only the
   * pre-ready fallback.
   */
  maxModelBytes(): number {
    return this.maxModelBytesValue;
  }

  private maxModelBytesValue = 8 * 1024 * 1024;

  /** The id last accepted into NAM stage `slot`, or null. */
  loadedNam(slot: number): string | null {
    return this.identity.loadedNam(slot);
  }

  /** True while a model sent to NAM stage `slot` has not been answered. */
  hasNamPending(slot: number): boolean {
    return this.identity.hasNamPending(slot);
  }

  /** True while an IR sent to the cab has not been answered. */
  hasCabPending(): boolean {
    return this.identity.hasCabPending();
  }

  /** The id last accepted into the cab, or null. */
  loadedCab(): string | null {
    return this.identity.loadedCab();
  }

  /** Engine::kMaxCabTaps, learned from the worklet's `ready` message. The literal is only the pre-ready fallback. */
  maxIrTaps(): number {
    return this.maxIrTapsValue;
  }

  private maxIrTapsValue = 4096;

  analyserNode(): AnalyserNode {
    return this.analyser;
  }

  tunerAnalyserNode(): AnalyserNode {
    return this.tunerAnalyser;
  }

  context(): AudioContext {
    return this.ctx;
  }

  /**
   * Estimated, not measured. A true round trip needs a physical loopback and is
   * out of scope for Phase 1.
   */
  estimatedLatencyMs(trackLatencySec = 0): number {
    const base = (this.ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0;
    const output = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return (base + output + trackLatencySec) * 1000;
  }

  /** Returns false when the browser has no setSinkId — the caller says so in the UI. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof ctx.setSinkId !== 'function') return false;
    await ctx.setSinkId(deviceId);
    return true;
  }

  onEngineMessage(callback: (message: EngineMessage) => void): () => void {
    const handler = (event: MessageEvent) => callback(event.data as EngineMessage);
    this.worklet.port.addEventListener('message', handler);
    this.worklet.port.start();
    return () => this.worklet.port.removeEventListener('message', handler);
  }

  async close(): Promise<void> {
    this.panicMute();
    await this.ctx.close();
  }
}
