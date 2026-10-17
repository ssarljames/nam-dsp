import { useEffect, useState } from 'react';
import { log } from '../../state/logStore';
import { deleteUpload, listUploads, readUpload, saveUpload, type UploadKind } from '../../state/uploadStore';

const byName = (a: string, b: string) => a.localeCompare(b);
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One panel's view of its saved uploads: the names to list in the dropdown, and
 * the operations that keep IndexedDB and that list in step. A storage failure
 * is logged and reported through the return value, never thrown — the upload
 * itself still works for the session, it just is not remembered.
 */
export function useSavedUploads(kind: UploadKind) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listUploads(kind)
      .then((list) => {
        if (!cancelled) setNames(list);
      })
      .catch((err) => log.warn(`Your saved files are unavailable: ${reason(err)}`));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  /** Saves `bytes` under `name`. Resolves false, after logging, if it could not be saved. */
  const remember = async (name: string, bytes: ArrayBuffer): Promise<boolean> => {
    try {
      await saveUpload(kind, name, bytes);
      setNames((current) => (current.includes(name) ? current : [...current, name].sort(byName)));
      return true;
    } catch (err) {
      log.warn(`${name} is loaded but could not be saved for next time: ${reason(err)}`);
      return false;
    }
  };

  /** Deletes the saved copy. Resolves false, after logging, if it could not be deleted. */
  const forget = async (name: string): Promise<boolean> => {
    try {
      await deleteUpload(kind, name);
      setNames((current) => current.filter((n) => n !== name));
      return true;
    } catch (err) {
      log.warn(`Could not remove ${name}: ${reason(err)}`);
      return false;
    }
  };

  /** Rejects if storage fails; resolves null if the name is not saved. */
  const read = (name: string) => readUpload(kind, name);

  return { names, remember, forget, read };
}
