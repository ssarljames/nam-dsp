import { describe, expect, it } from 'vitest';
import type { PostEffectId } from '../../audio/engineMessages';
import {
  arrowDelta,
  dropBeside,
  dropSide,
  insertionPoint,
  moveBy,
  placeAt,
  placeAtEnd,
  placedInOrder,
  sameOrder,
  validDropTarget,
} from './effectOrder';

const BOTH: ReadonlySet<PostEffectId> = new Set<PostEffectId>(['chorus', 'delay']);
const DELAY_ONLY: ReadonlySet<PostEffectId> = new Set<PostEffectId>(['delay']);
const NONE: ReadonlySet<PostEffectId> = new Set<PostEffectId>();

const key = (
  k: string,
  mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean }> = {},
) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...mods });

describe('placeAtEnd', () => {
  it('moves a newly placed effect after whatever is already there', () => {
    expect(placeAtEnd(['chorus', 'delay'], 'chorus')).toEqual(['delay', 'chorus']);
  });

  it('leaves an order that already ends with it alone', () => {
    expect(placeAtEnd(['chorus', 'delay'], 'delay')).toEqual(['chorus', 'delay']);
  });

  it('returns a new array', () => {
    const order: PostEffectId[] = ['chorus', 'delay'];
    expect(placeAtEnd(order, 'delay')).not.toBe(order);
  });
});

describe('placedInOrder', () => {
  it('lists the placed effects in the stored order', () => {
    expect(placedInOrder(['delay', 'chorus'], BOTH)).toEqual(['delay', 'chorus']);
    expect(placedInOrder(['chorus', 'delay'], DELAY_ONLY)).toEqual(['delay']);
    expect(placedInOrder(['chorus', 'delay'], NONE)).toEqual([]);
  });
});

describe('dropBeside', () => {
  it('puts the dragged effect before or after the target', () => {
    expect(dropBeside(['chorus', 'delay'], 'delay', 'chorus', 'before')).toEqual(['delay', 'chorus']);
    expect(dropBeside(['delay', 'chorus'], 'delay', 'chorus', 'after')).toEqual(['chorus', 'delay']);
  });

  it('changes nothing when the effect is already on that side', () => {
    expect(dropBeside(['chorus', 'delay'], 'delay', 'chorus', 'after')).toEqual(['chorus', 'delay']);
  });

  it('changes nothing when the target is not in the order', () => {
    expect(dropBeside(['delay'], 'delay', 'chorus', 'before')).toEqual(['delay']);
  });

  it('changes nothing when dropped on itself', () => {
    expect(dropBeside(['chorus', 'delay'], 'chorus', 'chorus', 'after')).toEqual(['chorus', 'delay']);
  });
});

describe('moveBy', () => {
  it('moves one place past the other placed effect', () => {
    expect(moveBy(['chorus', 'delay'], BOTH, 'delay', -1)).toEqual(['delay', 'chorus']);
    expect(moveBy(['chorus', 'delay'], BOTH, 'chorus', 1)).toEqual(['delay', 'chorus']);
  });

  it('stays put at either end', () => {
    expect(moveBy(['chorus', 'delay'], BOTH, 'chorus', -1)).toEqual(['chorus', 'delay']);
    expect(moveBy(['chorus', 'delay'], BOTH, 'delay', 1)).toEqual(['chorus', 'delay']);
  });

  it('does not move past an effect that is not placed', () => {
    expect(moveBy(['chorus', 'delay'], DELAY_ONLY, 'delay', -1)).toEqual(['chorus', 'delay']);
  });

  it('changes nothing when no effect is placed', () => {
    expect(moveBy(['chorus', 'delay'], NONE, 'delay', -1)).toEqual(['chorus', 'delay']);
  });

  it('does not move an effect that is not placed', () => {
    expect(moveBy(['chorus', 'delay'], DELAY_ONLY, 'chorus', 1)).toEqual(['chorus', 'delay']);
  });
});

describe('sameOrder', () => {
  it('compares position by position', () => {
    expect(sameOrder(['chorus', 'delay'], ['chorus', 'delay'])).toBe(true);
    expect(sameOrder(['chorus', 'delay'], ['delay', 'chorus'])).toBe(false);
    expect(sameOrder(['chorus'], ['chorus', 'delay'])).toBe(false);
  });
});

