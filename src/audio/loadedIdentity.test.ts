import { describe, expect, it } from 'vitest';
import { LoadedIdentity } from './loadedIdentity';

describe('LoadedIdentity', () => {
  it('knows nothing until the engine has accepted a load', () => {
    const id = new LoadedIdentity();
    expect(id.loadedNam(0)).toBeNull();
    id.expectNam(0, 'upload:a.nam');
    expect(id.loadedNam(0)).toBeNull(); // asked, not yet answered
    id.namReply(0, true);
    expect(id.loadedNam(0)).toBe('upload:a.nam');
  });

  it('keeps the old identity when a load is rejected, since the old model is still live', () => {
    const id = new LoadedIdentity();
    id.expectNam(0, 'upload:a.nam');
    id.namReply(0, true);
    id.expectNam(0, 'upload:bad.nam');
    id.namReply(0, false);
    expect(id.loadedNam(0)).toBe('upload:a.nam');
  });

  it('pairs replies with sends in order', () => {
    const id = new LoadedIdentity();
    id.expectNam(0, 'first');
    id.expectNam(0, 'second');
    id.namReply(0, false);
    id.namReply(0, true);
    expect(id.loadedNam(0)).toBe('second');
  });

  it('keeps slots apart', () => {
    const id = new LoadedIdentity();
    id.expectNam(0, 'a');
    id.expectNam(1, 'b');
    id.namReply(1, true);
    expect(id.loadedNam(0)).toBeNull();
    expect(id.loadedNam(1)).toBe('b');
  });

  it('tracks the cab the same way', () => {
    const id = new LoadedIdentity();
    expect(id.loadedCab()).toBeNull();
    id.expectCab('upload:cab.wav');
    id.cabReply(true);
    expect(id.loadedCab()).toBe('upload:cab.wav');
    id.expectCab('upload:other.wav');
    id.cabReply(false);
    expect(id.loadedCab()).toBe('upload:cab.wav');
  });

  it('reports a load in flight until it is answered', () => {
    const id = new LoadedIdentity();
    expect(id.hasNamPending(0)).toBe(false);
    id.expectNam(0, 'a');
    expect(id.hasNamPending(0)).toBe(true);
    expect(id.hasNamPending(1)).toBe(false);
    id.namReply(0, false);
    expect(id.hasNamPending(0)).toBe(false);
    expect(id.hasCabPending()).toBe(false);
    id.expectCab('c');
    expect(id.hasCabPending()).toBe(true);
    id.cabReply(true);
    expect(id.hasCabPending()).toBe(false);
  });

  it('ignores a reply nobody is waiting for', () => {
    const id = new LoadedIdentity();
    expect(() => id.namReply(0, true)).not.toThrow();
    expect(() => id.cabReply(true)).not.toThrow();
    expect(id.loadedNam(0)).toBeNull();
  });
});
