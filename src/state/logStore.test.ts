import { beforeEach, describe, expect, it } from 'vitest';
import { log, logStore, MAX_ENTRIES, pushLog } from './logStore';

beforeEach(() => {
  logStore.clear();
});

describe('logStore', () => {
  it('records level, text and order', () => {
    log.info('opening input');
    log.warn('constraint not honoured');
    log.error('worklet failed');

    const entries = logStore.getSnapshot();
    expect(entries.map((e) => [e.level, e.text])).toEqual([
      ['info', 'opening input'],
      ['warn', 'constraint not honoured'],
      ['error', 'worklet failed'],
    ]);
  });

  it('gives every entry a distinct id', () => {
    log.info('a');
    log.info('b');
    log.info('c');
    const ids = logStore.getSnapshot().map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });

  // The device layer can fail in a tight loop — a stream that will not open,
  // a hotplug storm. Without coalescing, one repeating fault scrolls the
  // history that explains it off the top.
  it('coalesces consecutive identical entries into a count', () => {
    log.warn('device disappeared');
    log.warn('device disappeared');
    log.warn('device disappeared');

    const entries = logStore.getSnapshot();
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(3);
  });

  it('does not coalesce across a different entry', () => {
    log.warn('same');
    log.info('interruption');
    log.warn('same');

    const entries = logStore.getSnapshot();
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.count === 1)).toBe(true);
  });

  it('does not coalesce the same text at a different level', () => {
    log.warn('ambiguous');
    log.error('ambiguous');
    expect(logStore.getSnapshot()).toHaveLength(2);
  });

  // Several call sites used to clear their state by writing ''. That means
  // "nothing to report", and a blank line in a log is worse than no line.
  it('ignores empty and whitespace-only text', () => {
    log.info('');
    log.warn('   ');
    log.error('\n\t');
    expect(logStore.getSnapshot()).toHaveLength(0);
  });

  it('trims surrounding whitespace', () => {
    log.info('  padded  ');
    expect(logStore.getSnapshot()[0].text).toBe('padded');
  });

  it('caps the history and drops the oldest first', () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) pushLog('info', `entry ${i}`);

    const entries = logStore.getSnapshot();
    expect(entries).toHaveLength(MAX_ENTRIES);
    // The newest survive; the first 25 are gone.
    expect(entries[0].text).toBe('entry 25');
    expect(entries[entries.length - 1].text).toBe(`entry ${MAX_ENTRIES + 24}`);
  });

  it('unwraps an Error and returns what it logged', () => {
    const returned = log.exception(new Error('NotReadableError: device in use'));
    expect(returned).toBe('NotReadableError: device in use');
    const entry = logStore.getSnapshot()[0];
    expect(entry.level).toBe('error');
    expect(entry.text).toBe('NotReadableError: device in use');
  });

  it('stringifies a non-Error throw', () => {
    log.exception('plain string rejection');
    expect(logStore.getSnapshot()[0].text).toBe('plain string rejection');
  });

  // useSyncExternalStore re-renders only when the snapshot reference changes,
  // and tears if the reference changes when nothing did.
  it('returns a new array reference on change and a stable one otherwise', () => {
    const empty = logStore.getSnapshot();
    expect(logStore.getSnapshot()).toBe(empty);

    log.info('something');
    const afterPush = logStore.getSnapshot();
    expect(afterPush).not.toBe(empty);
    expect(logStore.getSnapshot()).toBe(afterPush);

    log.info('something'); // coalesces, but the contents still changed
    expect(logStore.getSnapshot()).not.toBe(afterPush);
  });

  it('notifies subscribers on push and on clear, but not on an ignored push', () => {
    let notifications = 0;
    const unsubscribe = logStore.subscribe(() => {
      notifications++;
    });

    log.info('one');
    expect(notifications).toBe(1);

    log.info(''); // ignored — no state change, so no notification
    expect(notifications).toBe(1);

    logStore.clear();
    expect(notifications).toBe(2);

    logStore.clear(); // already empty — nothing changed
    expect(notifications).toBe(2);

    unsubscribe();
    log.info('after unsubscribe');
    expect(notifications).toBe(2);
  });
});
