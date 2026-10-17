import { Fragment, type ComponentProps, useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../../audio/AudioEngine';
import { DeviceRepository } from '../../audio/DeviceRepository';
import { pickDefaultInput, pickDefaultOutput, reconcileSelection } from '../../audio/deviceSelection';
import { applyControlsToEngine, applyEffectsToEngine } from '../../audio/applyControls';
import { pushTap, tapToRate, tapToTime } from '../../audio/tapTempo';
import {
  CHORUS_PARAMS,
  CHORUS_PARAM_INDEX,
  CHORUS_SLOT,
  CORE_PARAMS,
  DELAY_PARAMS,
  DELAY_PARAM_INDEX,
  DELAY_SLOT,
  DRIVE_PARAMS,
  DRIVE_PARAM_INDEX,
  DRIVE_SLOT,
  NAM_SLOT_COUNT,
  TREMOLO_PARAMS,
  TREMOLO_PARAM_INDEX,
  TREMOLO_SLOT,
  type ChorusParamId,
  type CoreParamId,
  type DelayParamId,
  type DriveParamId,
  type TremoloParamId,
} from '../../audio/params';
import { engineStore, useEngineState } from '../../state/engineStore';
import {
  cancelPendingControls,
  loadControls,
  saveControls,
  updateControls,
  updateControlsDebounced,
  type StoredControls,
} from '../../state/persistence';
import { Knob, type KnobHandle } from '../Knob/Knob';
import { LevelSlider } from '../Knob/LevelSlider';
import { GateMeter } from '../panel/GateMeter';
import { LiveSwitch } from '../panel/LiveSwitch';
import { NamLoaderPanel } from '../panel/NamLoaderPanel';
import { Chain, ChainCell, ChainLink, ChainSlot, EffectsTray } from '../panel/Chain';
import { EffectPanel } from '../panel/EffectPanel';
import { ClipTypeSwitch } from '../panel/ClipTypeSwitch';
import { ReverbPanel, reverbSlotParam } from '../panel/ReverbPanel';
import { WaveSwitch } from '../panel/WaveSwitch';
import { canDrop } from '../panel/effectDrag';
import { placedInOrder } from '../panel/effectOrder';
import { useEffectDrag } from '../panel/useEffectDrag';
import { usePanelDrag } from '../panel/usePanelDrag';
import { GatePanel } from '../panel/GatePanel';
import { TunerButton, TunerModal } from '../panel/TunerModal';
import { TutorialButton, TutorialModal } from '../panel/TutorialModal';
import { GuidedTour, tourSeen } from '../tour/GuidedTour';
import { EqPanel } from '../panel/EqPanel';
import { CabSimPanel } from '../panel/CabSimPanel';
import { HeadphonesAdvisory } from '../panel/HeadphonesAdvisory';
import { PresetBar } from '../presets/PresetBar';
import { InputMeter } from '../panel/InputMeter';
import { LatencyReadout } from '../panel/LatencyReadout';
import { Panel } from '../panel/Panel';
import { log } from '../../state/logStore';
import { TerminalDock } from '../terminal/TerminalDock';
import { usePanicKey } from '../usePanicKey';
import { useEffectRack } from './useEffectRack';

export function MainScreen() {
  const state = useEngineState();
  const engineRef = useRef<AudioEngine | null>(null);
  const repoRef = useRef(new DeviceRepository());
  const streamRef = useRef<MediaStream | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [tunerAnalyser, setTunerAnalyser] = useState<AnalyserNode | null>(null);
  // True once the input is open and the output routed. The panels reload the
  // stored NAM model and cab IR only after this: loading a model runs on the
  // audio thread, and doing it while the microphone is still being opened and
  // attached crashes the renderer in Chrome ("Error code: SIGILL").
  const [startupDone, setStartupDone] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // Bumped when a preset is applied. The chain is keyed by it, so its panels
  // remount and read their positions from the new working state.
  const [chainKey, setChainKey] = useState(0);
  // The effects, through one shared hook: which are placed and the POST order
  // are state (the layout changes); their values live in a ref inside the
  // hook, so a knob release never re-renders the screen.
  const {
    placed,
    order,
    records,
    load: loadEffects,
    place,
    remove,
    setPower,
    commitChorus,
    commitDelay,
    commitDrive,
    setDriveType,
    commitReverb,
    setReverbType,
    setReverbTrails,
    commitTremolo,
    setTremoloWave,
    dropPanel,
    step,
  } = useEffectRack(engineRef);

  const openSeqRef = useRef(0);

  // Restored controls, read once at start() and kept in refs — not state —
  // so applying them, and recording later commits, never triggers a
  // re-render. `savedRef` seeds each Knob's `initialValue`; `paramsRef` is
  // the running set of param values that gets written back out on every
  // commit, merged with whatever was already persisted (not just the knobs
  // touched this session).
  const savedRef = useRef<StoredControls | null>(null);
  const paramsRef = useRef<Partial<Record<CoreParamId, number>>>({});
  // The gate threshold as the slider has it right now, read by the gate's meter
  // every frame. Kept in a ref so a drag never re-renders the screen.
  const gateThresholdRef = useRef<number>(CORE_PARAMS.gateThreshold.default);

  // `persist` defaults to false: a device id is written to storage only as
  // the direct result of a human selecting it. `start()`'s automatic pick and
  // the hotplug handler's reconciliation both open a device the user never
  // chose, so they must not overwrite `preferredId` with it — that would
  // defeat pickDefaultInput's interface-label heuristic on the next load.
  // Only the input <select>'s onChange passes `persist: true`.
  const openInput = useCallback(async (deviceId: string, persist = false) => {
    const engine = engineRef.current;
    if (!engine) return;

    // Two of these can be in flight at once — a manual <select> change racing a
    // hotplug reconciliation, or impatient switching. Without a token, both
    // would capture the same `previous` and one opened stream would never be
    // stopped: a live microphone track, privacy indicator lit, until reload.
    const seq = ++openSeqRef.current;
    let opened;
    try {
      opened = await repoRef.current.openInput(deviceId);
    } catch (err) {
      // Superseded by a newer call while this one was failing — the newer
      // attempt owns the message now, so don't clobber it with a stale error.
      if (seq !== openSeqRef.current) return;
      // The caller decides what this means for `phase` (unusable during the
      // initial open, still 'ready' during a device switch); here we only
      // record what happened. Not writing `inputId` is what "reverts" a
      // controlled <select> back to the device that is actually open.
      log.exception(err);
      throw err;
    }

    if (seq !== openSeqRef.current) {
      // Superseded while we were awaiting. Stop what we just opened and leave
      // the winner alone.
      for (const track of opened.stream.getTracks()) track.stop();
      return;
    }

    // Read AFTER the await, so it is whatever is actually attached right now.
    const previous = streamRef.current;
    engine.attachInput(opened.stream);
    streamRef.current = opened.stream;
    if (previous) for (const track of previous.getTracks()) track.stop();

    engineStore.setState({
      inputId: deviceId,
      latencyMs: engine.estimatedLatencyMs(opened.trackLatencySec),
    });

    // A setting the browser actively violated is a warning — the audio is not
    // what was asked for. One it simply never reported is only informational:
    // it may well have been applied. That distinction used to live in
    // StatusLine and is worth keeping now that the log carries it.
    for (const issue of opened.issues) {
      if (issue.severity === 'violated') {
        log.warn(`${issue.setting}=${issue.actual} — the browser did not honour the input constraints`);
      } else {
        log.info(`${issue.setting} not reported by the browser`);
      }
    }
    // Success path only — a rejected open leaves `inputId` (and storage)
    // pointing at whatever is actually open, per the revert-on-failure
    // behaviour above. And only when the user chose this device — see the
    // `persist` comment above.
    if (persist) {
      updateControls({ inputId: engineStore.getSnapshot().inputId });
    }
  }, []);

  const start = useCallback(async () => {
    engineStore.setState({ phase: 'requesting' });
    log.info('Requesting microphone permission…');

    try {
      const granted = await repoRef.current.requestPermission();
      if (!granted) {
        engineStore.setState({ phase: 'error' });
        log.error('Microphone permission denied.');
        return;
      }

      const saved = loadControls();
      savedRef.current = saved;
      paramsRef.current = { ...saved.params };
      gateThresholdRef.current = saved.params.gateThreshold ?? CORE_PARAMS.gateThreshold.default;
      loadEffects(saved);

      // AudioEngine.create() rejects when /nam-engine.wasm 404s (e.g. `npm run
      // build:wasm` was never run) or the worklet module fails to load — both
      // leave the app with no engine at all, so this whole block funnels into
      // 'error' below rather than leaving the "Requesting…" message stuck on
      // screen forever.
      const engine = await AudioEngine.create();
      engine.applyDefaults();
      // Defaults first, saved values over the top — only for whichever ids
      // were actually present and valid in storage.
      for (const id of Object.keys(CORE_PARAMS) as CoreParamId[]) {
        const value = saved.params[id];
        if (value !== undefined) engine.param(id).value = value;
      }
      engine.onEngineMessage((msg) => {
        if (msg.type === 'error') {
          engineStore.setState({ phase: 'error' });
          log.error(msg.message);
        } else if (msg.type === 'modelLoaded') {
          if (msg.ok) log.info(`Model loaded into slot ${msg.slot}.`);
          else log.error(msg.message);
        } else if (msg.type === 'irLoaded') {
          if (msg.ok) log.info('Cab IR loaded.');
          else log.error(msg.message);
        }
      });
      await engine.resume();
      engineRef.current = engine;
      setAnalyser(engine.analyserNode());
      setTunerAnalyser(engine.tunerAnalyserNode());

      // The engine constructs its NAM stages disabled; this is what makes the
      // restored panel state and the engine agree before any audio flows.
      for (const [slot, state] of Object.entries(saved.nam)) {
        const slotIndex = Number(slot);
        // Persistence deliberately accepts stored NAM slot keys up to the whole
        // slot pool, so records survive NAM_SLOT_COUNT growing. But only slots
        // below NAM_SLOT_COUNT are NAM stages. The engine's own setNamEnabled
        // (Engine.cpp) rejects an out-of-range slot, but slotParam has no such
        // check — every pool slot's params exist — so a stale or hand-edited
        // record would write a NAM dB value into a pool slot Phase 3 hands to a
        // different effect.
        if (slotIndex >= NAM_SLOT_COUNT) continue;
        engine.slotParam(slotIndex, 0).value = state.level ?? 0;
        engine.setNamEnabled(slotIndex, !state.bypassed);
      }
      // The engine constructs the EQ enabled; push the stored state before audio flows.
      engine.setStageEnabled('eq', !saved.eqBypassed);
      // The engine constructs the gate disabled; push the stored state too.
      engine.setStageEnabled('gate', !saved.gateBypassed);
      // The engine constructs the cab disabled; push the stored state too.
      engine.setStageEnabled('cab', !saved.cabBypassed);
      // The engine constructs the drive and the POST effects disabled, in the
      // default order; push their stored values, power and order too.
      applyEffectsToEngine(engine, saved);

      const snapshot = await repoRef.current.enumerate();
      const inputId = pickDefaultInput([...snapshot.inputs, ...snapshot.outputs], saved.inputId);
      const outputId = pickDefaultOutput([...snapshot.inputs, ...snapshot.outputs], inputId, saved.outputId);

      engineStore.setState({
        phase: 'ready',
        devices: { inputs: snapshot.inputs, outputs: snapshot.outputs },
        outputId,
        outputSelectable: DeviceRepository.outputSelectionSupported(),
        outputNotice: DeviceRepository.outputSelectionSupported()
          ? ''
          : 'Output routing needs Chromium — using the system default.',
      });
      if (!DeviceRepository.outputSelectionSupported()) {
        log.warn('Output routing needs Chromium — using the system default.');
      }

      // The initial input open is not optional the way a later device switch
      // is: fail here (NotReadableError from an interface held by another
      // app, OverconstrainedError from a device that vanished between
      // enumerate() and here) and there is no working engine yet, so
      // openInput's rethrow is meant to land in the catch below as 'error'.
      if (inputId) await openInput(inputId);

      if (outputId && DeviceRepository.outputSelectionSupported()) {
        // Unlike the input path, a working engine already exists by this
        // point — a setSinkId rejection here is the same class of failure as
        // switching output from the <select>, so it stays 'ready' rather than
        // taking down the whole panel.
        try {
          await engine.setOutputDevice(outputId);
          // Not persisted — this is the automatic pick from pickDefaultOutput,
          // not the user choosing from the <select>. See the `persist`
          // comment on openInput; the same rule applies to the output device.
        } catch (err) {
          log.exception(err);
        }
      }
      setStartupDone(true);
    } catch (err) {
      engineStore.setState({ phase: 'error' });
      log.exception(err);
    }
  }, [openInput, loadEffects]);

  // Hotplug: re-enumerate and say out loud when a selected device vanished.
  useEffect(() => {
    return repoRef.current.onDeviceChange(async () => {
      // This callback is passed straight to addEventListener, so nothing it
      // throws is otherwise observable — an OverconstrainedError from
      // openInput's hotplug race, or a setOutputDevice rejection, would
      // vanish as a silent unhandled rejection with the panel looking fine.
      try {
        const snapshot = await repoRef.current.enumerate();
        const all = [...snapshot.inputs, ...snapshot.outputs];
        const current = engineStore.getSnapshot();

        const input = reconcileSelection('audioinput', current.inputId, all);
        const output = reconcileSelection('audiooutput', current.outputId, all, input.deviceId);

        engineStore.setState({
          devices: { inputs: snapshot.inputs, outputs: snapshot.outputs },
        });
        if (input.fellBack || output.fellBack) {
          log.warn('A selected device disappeared — fell back to the system default.');
        }

        if (input.deviceId && input.deviceId !== current.inputId) await openInput(input.deviceId);
        if (output.deviceId && output.deviceId !== current.outputId) {
          await engineRef.current?.setOutputDevice(output.deviceId);
          engineStore.setState({ outputId: output.deviceId });
          // Not persisted — this is hotplug fallback/reconnection, not the
          // user choosing from the <select>. `preferredId` still names
          // whatever was last chosen, so the real device wins it back later.
        }
      } catch (err) {
        log.exception(err);
      }
    });
  }, [openInput]);

  // Applying a preset (or undoing one): the working state becomes `controls`,
  // the engine is told, and the chain remounts so every control shows it. The
  // engine's models are not touched here — the remounted panels load whichever
  // ones differ from what the engine already holds.
  const applyControls = useCallback((controls: StoredControls) => {
    const engine = engineRef.current;
    if (!engine) return;
    // A knob commit still waiting in the debounce window would overwrite the
    // new state with the old values a quarter of a second from now.
    cancelPendingControls();
    saveControls(controls);
    savedRef.current = controls;
    paramsRef.current = { ...controls.params };
    gateThresholdRef.current = controls.params.gateThreshold ?? CORE_PARAMS.gateThreshold.default;
    loadEffects(controls);
    applyControlsToEngine(engine, controls);
    setChainKey((key) => key + 1);
  }, [loadEffects]);

  // Tap tempo: a click on the TIME knob is a tap. The last few taps set the time
  // and the knob is moved through its handle, so nothing remounts or re-renders.
  const timeKnobRef = useRef<KnobHandle | null>(null);
  const tapsRef = useRef<number[]>([]);
  const tapDelayTime = useCallback(
    (timeStamp: number) => {
      tapsRef.current = pushTap(tapsRef.current, timeStamp);
      const ms = tapToTime(tapsRef.current, DELAY_PARAMS.time.min, DELAY_PARAMS.time.max);
      if (ms === null) return;
      timeKnobRef.current?.set(ms);
      commitDelay('time', ms);
    },
    [commitDelay],
  );

  // The same on the tremolo's RATE: one cycle per tap, with its own count, so
  // tapping one knob never disturbs the other's (spec 2026-10-06-tremolo-effect §4.4).
  const rateKnobRef = useRef<KnobHandle | null>(null);
  const rateTapsRef = useRef<number[]>([]);
  const tapTremoloRate = useCallback(
    (timeStamp: number) => {
      rateTapsRef.current = pushTap(rateTapsRef.current, timeStamp);
      const hz = tapToRate(rateTapsRef.current, TREMOLO_PARAMS.rate.min, TREMOLO_PARAMS.rate.max);
      if (hz === null) return;
      rateKnobRef.current?.set(hz);
      commitTremolo('rate', hz);
    },
    [commitTremolo],
  );

  // A chip dropped in its slot goes into the gap it was released at; Enter on it
  // places that effect after the others.
  const { dragging, chipProps } = useEffectDrag({ onDrop: place });
  // A placed effect's title, dragged onto the other one or moved with the arrows.
  const { handleProps } = usePanelDrag({ onDrop: dropPanel, onStep: step });

  usePanicKey(
    useCallback(() => {
      engineRef.current?.panicMute();
      engineStore.setState({ engaged: false });
    }, []),
  );

  // The first time the rig is ever ready in this browser, walk through it. The
  // controls only exist once audio is running, so this waits for 'ready', then
  // a moment more for the chain to lay out and the stored model to restore.
  useEffect(() => {
    if (state.phase !== 'ready' || tourSeen()) return;
    const timer = window.setTimeout(() => setTourOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  // One knob for one core parameter, wired to its AudioParam and to
  // persistence. Kept off React state so a commit never re-renders the screen.
  const commitCore = (id: CoreParamId, value: number) => {
    paramsRef.current = { ...paramsRef.current, [id]: value };
    updateControlsDebounced({ params: paramsRef.current });
  };

  // The same parameter as the knob would be, as a fader: wired to its
  // AudioParam and to persistence in exactly the same way.
  const coreSlider = (id: CoreParamId, extra?: Pick<ComponentProps<typeof LevelSlider>, 'onLive' | 'beside' | 'compact' | 'orientation'>) => (
    <LevelSlider
      key={id}
      spec={CORE_PARAMS[id]}
      param={engineRef.current ? engineRef.current.param(id) : null}
      initialValue={savedRef.current?.params[id]}
      onCommit={(value) => commitCore(id, value)}
      {...extra}
    />
  );

  // The effects' knobs, wired to their slot AudioParams and to the stored
  // records. Written on release, so turning one never re-renders the screen.
  // 56 px, so three fit an effect's cell without widening it.
  const delayKnob = (key: DelayParamId) => (
    <Knob
      key={key}
      spec={DELAY_PARAMS[key]}
      param={engineRef.current ? engineRef.current.slotParam(DELAY_SLOT, DELAY_PARAM_INDEX[key]) : null}
      initialValue={records.current.delay[key]}
      onCommit={(value) => commitDelay(key, value)}
      size={56}
      {...(key === 'time' ? { onTap: tapDelayTime, handleRef: timeKnobRef } : {})}
    />
  );

  const chorusKnob = (key: ChorusParamId) => (
    <Knob
      key={key}
      spec={CHORUS_PARAMS[key]}
      param={engineRef.current ? engineRef.current.slotParam(CHORUS_SLOT, CHORUS_PARAM_INDEX[key]) : null}
      initialValue={records.current.chorus[key]}
      onCommit={(value) => commitChorus(key, value)}
      size={56}
    />
  );

  const tremoloKnob = (key: TremoloParamId) => (
    <Knob
      key={key}
      spec={TREMOLO_PARAMS[key]}
      param={engineRef.current ? engineRef.current.slotParam(TREMOLO_SLOT, TREMOLO_PARAM_INDEX[key]) : null}
      initialValue={records.current.tremolo[key]}
      onCommit={(value) => commitTremolo(key, value)}
      size={56}
      {...(key === 'rate' ? { onTap: tapTremoloRate, handleRef: rateKnobRef } : {})}
    />
  );

  const driveKnob = (key: DriveParamId) => (
    <Knob
      key={key}
      spec={DRIVE_PARAMS[key]}
      param={engineRef.current ? engineRef.current.slotParam(DRIVE_SLOT, DRIVE_PARAM_INDEX[key]) : null}
      initialValue={records.current.drive[key]}
      onCommit={(value) => commitDrive(key, value)}
      size={56}
    />
  );

  return (
    <main
      style={{
        // Once running, the session bar is the top of the page and touches it.
        padding: state.phase === 'ready' ? 0 : '16px 0',
        display: 'grid',
        // A single track exactly as wide as the window. Left to size itself it
        // would follow the chain's full width, and the top bar with it.
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 16,
        width: '100%',
        justifyItems: 'center',
        // The start screen sits in the middle of the window; the running rack
        // starts at the top, under the session bar.
        alignContent: state.phase === 'ready' ? 'start' : 'center',
        minHeight: state.phase === 'ready' ? undefined : '100vh',
        boxSizing: 'border-box',
      }}
    >
      {/* The full title and tagline are for the start screen. Once the app is
          running, the name moves into the session bar and this goes away. */}
      {state.phase !== 'ready' && (
        <header className="brand">
          <h1 className="brand__name">Sarlifier</h1>
          <p className="brand__tagline">
            A browser-based amp &amp; tone stack built by someone who still
            double-checks his pointer math.
          </p>
        </header>
      )}

      {state.phase === 'idle' && <button onClick={start}>Start audio</button>}

      {state.phase === 'ready' && (
        <div className="rig">
          {/* The session bar: the live switch, the two device pickers with the
              latency they give, and the tuner. Small and always in reach; the
              signal chain below it is where the rack lives. */}
          <nav className="topnav" aria-label="Session">
            <h1 className="topnav__brand">Sarlifier</h1>

            <div className="topnav__center">
            <LiveSwitch
                live={state.engaged}
                onToggle={() => {
                  const engine = engineRef.current;
                  if (!engine) return;
                  if (engine.isEngaged()) engine.panicMute();
                  else engine.engage();
                  engineStore.setState({ engaged: engine.isEngaged() });
                }}
              />

            <div className="topnav__devices">
              <label className="device" data-tour="input-device">
                    <span className="device__legend">INPUT</span>
                    <select
                      className="device__select"
                      value={state.inputId ?? ''}
                      onChange={(e) => {
                        // openInput already recorded the message and left `inputId`
                        // untouched on failure — this just keeps the rejection from
                        // being unhandled. Not writing the new id is what reverts the
                        // controlled <select> back to the device that is actually open.
                        // `persist: true` — this is the human picking a device, the
                        // one case openInput is allowed to write it to storage.
                        void openInput(e.target.value, true).catch(() => undefined);
                      }}
                    >
                      {state.devices.inputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || d.deviceId}
                        </option>
                      ))}
                    </select>
                  </label>
              <label className="device" title={state.outputNotice || undefined} data-tour="output-device">
                    <span className="device__legend">OUTPUT</span>
                    <select
                      className="device__select"
                      value={state.outputId ?? ''}
                      disabled={!state.outputSelectable}
                      onChange={async (e) => {
                        const deviceId = e.target.value;
                        try {
                          await engineRef.current?.setOutputDevice(deviceId);
                          // Written only on success: the store keeps the old id on
                          // failure, so the controlled <select> reverts to it too
                          // instead of showing a device that isn't actually routed.
                          engineStore.setState({ outputId: deviceId });
                          // Persisted only here too — never on the rejection path below.
                          updateControls({ outputId: deviceId });
                        } catch (err) {
                          log.exception(err);
                        }
                      }}
                    >
                      {state.devices.outputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || d.deviceId}
                        </option>
                      ))}
                    </select>
                  </label>
              <LatencyReadout />
            </div>
            </div>

            <div className="topnav__right">
            {/* The level arriving from the interface, before any processing. */}
            <div className="topnav__meter" data-tour="level">
              <span className="topnav__legend">LEVEL</span>
              <InputMeter analyser={analyser} width={84} height={10} />
            </div>

            <TunerButton onOpen={() => setTunerOpen(true)} />
            <TutorialButton onOpen={() => setTutorialOpen(true)} />
            </div>
          </nav>

          <TunerModal open={tunerOpen} onClose={() => setTunerOpen(false)} analyser={tunerAnalyser} />
          <TutorialModal
            open={tutorialOpen}
            onClose={() => setTutorialOpen(false)}
            onStartTour={() => {
              setTutorialOpen(false);
              setTourOpen(true);
            }}
          />
          <GuidedTour open={tourOpen} onClose={() => setTourOpen(false)} />

          <HeadphonesAdvisory />

          <EffectsTray inUse={placed} dragging={dragging} chipProps={chipProps} />

          {/* The signal chain, left to right in engine order: gate, input gain,
              PRE (the drive), amp and cab, POST (chorus, tremolo, delay and
              reverb in their order), then the EQ and the output. */}
          <Chain key={chainKey}>
            <ChainCell size="snug" tour="chain-gate">
              <GatePanel
                meter={null}
                threshold={coreSlider('gateThreshold', {
                  onLive: (value) => {
                    gateThresholdRef.current = value;
                  },
                  beside: <GateMeter analyser={analyser} thresholdRef={gateThresholdRef} />,
                })}
                engine={engineRef.current}
                initialBypassed={savedRef.current?.gateBypassed ?? true}
              />
            </ChainCell>
            <ChainLink />
            <ChainCell size="narrow" tour="chain-input">
              {/* After the gate, as in the engine: the gain that sets how hard the drive
                  and the amp model are hit. */}
              <Panel title="INPUT" className="panel--narrow">
                <div className="chain-end">{coreSlider('inputGain')}</div>
              </Panel>
            </ChainCell>
            <ChainLink />
            {/* PRE: a thin slot until the drive is placed, then a box around its panel. */}
            <ChainSlot label="PRE" side="pre" armed={dragging !== null && canDrop(dragging, 'pre')}>
              {placed.has('drive') && (
                <ChainCell size="effect" effect="drive" tour="chain-drive">
                  <EffectPanel
                    title="DRIVE"
                    name="Drive"
                    knobs={
                      <>
                        {driveKnob('gain')}
                        {driveKnob('tone')}
                        {driveKnob('level')}
                      </>
                    }
                    extra={<ClipTypeSwitch initial={records.current.drive.type} onChange={setDriveType} />}
                    initialBypassed={records.current.drive.bypassed}
                    onPowerChange={(on) => setPower('drive', on)}
                    onRemove={() => remove('drive')}
                  />
                </ChainCell>
              )}
            </ChainSlot>
            <ChainLink />
            {/* The amp model and the cab share one panel: they are always
                adjacent, and one panel is much narrower than two. Each keeps
                its own power switch, picker and level. */}
            <ChainCell size="amp">
              <Panel title="AMP AND CAB">
                <div className="amp-stack">
                  <NamLoaderPanel
                    slot={0}
                    engine={engineRef.current}
                    initial={savedRef.current?.nam[0]}
                    restoreReady={startupDone}
                  />
                  <CabSimPanel
                    level={coreSlider('cabLevel', { orientation: 'horizontal' })}
                    engine={engineRef.current}
                    initialBypassed={savedRef.current?.cabBypassed ?? true}
                    initialIr={savedRef.current?.cabIr ?? null}
                    restoreReady={startupDone}
                  />
                </div>
              </Panel>
            </ChainCell>
            <ChainLink />
            {/* POST: a thin slot until an effect is placed, then a box around
                the placed effects in the order they run. Keyed by effect, so a
                reorder moves the panels rather than remounting them. */}
            <ChainSlot label="POST" side="post" armed={dragging !== null && canDrop(dragging, 'post')}>
              {placedInOrder(order, placed).map((effect, i) => (
                <Fragment key={effect}>
                  {i > 0 && <ChainLink />}
                  <ChainCell size="effect" effect={effect}>
                    {effect === 'reverb' ? (
                      <ReverbPanel
                        slotParam={reverbSlotParam(engineRef.current)}
                        initial={records.current.reverb}
                        onCommit={commitReverb}
                        onTypeChange={setReverbType}
                        onTrailsChange={setReverbTrails}
                        onPowerChange={(on) => setPower('reverb', on)}
                        onRemove={() => remove('reverb')}
                        handle={handleProps('reverb', 'Reverb')}
                      />
                    ) : effect === 'tremolo' ? (
                      <EffectPanel
                        title="TREMOLO"
                        name="Tremolo"
                        knobs={
                          <>
                            {tremoloKnob('level')}
                            {tremoloKnob('rate')}
                            {tremoloKnob('depth')}
                          </>
                        }
                        extra={<WaveSwitch initial={records.current.tremolo.wave} onChange={setTremoloWave} />}
                        initialBypassed={records.current.tremolo.bypassed}
                        onPowerChange={(on) => setPower('tremolo', on)}
                        onRemove={() => remove('tremolo')}
                        handle={handleProps('tremolo', 'Tremolo')}
                      />
                    ) : effect === 'chorus' ? (
                      <EffectPanel
                        title="CHORUS"
                        name="Chorus"
                        knobs={
                          <>
                            {chorusKnob('level')}
                            {chorusKnob('rate')}
                            {chorusKnob('depth')}
                          </>
                        }
                        initialBypassed={records.current.chorus.bypassed}
                        onPowerChange={(on) => setPower('chorus', on)}
                        onRemove={() => remove('chorus')}
                        handle={handleProps('chorus', 'Chorus')}
                      />
                    ) : (
                      <EffectPanel
                        title="DELAY"
                        name="Delay"
                        knobs={
                          <>
                            {delayKnob('level')}
                            {delayKnob('time')}
                            {delayKnob('feedback')}
                          </>
                        }
                        initialBypassed={records.current.delay.bypassed}
                        onPowerChange={(on) => setPower('delay', on)}
                        onRemove={() => remove('delay')}
                        handle={handleProps('delay', 'Delay')}
                      />
                    )}
                  </ChainCell>
                </Fragment>
              ))}
            </ChainSlot>
            <ChainLink />
            <ChainCell size="wide" tour="chain-eq">
              <EqPanel
                bands={
                  <>
                    {coreSlider('bass', { compact: true })}
                    {coreSlider('mid', { compact: true })}
                    {coreSlider('treble', { compact: true })}
                  </>
                }
                level={coreSlider('eqLevel', { compact: true })}
                engine={engineRef.current}
                initialBypassed={savedRef.current?.eqBypassed ?? false}
              />
            </ChainCell>
            <ChainLink />
            <ChainCell size="narrow" tour="chain-output">
              {/* The output end. The master volume belongs to no stage, so no
                  stage's switch can take it out of the signal path. */}
              <Panel title="OUTPUT" className="panel--narrow">
                <div className="chain-end">{coreSlider('outputVolume')}</div>
              </Panel>
            </ChainCell>
          </Chain>

          <PresetBar onApply={applyControls} />
        </div>
      )}

      {/*
        Nothing prints messages onto the panel any more. Errors, warnings and
        notices all go to the log, which TerminalDock renders — including the
        ones that used to be the only sign of life during `requesting` and
        `error`, when no panel exists yet. The dock opens itself the first time
        an error arrives so those cannot pass unseen.
      */}

      <TerminalDock />
    </main>
  );
}
