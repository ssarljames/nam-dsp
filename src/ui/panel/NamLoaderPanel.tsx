import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { NamModelEntry } from '../../audio/namModels';
import { levelSpec } from '../../audio/params';
import { log } from '../../state/logStore';
import { updateControls, type StoredNamSlot } from '../../state/persistence';
import { referenceName } from '../../state/savedSettings';
import { isUploadId, uploadId, uploadName } from '../../state/uploadStore';
import { LevelSlider } from '../Knob/LevelSlider';
import { BypassSwitch } from './BypassSwitch';
import { TrashIcon, UploadIcon } from './icons';
import { InfoTip } from './InfoTip';
import { NamFileInfo } from './fileInfo';
import { useSavedUploads } from './useSavedUploads';

interface NamLoaderPanelProps {
  /** Chain slot this panel drives. Several panels differ only by this number. */
  slot: number;
  engine: AudioEngine | null;
  /** Restored state for this slot, read once at start. */
  initial?: StoredNamSlot;
  /**
   * False until the screen has finished starting audio. The stored model is
   * loaded only once this is true — see MainScreen's `startupDone`.
   */
  restoreReady: boolean;
}

/** A model sent to the engine and not yet acknowledged. */
interface PendingLoad {
  entry: NamModelEntry;
  /**
   * Set for a fresh upload: a copy of its bytes, to save once the engine has
   * accepted the model. The copy is taken before sending because the send
   * transfers — and so detaches — the original buffer.
   */
  save: ArrayBuffer | null;
}

/**
 * Drives one NAM stage: which model is loaded into it, and whether it is
 * bypassed. Everything here is slot-addressed, so chaining a drive model, an
 * amp and a cab later is a matter of rendering three of these.
 *
 * Uploaded models are saved (uploadStore.ts) once the engine accepts them, so
 * they stay in the dropdown and the last one is restored after a refresh.
 */
