import { describe, expect, it } from 'vitest';
import { panScrollLeft, shouldStartPan } from './panChain';

describe('panScrollLeft', () => {
  it('scrolls the chain the way the pointer drags it: right drag reveals what is on the left', () => {
    expect(panScrollLeft({ startLeft: 100, startX: 200, x: 230, max: 500 })).toBe(70);
    expect(panScrollLeft({ startLeft: 100, startX: 200, x: 150, max: 500 })).toBe(150);
  });

  it('never scrolls past either end', () => {
    expect(panScrollLeft({ startLeft: 10, startX: 200, x: 400, max: 500 })).toBe(0);
    expect(panScrollLeft({ startLeft: 480, startX: 200, x: 100, max: 500 })).toBe(500);
  });
});

describe('shouldStartPan', () => {
  it('pans on Alt-drag over a panel', () => {
    expect(shouldStartPan({ altKey: true, onBackground: false, onControl: false })).toBe(true);
  });

  it('pans on a plain drag over the empty background between panels', () => {
    expect(shouldStartPan({ altKey: false, onBackground: true, onControl: false })).toBe(true);
  });

  it('leaves a plain drag over a panel alone', () => {
    expect(shouldStartPan({ altKey: false, onBackground: false, onControl: false })).toBe(false);
  });

  it('never steals a drag that starts on a control, even with Alt held', () => {
    expect(shouldStartPan({ altKey: true, onBackground: false, onControl: true })).toBe(false);
    expect(shouldStartPan({ altKey: false, onBackground: true, onControl: true })).toBe(false);
  });
});
