import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getControlsSnapshot, type StoredControls } from '../../state/persistence';
import {
  addSetting,
  captureSettings,
  deleteSetting,
  duplicateSetting,
  idAtPosition,
  isValidName,
  missingReferences,
  missingUploadIds,
  neighbour,
  newId,
  positionOf,
  renameSetting,
  restoreSetting,
  settingNames,
  settingsEqual,
  settingsToControls,
  uniqueName,
  updateSetting,
} from '../../state/savedSettings';
import { savedSettingsStore, useSavedSettings } from '../../state/savedSettingsStore';
import { listUploads } from '../../state/uploadStore';
import { useWorkingControls } from '../../state/useWorkingControls';
import { APPLY_DELAY_MS, createCoalescer } from './applyCoalescer';
import { PresetList } from './PresetList';
import { SHORTCUT_HELP, type PresetAction } from './presetShortcuts';
import { usePresetShortcuts } from './usePresetShortcuts';
import { useToast } from './useToast';

interface PresetBarProps {
  /** Makes a working state the rack's: writes it, tells the engine, remounts the chain. */
  onApply: (controls: StoredControls) => void;
}

interface UndoSnapshot {
  controls: StoredControls;
  activeId: string | null;
}

/**
 * The preset bar along the bottom of the screen: previous, the loaded preset's
 * name with its list, next, save, and a menu. Stepping updates the name at once
 * and the engine after a quiet 200 ms, so a burst loads once (spec §5.1).
 */
