import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { CabIrEntry } from '../../audio/cabIrs';
import { IR_SAMPLE_RATE, decodeIrBytes, prepareIr } from '../../audio/irPrep';
import { log } from '../../state/logStore';
import { updateControls } from '../../state/persistence';
import { referenceName } from '../../state/savedSettings';
import { isUploadId, uploadId, uploadName } from '../../state/uploadStore';
import { BypassSwitch } from './BypassSwitch';
import { TrashIcon, UploadIcon } from './icons';
import { InfoTip } from './InfoTip';
import { IrFileInfo } from './fileInfo';
import { useSavedUploads } from './useSavedUploads';

interface CabSimPanelProps {
  /** The cab's engaged LEVEL, wired to its core AudioParam by the screen. */
  level: ReactNode;
  engine: AudioEngine | null;
  /** Restored bypass state, read once at start. */
  initialBypassed: boolean;
  /** Restored selection (a preset URL or an `upload:` id), read once at start. */
  initialIr: string | null;
  /**
   * False until the screen has finished starting audio. The stored IR is loaded
   * only once this is true — see MainScreen's `startupDone`.
   */
  restoreReady: boolean;
}

/** An IR sent to the engine and not yet acknowledged. */
interface PendingLoad {
  entry: CabIrEntry;
  /**
   * Set for a fresh upload: a copy of its bytes, to save once the engine has
   * accepted the IR. Taken before sending, which may detach the original.
   */
  save: ArrayBuffer | null;
}

/**
 * The cab simulator — after the amp model and before the EQ. It convolves the
 * signal with one impulse response, chosen from the saved uploads. An uploaded
 * file is saved (uploadStore.ts) once the engine accepts it, so it stays in the
 * dropdown and the last selection is restored after a refresh.
 *
 * The readout and dropdown show what the engine has ACKNOWLEDGED, not what was
 * asked for: a rejected or failed load leaves the previous IR playing, so it
 * must leave it showing too.
 */
