import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLY_DELAY_MS, createCoalescer } from './applyCoalescer';

describe('createCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies nothing until the delay has passed', () => {
    const seen: string[] = [];
    const c = createCoalescer<string>((v) => seen.push(v));
    c.push('a');
    vi.advanceTimersByTime(APPLY_DELAY_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['a']);
  });

  it('applies a burst once, with the last value', () => {
    const seen: string[] = [];
    const c = createCoalescer<string>((v) => seen.push(v));
    for (const v of ['a', 'b', 'c', 'd']) {
      c.push(v);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(APPLY_DELAY_MS);
    expect(seen).toEqual(['d']);
  });

  it('starts a fresh burst after the last one has landed', () => {
    const seen: string[] = [];
    const c = createCoalescer<string>((v) => seen.push(v));
    c.push('a');
    vi.advanceTimersByTime(APPLY_DELAY_MS);
    c.push('b');
    vi.advanceTimersByTime(APPLY_DELAY_MS);
    expect(seen).toEqual(['a', 'b']);
  });

  it('can be cancelled', () => {
    const seen: string[] = [];
    const c = createCoalescer<string>((v) => seen.push(v));
    c.push('a');
    c.cancel();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
    expect(c.pending()).toBe(false);
  });

  it('reports whether a value is waiting', () => {
    const c = createCoalescer<string>(() => undefined);
    expect(c.pending()).toBe(false);
    c.push('a');
    expect(c.pending()).toBe(true);
    vi.advanceTimersByTime(APPLY_DELAY_MS);
    expect(c.pending()).toBe(false);
  });

  it('honours a custom delay', () => {
    const seen: number[] = [];
    const c = createCoalescer<number>((v) => seen.push(v), 500);
    c.push(1);
    vi.advanceTimersByTime(499);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([1]);
  });
});