export function PresetBar({ onApply }: PresetBarProps) {
  const data = useSavedSettings();
  const working = useWorkingControls();
  const { toast, show, dismiss } = useToast();

  const [listOpen, setListOpen] = useState(false);
  const [focusNew, setFocusNew] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());

  const pendingRef = useRef<string | null>(null);
  const undoRef = useRef<UndoSnapshot | null>(null);
  const nameButtonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const active = data.activeId ? data.byId[data.activeId] : undefined;
  const dirty = active ? !settingsEqual(captureSettings(working), active.settings) : false;

  // What the name button shows: the preset being stepped to, else the loaded one.
  const shownId = pendingId ?? data.activeId;
  const shown = shownId ? data.byId[shownId] : undefined;
  const position = shownId ? positionOf(data, shownId) : -1;

  // ---- applying -----------------------------------------------------------

  const applyPreset = useCallback(
    (id: string) => {
      const d = savedSettingsStore.get();
      const setting = d.byId[id];
      pendingRef.current = null;
      setPendingId(null);
      if (!setting) return;

      const undo = undoRef.current;
      undoRef.current = null;

      savedSettingsStore.set({ ...d, activeId: id });
      onApply(settingsToControls(getControlsSnapshot(), setting.settings));

      const undoApply = undo
        ? () => {
            savedSettingsStore.set({ ...savedSettingsStore.get(), activeId: undo.activeId });
            onApply(settingsToControls(getControlsSnapshot(), captureSettings(undo.controls)));
          }
        : undefined;
      const message = undo ? 'Changes discarded' : `Loaded “${setting.name}”`;
      show(message, undoApply);

      // A model or IR the preset names may be gone from this device. The stage
      // stays off (spec §5.3), so say so rather than let it read as a clean load.
      Promise.all([listUploads('nam'), listUploads('ir')])
        .then(([nam, ir]) => {
          const gone = missingReferences(setting.settings, nam, ir);
          if (gone.length === 0 || savedSettingsStore.get().activeId !== id) return;
          const names = gone.map((n) => `“${n}”`).join(', ');
          show(`${message} — ${names} ${gone.length === 1 ? 'is' : 'are'} not on this device, so that stage stays off`, undoApply);
        })
        .catch(() => {});
    },
    [onApply, show],
  );

  const coalescer = useMemo(() => createCoalescer<string>(applyPreset, APPLY_DELAY_MS), [applyPreset]);
  useEffect(() => () => coalescer.cancel(), [coalescer]);

  /** Leaving a changed preset keeps a snapshot, so the toast can undo it. */
  const beginBurst = useCallback(() => {
    if (pendingRef.current !== null) return;
    const d = savedSettingsStore.get();
    const current = d.activeId ? d.byId[d.activeId] : undefined;
    const controls = getControlsSnapshot();
    const changed = current ? !settingsEqual(captureSettings(controls), current.settings) : false;
    undoRef.current = changed ? { controls, activeId: d.activeId } : null;
  }, []);

  const stepTo = useCallback(
    (target: string | null, immediate = false) => {
      if (target === null) return;
      beginBurst();
      pendingRef.current = target;
      setPendingId(target);
      if (immediate) {
        coalescer.cancel();
        applyPreset(target);
      } else {
        coalescer.push(target);
      }
    },
    [applyPreset, beginBurst, coalescer],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      const d = savedSettingsStore.get();
      stepTo(neighbour(d, pendingRef.current ?? d.activeId, delta));
    },
    [stepTo],
  );

  // ---- saving and editing -------------------------------------------------

  const closeList = useCallback(() => {
    setListOpen(false);
    setFocusNew(false);
    nameButtonRef.current?.focus();
  }, []);

  const openList = useCallback((forNew = false) => {
    setMenuOpen(false);
    setHelpOpen(false);
    setFocusNew(forNew);
    setListOpen(true);
  }, []);

  const save = useCallback(() => {
    const d = savedSettingsStore.get();
    const current = d.activeId ? d.byId[d.activeId] : undefined;
    if (!current) {
      // Nothing to overwrite: saving means naming.
      openList(true);
      return;
    }
    savedSettingsStore.set(updateSetting(d, current.id, captureSettings(getControlsSnapshot())));
    show(`Saved “${current.name}”`);
  }, [openList, show]);

  const saveAs = useCallback(
    (raw: string): boolean => {
      if (!isValidName(raw)) return false;
      const d = savedSettingsStore.get();
      const { data: next, id } = addSetting(
        d,
        uniqueName(raw, settingNames(d)),
        captureSettings(getControlsSnapshot()),
        newId(),
      );
      savedSettingsStore.set(next);
      show(`Saved as “${next.byId[id].name}”`);
      closeList();
      return true;
    },
    [closeList, show],
  );

  const rename = useCallback(
    (id: string, raw: string) => {
      const d = savedSettingsStore.get();
      if (!isValidName(raw)) return;
      const next = renameSetting(d, id, raw);
      savedSettingsStore.set(next);
      show(`Renamed to “${next.byId[id].name}”`);
    },
    [show],
  );

  const duplicate = useCallback(() => {
    const d = savedSettingsStore.get();
    if (!d.activeId) return;
    const out = duplicateSetting(d, d.activeId, newId());
    if (!out) return;
    savedSettingsStore.set(out.data);
    show(`Duplicated as “${out.data.byId[out.id].name}”`);
  }, [show]);

  const remove = useCallback(
    (id: string) => {
      const d = savedSettingsStore.get();
      const gone = d.byId[id];
      if (!gone) return;
      const index = d.order.indexOf(id);
      const wasActive = d.activeId === id;
      savedSettingsStore.set(deleteSetting(d, id));
      show(`Deleted “${gone.name}”`, () => {
        savedSettingsStore.set(restoreSetting(savedSettingsStore.get(), gone, index, wasActive));
      });
    },
    [show],
  );

  const revert = useCallback(() => {
    const d = savedSettingsStore.get();
    const current = d.activeId ? d.byId[d.activeId] : undefined;
    if (!current) return;
    onApply(settingsToControls(getControlsSnapshot(), current.settings));
    show(`Reverted to “${current.name}”`);
  }, [onApply, show]);

  // ---- shortcuts ----------------------------------------------------------

  const onAction = useCallback(
    (action: PresetAction) => {
      switch (action.type) {
        case 'previous':
          step(-1);
          break;
        case 'next':
          step(1);
          break;
        case 'jump':
          stepTo(idAtPosition(savedSettingsStore.get(), action.index));
          break;
        case 'openList':
          openList(false);
          break;
        case 'save':
          save();
          break;
        case 'saveAs':
          openList(true);
          break;
      }
    },
    [openList, save, step, stepTo],
  );
  usePresetShortcuts(onAction);

  // ---- housekeeping -------------------------------------------------------

  // Which presets point at an upload that is gone: checked when the list opens.
  useEffect(() => {
    if (!listOpen) return;
    let cancelled = false;
    Promise.all([listUploads('nam'), listUploads('ir')])
      .then(([nam, ir]) => {
        if (!cancelled) setMissing(missingUploadIds(savedSettingsStore.get(), nam, ir));
      })
      .catch(() => {
        if (!cancelled) setMissing(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [listOpen, data]);

  // A click outside the bar closes whatever is open.
  useEffect(() => {
    if (!listOpen && !menuOpen && !helpOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setListOpen(false);
        setMenuOpen(false);
        setHelpOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [listOpen, menuOpen, helpOpen]);

  // ---- render -------------------------------------------------------------

  const nameText = shown ? shown.name : 'No preset';
  const countText = shown ? `${position + 1} / ${data.order.length}` : data.order.length > 0 ? `${data.order.length} saved` : '';
  const hasPresets = data.order.length > 0;

  return (
    <div className="preset-bar" ref={rootRef} role="region" aria-label="Presets" data-tour="presets">
      <span className="preset-bar__label" aria-hidden="true">
        PRESET
      </span>

      <div className="preset-bar__controls">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous preset"
          title="Previous preset ( [ )"
          disabled={!hasPresets}
          onClick={() => step(-1)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          ref={nameButtonRef}
          className="preset-bar__name"
          aria-haspopup="listbox"
          aria-expanded={listOpen}
          title="Choose a preset ( / )"
          onClick={() => (listOpen ? closeList() : openList(false))}
        >
          <span className="preset-bar__name-text">{nameText}</span>
          {dirty && pendingId === null && (
            <span className="preset-bar__dot" role="img" aria-label="Unsaved changes" />
          )}
          {countText && <span className="preset-bar__count">{countText}</span>}
          <svg className="preset-bar__chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="Next preset"
          title="Next preset ( ] )"
          disabled={!hasPresets}
          onClick={() => step(1)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          className={`preset-bar__save${dirty ? ' preset-bar__save--on' : ''}`}
          title="Save ( Ctrl S )"
          onClick={save}
        >
          {!active ? 'Save' : dirty ? 'Save changes' : 'Saved'}
        </button>

        <div className="preset-bar__more">
          <button
            type="button"
            className="icon-btn"
            aria-label="More preset actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setListOpen(false);
              setHelpOpen(false);
              setMenuOpen((open) => !open);
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div className="preset-menu" role="menu">
              <button type="button" role="menuitem" disabled={!active || !dirty} onClick={() => { setMenuOpen(false); save(); }}>
                Save changes
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); openList(true); }}>
                Save as new…
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!active}
                onClick={() => {
                  setMenuOpen(false);
                  if (active) {
                    openList(false);
                  }
                }}
              >
                Rename (choose in the list)
              </button>
              <button type="button" role="menuitem" disabled={!active} onClick={() => { setMenuOpen(false); duplicate(); }}>
                Duplicate
              </button>
              <button type="button" role="menuitem" disabled={!active || !dirty} onClick={() => { setMenuOpen(false); revert(); }}>
                Revert changes
              </button>
              <hr />
              <button
                type="button"
                role="menuitem"
                className="preset-menu__danger"
                disabled={!active}
                onClick={() => {
                  setMenuOpen(false);
                  if (active) remove(active.id);
                }}
              >
                Delete
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setHelpOpen(true); }}>
                Keyboard shortcuts
              </button>
            </div>
          )}

          {helpOpen && (
            <div className="preset-help" role="dialog" aria-label="Keyboard shortcuts">
              <dl>
                {SHORTCUT_HELP.map(([keys, does]) => (
                  <div key={keys} className="preset-help__row">
                    <dt>{keys}</dt>
                    <dd>{does}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" className="preset-help__close" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      {listOpen && (
        <PresetList
          data={data}
          currentId={shownId}
          missing={missing}
          focusNew={focusNew}
          onPick={(id) => {
            stepTo(id, true);
            closeList();
          }}
          onRename={rename}
          onDelete={remove}
          onSaveAs={saveAs}
          onClose={closeList}
        />
      )}

      {toast && (
        <div className="preset-toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                dismiss();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {toast?.message ?? ''}
      </div>
    </div>
  );
}