export function CabSimPanel({ level, engine, initialBypassed, initialIr, restoreReady }: CabSimPanelProps) {
  const [on, setOn] = useState(!initialBypassed);
  const [selectedUrl, setSelectedUrl] = useState('');
  // What the readout says when the selection is not in the dropdown: an upload
  // that could not be saved, or one that was just removed. The engine still has
  // the IR either way, so the readout keeps naming it.
  const [loadedName, setLoadedName] = useState<string | null>(null);
  // See NamLoaderPanel: a stored IR that is not on this device.
  const [missingName, setMissingName] = useState<string | null>(null);
  const missingRef = useRef(false);
  // The user's real on/off choice, which a missing IR overrides for display only.
  const userOnRef = useRef(!initialBypassed);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saved = useSavedUploads('ir');

  // The worklet talks over one MessagePort, so replies arrive in send order:
  // the Nth `irLoaded` answers the Nth send. Shifting the oldest pending load
  // off the front pairs each reply with its own load.
  const pendingRef = useRef<PendingLoad[]>([]);

  useEffect(() => {
    if (!engine) return;
    return engine.onEngineMessage((msg) => {
      if (msg.type !== 'irLoaded') return;
      const pending = pendingRef.current.shift();
      if (!pending) return; // a reply for an unmounted instance's load
      // The failure itself is logged by the screen's engine-message handler.
      if (!msg.ok) return;
      void keepLoaded(pending);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const options: CabIrEntry[] = saved.names.map((name) => ({ name, url: uploadId(name) }));
  const active = options.find((entry) => entry.url === selectedUrl);

  // A saved upload is selected, and so can be removed.
  const selectedUploadName =
    isUploadId(selectedUrl) && saved.names.includes(uploadName(selectedUrl)) ? uploadName(selectedUrl) : null;

  const sendIr = async (entry: CabIrEntry, save: ArrayBuffer | null, bytes: ArrayBuffer) => {
    if (!engine) throw new Error('Cannot load a cab IR: the engine is not ready yet.');
    const maxTaps = engine.maxIrTaps();
    const { taps, truncated } = prepareIr(await decodeIrBytes(bytes), maxTaps);
    if (truncated) {
      const ms = Math.round((maxTaps / IR_SAMPLE_RATE) * 1000);
      log.warn(`${entry.name} is longer than ${ms} ms — the tail was cut.`);
    }
    pendingRef.current.push({ entry, save });
    engine.loadCabIr(taps, entry.url);
  };

  /** The engine accepted an IR: show it, remember it as the selection, and save a fresh upload. */
  const keepLoaded = async ({ entry, save }: PendingLoad) => {
    clearMissing();
    setLoadedName(entry.name);
    setSelectedUrl(entry.url);
    updateControls({ cabIr: entry.url });
    if (save !== null) await saved.remember(entry.name, save);
  };

  /** Resolves true if the IR was sent to the engine, false if it never got that far. */
  const selectEntry = async (url: string): Promise<boolean> => {
    if (!url || url === selectedUrl) return false;
    clearMissing();
    setBusy(true);
    try {
      if (!isUploadId(url)) return false;
      const name = uploadName(url);
      const bytes = await saved.read(name);
      if (bytes === null) throw new Error(`${name} is no longer saved — select the file from your device again.`);
      await sendIr({ name, url }, null, bytes);
      return true;
    } catch (err) {
      log.exception(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loadCustomFile = async (file: File) => {
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const entry: CabIrEntry = { name: file.name, url: uploadId(file.name) };
      await sendIr(entry, bytes.slice(0), bytes);
    } catch (err) {
      log.exception(err);
    } finally {
      setBusy(false);
    }
  };

  const clearMissing = () => {
    if (!missingRef.current) return;
    missingRef.current = false;
    setMissingName(null);
    setOn(userOnRef.current);
    engine?.setStageEnabled('cab', userOnRef.current);
  };

  const markMissing = (ref: string) => {
    const name = referenceName(ref);
    missingRef.current = true;
    setMissingName(name);
    setOn(false);
    engine?.setStageEnabled('cab', false);
    log.warn(`“${name}” is not on this device, so the cab stays bypassed.`);
  };

  const removeSelected = async () => {
    if (selectedUploadName === null) return;
    const name = selectedUploadName;
    if (!(await saved.forget(name))) return;
    // The engine has no unload, so the IR would keep playing. The file is now
    // simply missing, exactly as if a preset named it: the stage goes off for the
    // session, and the stored selection is left alone so a preset that names the
    // file does not turn into an unsaved change.
    const ref = selectedUrl;
    setSelectedUrl('');
    markMissing(ref);
  };

  // Restore. A stored selection names bytes the engine does not have yet, so it
  // is loaded rather than merely shown. One attempt: a failure is logged and the
  // stored selection dropped, so it is not retried on every start.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !engine || !restoreReady || !initialIr) return;
    restoredRef.current = true;
    // Already held by the engine (the chain was re-keyed): show it, load nothing.
    if (!engine.hasCabPending() && engine.loadedCab() === initialIr) {
      setSelectedUrl(initialIr);
      return;
    }
    const stored = initialIr;
    void selectEntry(stored).then((sent) => {
      // The stored reference is left alone (spec §5.3).
      if (!sent) markMissing(stored);
    });
    // selectEntry is intentionally not a dependency: this must run once, on the
    // first render where an engine exists, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, restoreReady, initialIr]);

  const toggle = () => {
    if (missingRef.current) return; // nothing to engage
    const next = !on;
    userOnRef.current = next;
    setOn(next);
    engine?.setStageEnabled('cab', next);
    updateControls({ cabBypassed: !next });
  };

  // Always names what is loaded — see NamLoaderPanel.
  const shownName =
    active?.name ?? loadedName ?? (selectedUrl && isUploadId(selectedUrl) ? uploadName(selectedUrl) : null);

  return (
    <section className="amp-section" aria-label="Cab simulator" data-tour="cab">
      <div className="amp-section__head">
        <span className="amp-section__heading">
          <h3 className={`amp-section__title${on ? ' amp-section__title--lit' : ''}`}>CAB</h3>
          <InfoTip label="About cabinet impulse responses">
            <IrFileInfo />
          </InfoTip>
        </span>
        <span className="panel__actions">
          <BypassSwitch bypassed={!on} onToggle={toggle} label="Cab simulator" />
        </span>
      </div>

      <div className="amp-section__row">
        <select
          className="amp-section__select"
          aria-label="Impulse response"
          title={shownName ?? undefined}
          value={selectedUrl}
          disabled={busy}
          onChange={(e) => {
            void selectEntry(e.target.value);
          }}
        >
          <option value="" disabled>
            {missingName
              ? `Missing: ${missingName}`
              : selectedUrl === '' && shownName
                ? shownName
                : 'No IR loaded'}
          </option>
          {!active && selectedUrl !== '' && (
            <option value={selectedUrl} disabled>
              {shownName ?? selectedUrl}
            </option>
          )}
          {saved.names.length > 0 && (
            <optgroup label="Your files">
              {saved.names.map((name) => (
                <option key={name} value={uploadId(name)}>
                  {name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          className="icon-btn"
          aria-label="Select a .wav impulse response from your device"
          title="Select a .wav impulse response from your device"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Remove the selected saved impulse response"
          title="Remove the selected saved impulse response"
          disabled={busy || selectedUploadName === null}
          onClick={() => {
            void removeSelected();
          }}
        >
          <TrashIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void loadCustomFile(file);
          }}
        />
      </div>

      {/* Engaged level, matched against bypass. */}
      {level}
    </section>
  );
}