export function NamLoaderPanel({ slot, engine, initial, restoreReady }: NamLoaderPanelProps) {
  const [bypassed, setBypassed] = useState(initial?.bypassed ?? true);
  const [selectedUrl, setSelectedUrl] = useState(initial?.url ?? '');
  // What the readout says when the selection is not in the dropdown: an upload
  // that could not be saved, or one that was just removed. The engine still has
  // the model either way, so the readout keeps naming it.
  const [loadedName, setLoadedName] = useState<string | null>(null);
  // A stored selection whose file is not on this device. The stage is left
  // bypassed for the session and the picker says what is missing; the stored
  // preset is not altered (spec §5.3).
  const [missingName, setMissingName] = useState<string | null>(null);
  // Mirrors missingName for code running after an await.
  const missingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saved = useSavedUploads('nam');

  // Mirrors of `bypassed`/`selectedUrl` that stay current across an `await`,
  // for `persist` to read. A `setState` result is only visible on the next
  // render; a handler like `clearSelection` can run after an await, from a
  // closure captured on an earlier render — reading React state there risks
  // writing back a value one or more toggles out of date. A ref mutates
  // synchronously with its paired `setState` call below, so it is never stale.
  const bypassedRef = useRef(bypassed);
  const selectedUrlRef = useRef(selectedUrl);
  // Unlike the two refs above, levelRef mirrors no React state — the level is
  // deliberately kept out of state so a knob drag never triggers a re-render;
  // the knob writes the live value straight to the engine. levelRef is
  // `persist()`'s copy of the last committed value, updated only when a
  // commit happens, so it has the same "current across an await" property
  // without a state variable behind it. Do not "tidy" this into useState —
  // that reintroduces a re-render on every drag tick.
  const levelRef = useRef(initial?.level ?? 0);
  const setBypassedTracked = (value: boolean) => {
    bypassedRef.current = value;
    setBypassed(value);
  };
  const setSelectedUrlTracked = (value: string) => {
    selectedUrlRef.current = value;
    setSelectedUrl(value);
  };

  // The worklet talks over one MessagePort, so message order matches send
  // order: the Nth `modelLoaded` answers the Nth send. Shifting the oldest
  // pending load off the front pairs each reply with its own load, and an empty
  // queue after a rejection means it answered the latest send — a rejection for
  // an already-superseded load is left alone, since that load's own (later)
  // reply will speak for what is on screen by then.
  const pendingRef = useRef<PendingLoad[]>([]);

  const options: NamModelEntry[] = saved.names.map((name) => ({ name, url: uploadId(name) }));
  const active = options.find((entry) => entry.url === selectedUrl);

  // A saved upload is selected, and so can be removed.
  const selectedUploadName =
    isUploadId(selectedUrl) && saved.names.includes(uploadName(selectedUrl)) ? uploadName(selectedUrl) : null;

  // Reads the refs, not render-scope state — see the ref comments above. A
  // caller running after an await (every caller here) must not write back
  // whatever `bypassed`/`selectedUrl` happened to be when its render closed
  // over them.
  const persist = (next: Partial<StoredNamSlot>) => {
    const current: StoredNamSlot = {
      url: selectedUrlRef.current || null,
      bypassed: bypassedRef.current,
      level: levelRef.current,
    };
    updateControls({ nam: { [slot]: { ...current, ...next } } });
  };

  /** Throws rather than returning false, so one catch handles one failed load. */
  const sendBytes = (bytes: ArrayBuffer, label: string, pending: PendingLoad) => {
    if (!engine) throw new Error('the engine is not ready yet');
    const limit = engine.maxModelBytes();
    if (bytes.byteLength > limit) {
      throw new Error(`${label} is ${bytes.byteLength} bytes; the limit is ${limit}.`);
    }
    pendingRef.current.push(pending);
    engine.loadNamModel(slot, bytes, pending.entry.url);
  };

  /** Nothing reached the engine, so the panel must not claim a loaded model. */
  const clearSelection = () => {
    setSelectedUrlTracked('');
    setLoadedName(null);
    persist({ url: null });
  };

  // Loads a saved upload, read back from IndexedDB. Any other URL can only be a
  // stale stored selection, and fails like a missing upload. Resolves true if
  // the model was sent to the engine, false if it never got that far.
  const selectEntry = async (url: string, restoring = false): Promise<boolean> => {
    if (!url) {
      setSelectedUrlTracked('');
      persist({ url: null });
      return false;
    }
    // Checked before any state changes: with no engine, nothing will ever
    // reach it, so the panel must not show or persist this as selected even
    // transiently.
    if (!engine) {
      log.error('Cannot load a NAM model: the engine is not ready yet.');
      clearSelection();
      return false;
    }

    clearMissing();
    setLoadedName(null);
    setSelectedUrlTracked(url);
    persist({ url });

    setBusy(true);
    try {
      if (!isUploadId(url)) throw new Error(`${url} is not a saved file — select a .nam file from your device.`);
      const label = uploadName(url);
      const bytes = await saved.read(label);
      if (bytes === null) throw new Error(`${label} is no longer saved — select the file from your device again.`);
      sendBytes(bytes, label, { entry: { name: label, url }, save: null });
      return true;
    } catch (err) {
      log.exception(err);
      // A failed restore must not rewrite what the preset stored (spec §5.3);
      // the caller marks the stage missing instead.
      if (!restoring) clearSelection();
      return false;
    } finally {
      setBusy(false);
    }
  };

  // A fresh upload is not selected until the engine accepts it: a failed load
  // leaves the previous model live, so the previous selection is still true.
  const loadCustomFile = async (file: File) => {
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const entry: NamModelEntry = { name: file.name, url: uploadId(file.name) };
      sendBytes(bytes, file.name, { entry, save: bytes.slice(0) });
    } catch (err) {
      log.exception(err);
    } finally {
      setBusy(false);
    }
  };

  /** The engine accepted a fresh upload: select it, then save it. */
  const keepUpload = async ({ entry, save }: PendingLoad) => {
    clearMissing();
    setLoadedName(entry.name);
    setSelectedUrlTracked(entry.url);
    persist({ url: entry.url });
    if (save !== null) await saved.remember(entry.name, save);
  };

  // The stage cannot get the model its stored selection names. Leave it
  // bypassed rather than playing the wrong sound, and say so.
  // Clears a missing note. The missing-model bypass was display/engine only, so
  // put both back to the user's real choice.
  const clearMissing = () => {
    if (!missingRef.current) return;
    missingRef.current = false;
    setMissingName(null);
    setBypassed(bypassedRef.current);
    engine?.setNamEnabled(slot, !bypassedRef.current);
  };

  // Session-only: bypassedRef and selectedUrlRef keep the stored values, so a
  // later persist() cannot write the missing-model bypass or drop the reference.
  const markMissing = (ref: string) => {
    const name = referenceName(ref);
    missingRef.current = true;
    setMissingName(name);
    setBypassed(true);
    setSelectedUrl('');
    engine?.setNamEnabled(slot, false);
    log.warn(`“${name}” is not on this device, so the NAM stays bypassed.`);
  };

  const removeSelected = async () => {
    if (selectedUploadName === null) return;
    const name = selectedUploadName;
    if (!(await saved.forget(name))) return;
    // The engine has no unload, so the model would keep playing. The file is now
    // simply missing, exactly as if a preset named it: the stage goes off for the
    // session, and the stored selection is left alone so a preset that names the
    // file does not turn into an unsaved change.
    markMissing(selectedUrlRef.current);
  };

  // Restore. A stored selection names bytes the engine does not have yet, so
  // selecting it in the markup without loading it would show exactly the
  // "selection that is not loaded" the spec rules out. The ref guard keeps this
  // to one attempt; a failure logs and clears rather than blocking startup.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !engine || !restoreReady || !initial?.url) return;
    restoredRef.current = true;
    // The engine already holds this model (the chain was re-keyed by applying a
    // preset): there is nothing to load, and the selection is already showing.
    if (!engine.hasNamPending(slot) && engine.loadedNam(slot) === initial.url) return;
    const stored = initial.url;
    void selectEntry(stored, true).then((sent) => {
      if (!sent) markMissing(stored);
    });
    // selectEntry is intentionally not a dependency: this must run once, on
    // the first render where an engine exists, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, restoreReady, initial?.url]);

  // This slot's own ear on the engine's replies. Sending bytes is only "we
  // asked" — the worklet answers asynchronously, and only it knows whether
  // the model actually took. Without this, a rejection past the client-side
  // checks (malformed model content) would leave the readout showing a model
  // the engine never has.
  useEffect(() => {
    if (!engine) return;
    return engine.onEngineMessage((msg) => {
      if (msg.type !== 'modelLoaded' || msg.slot !== slot) return;
      const pending = pendingRef.current.shift();
      // A reply nobody here is waiting for (an unmounted instance's load).
      if (!pending) return;
      if (msg.ok) {
        if (pending.save) void keepUpload(pending);
        return;
      }
      // A rejected fresh upload never changed the selection, so there is
      // nothing to clear.
      if (pending.save == null && pendingRef.current.length === 0) clearSelection();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, slot]);

  const toggleBypass = () => {
    if (missingRef.current) return; // nothing to un-bypass onto
    const next = !bypassedRef.current;
    setBypassedTracked(next);
    persist({ bypassed: next });
    // enabled is the inverse of bypassed.
    engine?.setNamEnabled(slot, !next);
  };

  // Always names what is loaded: a selection that is not in the list (a saved
  // upload that was just removed, or one that could not be saved) still plays,
  // so the picker keeps showing it.
  const shownName =
    active?.name ?? loadedName ?? (selectedUrl && isUploadId(selectedUrl) ? uploadName(selectedUrl) : null);

  return (
    <section className="amp-section" aria-label="Neural amp modeller" data-tour="nam">
      <div className="amp-section__head">
        <span className="amp-section__heading">
          <h3 className={`amp-section__title${bypassed ? '' : ' amp-section__title--lit'}`}>NAM</h3>
          <InfoTip label="About NAM models">
            <NamFileInfo />
          </InfoTip>
        </span>
        <span className="panel__actions">
          {/* A dummy: a second NAM stage needs engine and storage work that
              has not been done, so this only marks where the control goes. */}
          <button
            type="button"
            className="add-btn"
            aria-disabled="true"
            aria-label="Add a second NAM to the left (not available yet)"
            title="Add a second NAM to the left — coming soon"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <BypassSwitch bypassed={bypassed} onToggle={toggleBypass} label="Neural amp modeller" />
        </span>
      </div>

      <div className="amp-section__row">
        <select
          className="amp-section__select"
          aria-label="Model"
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
                : 'No model loaded'}
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
          aria-label="Select a .nam file from your device"
          title="Select a .nam file from your device"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Remove the selected saved model"
          title="Remove the selected saved model"
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
          accept=".nam"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void loadCustomFile(file);
          }}
        />
      </div>

      {/* Engaged level: matches this stage against bypass. It is parameter 0
          of this stage's pool slot (spec 2026-09-22 §4). */}
      <LevelSlider
        orientation="horizontal"
        spec={levelSpec(`nam${slot}Level`)}
        param={engine ? engine.slotParam(slot, 0) : null}
        initialValue={initial?.level}
        onCommit={(value) => {
          levelRef.current = value;
          persist({ level: value });
        }}
      />
    </section>
  );
}
