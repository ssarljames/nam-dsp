import { describe, expect, it } from 'vitest';
import { resolveShortcut, type ShortcutContext, type ShortcutEvent } from './presetShortcuts';

const key = (k: string, over: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  ...over,
});
const free: ShortcutContext = { inTextField: false, modalOpen: false };

describe('resolveShortcut — the keys', () => {
  it('steps with [ and ]', () => {
    expect(resolveShortcut(key('['), free)).toEqual({ type: 'previous' });
    expect(resolveShortcut(key(']'), free)).toEqual({ type: 'next' });
  });

  it('jumps to a position with 1 to 9, zero-based', () => {
    expect(resolveShortcut(key('1'), free)).toEqual({ type: 'jump', index: 0 });
    expect(resolveShortcut(key('9'), free)).toEqual({ type: 'jump', index: 8 });
    expect(resolveShortcut(key('0'), free)).toBeNull();
  });

  it('opens the list with / and with Ctrl or Cmd + K', () => {
    expect(resolveShortcut(key('/'), free)).toEqual({ type: 'openList' });
    expect(resolveShortcut(key('k', { ctrlKey: true }), free)).toEqual({ type: 'openList' });
    expect(resolveShortcut(key('K', { metaKey: true }), free)).toEqual({ type: 'openList' });
  });

  it('saves with Ctrl or Cmd + S, and saves as new with Shift', () => {
    expect(resolveShortcut(key('s', { ctrlKey: true }), free)).toEqual({ type: 'save' });
    expect(resolveShortcut(key('s', { metaKey: true }), free)).toEqual({ type: 'save' });
    expect(resolveShortcut(key('S', { ctrlKey: true, shiftKey: true }), free)).toEqual({ type: 'saveAs' });
  });
});

describe('resolveShortcut — keys it must leave alone', () => {
  it('never claims Space, which is the panic mute', () => {
    expect(resolveShortcut(key(' '), free)).toBeNull();
    expect(resolveShortcut(key(' ', { ctrlKey: true }), free)).toBeNull();
  });

  it('never claims plain arrows, which the sliders use', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(resolveShortcut(key(k), free)).toBeNull();
    }
  });

  it('never claims Alt combinations, which are browser Back and Forward', () => {
    expect(resolveShortcut(key('ArrowLeft', { altKey: true }), free)).toBeNull();
    expect(resolveShortcut(key('[', { altKey: true }), free)).toBeNull();
  });

  it('does not treat a modifier as a plain key', () => {
    expect(resolveShortcut(key('[', { ctrlKey: true }), free)).toBeNull();
    expect(resolveShortcut(key('1', { metaKey: true }), free)).toBeNull();
  });
});

describe('resolveShortcut — when to stay out of the way', () => {
  it('ignores single keys while typing in a text field', () => {
    const typing: ShortcutContext = { inTextField: true, modalOpen: false };
    expect(resolveShortcut(key('['), typing)).toBeNull();
    expect(resolveShortcut(key('1'), typing)).toBeNull();
    expect(resolveShortcut(key('/'), typing)).toBeNull();
  });

  it('still lets Ctrl+S save from inside a text field', () => {
    const typing: ShortcutContext = { inTextField: true, modalOpen: false };
    expect(resolveShortcut(key('s', { ctrlKey: true }), typing)).toEqual({ type: 'save' });
  });

  it('ignores everything while a modal is open', () => {
    const modal: ShortcutContext = { inTextField: false, modalOpen: true };
    expect(resolveShortcut(key(']'), modal)).toBeNull();
    expect(resolveShortcut(key('s', { ctrlKey: true }), modal)).toBeNull();
  });

  it('ignores a held key, so holding ] does not run through the list', () => {
    expect(resolveShortcut(key(']', { repeat: true }), free)).toBeNull();
    expect(resolveShortcut(key('s', { ctrlKey: true, repeat: true }), free)).toBeNull();
  });

  it('ignores keys that are part of an IME composition', () => {
    expect(resolveShortcut(key(']', { isComposing: true }), free)).toBeNull();
  });
});
