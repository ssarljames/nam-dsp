import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { summarise, type SavedSettingsData } from '../../state/savedSettings';

interface PresetListProps {
  data: SavedSettingsData;
  /** The preset shown as loaded (or the one being stepped to). */
  currentId: string | null;
  /** Presets that point at an upload which is no longer saved. */
  missing: ReadonlySet<string>;
  /** Start with the "save as new" field focused. */
  focusNew: boolean;
  onPick: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Returns false if the name was not acceptable (empty). */
  onSaveAs: (name: string) => boolean;
  onClose: () => void;
}

/**
 * The searchable list, opening upward from the bar. Up and Down move through
 * it, Enter loads, F2 renames, Delete deletes (with undo), Escape closes.
 */
export function PresetList({
  data,
  currentId,
  missing,
  focusNew,
  onPick,
  onRename,
  onDelete,
  onSaveAs,
  onClose,
}: PresetListProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [newName, setNewName] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const newRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.order
      .map((id) => data.byId[id])
      .filter((s) => q === '' || s.name.toLowerCase().includes(q) || summarise(s.settings).toLowerCase().includes(q));
  }, [data, query]);

  useEffect(() => {
    if (focusNew) newRef.current?.focus();
    else searchRef.current?.focus();
  }, [focusNew]);

  // Start on the loaded preset, so the arrows begin where you are.
  useEffect(() => {
    const at = rows.findIndex((s) => s.id === currentId);
    setHighlight(at >= 0 ? at : 0);
    // Only when the list is first shown or the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Enter/Escape unmount the field, which can fire a blur afterwards; settle once.
  const renameSettled = useRef(false);

  const startRename = (id: string, name: string) => {
    renameSettled.current = false;
    setRenamingId(id);
    setRenameText(name);
  };

  const finishRename = (commit: boolean) => {
    if (renameSettled.current) return;
    renameSettled.current = true;
    if (commit && renamingId !== null) onRename(renamingId, renameText);
    setRenamingId(null);
    searchRef.current?.focus();
  };

  // Keep the highlight on a real row when the rows shrink (delete, filter).
  useEffect(() => {
    setHighlight((i) => Math.max(0, Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (renamingId !== null) return; // the rename field has its own keys
    const target = event.target as HTMLElement;
    const inNewField = target === newRef.current;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    // Native activation of a focused button (Save as new, rename, delete) must work.
    if (inNewField || target.tagName === 'BUTTON') return;
    const current = rows[highlight];
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((i) => Math.min(i + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlight(Math.max(rows.length - 1, 0));
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      onPick(current.id);
    } else if (event.key === 'F2' && current) {
      event.preventDefault();
      startRename(current.id, current.name);
    } else if (event.key === 'Delete' && current && target !== searchRef.current) {
      event.preventDefault();
      onDelete(current.id);
    }
  };

  return (
    <div className="preset-list" onKeyDown={onKeyDown}>
      <input
        ref={searchRef}
        className="preset-list__search"
        type="search"
        placeholder="Search presets"
        aria-label="Search presets"
        aria-controls="preset-listbox"
        aria-activedescendant={rows[highlight] ? `preset-opt-${rows[highlight].id}` : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="preset-list__rows" id="preset-listbox" role="listbox" aria-label="Presets">
        {rows.length === 0 && (
          <li className="preset-list__empty" role="presentation">
            {data.order.length === 0 ? 'No presets yet. Save the current sound below.' : 'No preset matches that search.'}
          </li>
        )}
        {rows.map((s, i) => {
          const isCurrent = s.id === currentId;
          return (
            <li
              key={s.id}
              id={`preset-opt-${s.id}`}
              role="option"
              aria-selected={isCurrent}
              className={`preset-list__row${isCurrent ? ' preset-list__row--current' : ''}${i === highlight ? ' preset-list__row--hl' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => renamingId !== s.id && onPick(s.id)}
            >
              <span className="preset-list__mark" aria-hidden="true">
                {isCurrent ? '✓' : ''}
              </span>
              <span className="preset-list__main">
                {renamingId === s.id ? (
                  <input
                    className="preset-list__rename"
                    aria-label={`Rename ${s.name}`}
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => finishRename(true)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') finishRename(true);
                      else if (e.key === 'Escape') finishRename(false);
                    }}
                  />
                ) : (
                  <span className="preset-list__name">{s.name}</span>
                )}
                <span className="preset-list__sub">{summarise(s.settings)}</span>
              </span>
              {missing.has(s.id) && (
                <span
                  className="preset-list__warn"
                  role="img"
                  aria-label="A model or IR in this preset is no longer saved"
                  title="A model or IR in this preset is no longer saved"
                >
                  !
                </span>
              )}
              <span className="preset-list__actions">
                <button
                  type="button"
                  className="preset-list__act"
                  aria-label={`Rename ${s.name}`}
                  title="Rename (F2)"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(s.id, s.name);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="preset-list__act"
                  aria-label={`Delete ${s.name}`}
                  title="Delete (Del)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <form
        className="preset-list__new"
        onSubmit={(e) => {
          e.preventDefault();
          if (onSaveAs(newName)) setNewName('');
          else newRef.current?.focus();
        }}
      >
        <input
          ref={newRef}
          className="preset-list__newname"
          type="text"
          maxLength={80}
          placeholder="Name for a new preset"
          aria-label="Name for a new preset"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="preset-list__save">
          Save as new
        </button>
      </form>
    </div>
  );
}
