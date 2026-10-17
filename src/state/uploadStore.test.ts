import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUpload, isUploadId, listUploads, readUpload, saveUpload, uploadId, uploadName } from './uploadStore';

const bytesOf = (...values: number[]) => Uint8Array.from(values).buffer;
const arrayOf = (buffer: ArrayBuffer | null) => (buffer === null ? null : Array.from(new Uint8Array(buffer)));

beforeEach(() => {
  // A fresh database per test, so no test depends on another's leftovers.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadStore', () => {
  it('lists nothing when nothing has been saved', async () => {
    expect(await listUploads('nam')).toEqual([]);
  });

  it('lists saved names in alphabetical order', async () => {
    await saveUpload('nam', 'b.nam', bytesOf(1));
    await saveUpload('nam', 'a.nam', bytesOf(2));
    await saveUpload('nam', 'c.nam', bytesOf(3));
    expect(await listUploads('nam')).toEqual(['a.nam', 'b.nam', 'c.nam']);
  });

  it('reads back exactly the bytes that were saved', async () => {
    await saveUpload('ir', 'cab.wav', bytesOf(9, 8, 7, 0, 255));
    expect(arrayOf(await readUpload('ir', 'cab.wav'))).toEqual([9, 8, 7, 0, 255]);
  });

  it('reads null for something that was never saved', async () => {
    expect(await readUpload('nam', 'missing.nam')).toBeNull();
  });

  it('replaces the stored bytes when the same name is saved again', async () => {
    await saveUpload('nam', 'amp.nam', bytesOf(1, 1, 1));
    await saveUpload('nam', 'amp.nam', bytesOf(2, 2));
    expect(await listUploads('nam')).toEqual(['amp.nam']);
    expect(arrayOf(await readUpload('nam', 'amp.nam'))).toEqual([2, 2]);
  });

  it('keeps models and IRs apart even under the same name', async () => {
    await saveUpload('nam', 'same', bytesOf(1));
    await saveUpload('ir', 'same', bytesOf(2));
    expect(await listUploads('nam')).toEqual(['same']);
    expect(await listUploads('ir')).toEqual(['same']);
    expect(arrayOf(await readUpload('nam', 'same'))).toEqual([1]);
    expect(arrayOf(await readUpload('ir', 'same'))).toEqual([2]);
  });

  it('stores a copy, so later writes to the original buffer do not change it', async () => {
    const original = bytesOf(5, 5, 5);
    await saveUpload('nam', 'x.nam', original);
    new Uint8Array(original).fill(0);
    expect(arrayOf(await readUpload('nam', 'x.nam'))).toEqual([5, 5, 5]);
  });

  it('deletes one upload and leaves the others', async () => {
    await saveUpload('nam', 'a.nam', bytesOf(1));
    await saveUpload('nam', 'b.nam', bytesOf(2));
    await deleteUpload('nam', 'a.nam');
    expect(await listUploads('nam')).toEqual(['b.nam']);
    expect(await readUpload('nam', 'a.nam')).toBeNull();
  });

  it('treats deleting something that is not there as a no-op', async () => {
    await expect(deleteUpload('nam', 'nothing.nam')).resolves.toBeUndefined();
  });

  it('survives being reopened, which is what a page refresh does', async () => {
    await saveUpload('ir', 'kept.wav', bytesOf(4, 2));
    // Every call opens its own connection, so a second read is a reopen.
    expect(arrayOf(await readUpload('ir', 'kept.wav'))).toEqual([4, 2]);
    expect(await listUploads('ir')).toEqual(['kept.wav']);
  });

  it('rejects with a readable error when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(listUploads('nam')).rejects.toThrow('IndexedDB is not available');
    await expect(saveUpload('nam', 'a.nam', bytesOf(1))).rejects.toThrow('IndexedDB is not available');
  });
});

describe('upload ids', () => {
  it('round-trips a name through its id, even one containing a colon', () => {
    for (const name of ['amp.nam', 'a:b.wav', 'upload:odd.nam']) {
      expect(uploadName(uploadId(name))).toBe(name);
    }
  });

  it('tells an upload id from a preset url or a legacy custom: id', () => {
    expect(isUploadId(uploadId('amp.nam'))).toBe(true);
    expect(isUploadId('/models/amp.nam')).toBe(false);
    expect(isUploadId('https://example.com/upload:x')).toBe(false);
    expect(isUploadId('custom:amp.nam')).toBe(false);
    expect(isUploadId('')).toBe(false);
  });
});