describe('the panel drag rules', () => {
  it('only the other effect is a drop target', () => {
    expect(validDropTarget('chorus', 'delay')).toBe('delay');
    expect(validDropTarget('chorus', 'chorus')).toBeNull();
    expect(validDropTarget('chorus', null)).toBeNull();
  });

  it('splits the target at its middle', () => {
    const rect = { left: 100, width: 200 };
    expect(dropSide(100, rect)).toBe('before');
    expect(dropSide(101, rect)).toBe('before');
    expect(dropSide(199.9, rect)).toBe('before');
    expect(dropSide(200, rect)).toBe('after');
    expect(dropSide(299, rect)).toBe('after');
    expect(dropSide(300, rect)).toBe('after');
  });

  it('a release on the left half of the other panel puts the dragged one before it', () => {
    const target = validDropTarget('delay', 'chorus');
    expect(target).toBe('chorus');
    if (target === null) return;
    expect(dropBeside(['chorus', 'delay'], 'delay', target, dropSide(110, { left: 100, width: 200 }))).toEqual([
      'delay',
      'chorus',
    ]);
  });
});

describe('arrowDelta', () => {
  it('maps the left and right arrows to one place back or forward', () => {
    expect(arrowDelta(key('ArrowLeft'))).toBe(-1);
    expect(arrowDelta(key('ArrowRight'))).toBe(1);
  });

  it('ignores any modifier: Alt is browser back, Ctrl switches desktops', () => {
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(arrowDelta(key('ArrowLeft', { [mod]: true }))).toBeNull();
      expect(arrowDelta(key('ArrowRight', { [mod]: true }))).toBeNull();
    }
  });

  it('ignores a held key, so a burst of swaps cannot restart the effects again and again', () => {
    expect(arrowDelta(key('ArrowRight', { repeat: true }))).toBeNull();
  });

  it('ignores every other key, Space included', () => {
    for (const k of [' ', 'Enter', 'ArrowUp', 'ArrowDown', 'a']) expect(arrowDelta(key(k))).toBeNull();
  });
});

describe('insertionPoint', () => {
  // Chorus spans 100–200 (middle 150), delay 220–320 (middle 270).
  const PANELS = [
    { effect: 'chorus' as const, left: 100, width: 100 },
    { effect: 'delay' as const, left: 220, width: 100 },
  ];

  it('is nothing when the slot holds no panel', () => {
    expect(insertionPoint(150, [])).toBeNull();
  });

  it('goes before the first panel left of its middle, even outside it', () => {
    expect(insertionPoint(149, PANELS)).toEqual({ target: 'chorus', side: 'before' });
    expect(insertionPoint(40, PANELS)).toEqual({ target: 'chorus', side: 'before' });
  });

  it('goes into the gap between two panels anywhere from the first middle to the second', () => {
    expect(insertionPoint(150, PANELS)).toEqual({ target: 'delay', side: 'before' });
    expect(insertionPoint(210, PANELS)).toEqual({ target: 'delay', side: 'before' });
    expect(insertionPoint(269, PANELS)).toEqual({ target: 'delay', side: 'before' });
  });

  it('goes after the last panel right of its middle, even outside it', () => {
    expect(insertionPoint(270, PANELS)).toEqual({ target: 'delay', side: 'after' });
    expect(insertionPoint(900, PANELS)).toEqual({ target: 'delay', side: 'after' });
  });
});

describe('placeAt', () => {
  it('puts a new effect at the end when there is no drop point', () => {
    expect(placeAt(['delay', 'chorus'], 'delay', null)).toEqual(['chorus', 'delay']);
  });

  it('puts a new effect before the panel it was dropped in front of', () => {
    expect(placeAt(['chorus', 'delay'], 'delay', { target: 'chorus', side: 'before' })).toEqual(['delay', 'chorus']);
  });

  it('puts a new effect after the panel it was dropped behind', () => {
    expect(placeAt(['delay', 'chorus'], 'delay', { target: 'chorus', side: 'after' })).toEqual(['chorus', 'delay']);
  });

  it('returns a new array', () => {
    const order: PostEffectId[] = ['chorus', 'delay'];
    expect(placeAt(order, 'delay', null)).not.toBe(order);
  });
});
