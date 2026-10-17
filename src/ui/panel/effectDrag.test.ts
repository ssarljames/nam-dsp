import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, EFFECTS, canDrop, exceedsDragThreshold } from './effectDrag';

describe('canDrop', () => {
  it('lets chorus and delay go on POST only', () => {
    expect(canDrop('delay', 'post')).toBe(true);
    expect(canDrop('delay', 'pre')).toBe(false);
    expect(canDrop('chorus', 'post')).toBe(true);
    expect(canDrop('chorus', 'pre')).toBe(false);
  });

  it('lets the reverb go on POST only', () => {
    expect(canDrop('reverb', 'post')).toBe(true);
    expect(canDrop('reverb', 'pre')).toBe(false);
  });

  it('lets the tremolo go on POST only', () => {
    expect(canDrop('tremolo', 'post')).toBe(true);
    expect(canDrop('tremolo', 'pre')).toBe(false);
  });

  it('lets the drive go on PRE only', () => {
    expect(canDrop('drive', 'pre')).toBe(true);
    expect(canDrop('drive', 'post')).toBe(false);
  });
});

describe('EFFECTS', () => {
  it('lists every live effect in chain order', () => {
    expect(EFFECTS).toEqual(['drive', 'chorus', 'tremolo', 'delay', 'reverb']);
  });
});

describe('exceedsDragThreshold', () => {
  it('treats a small wobble as a click, not a drag', () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
    expect(exceedsDragThreshold(3, 3)).toBe(false);
  });

  it('starts a drag once the pointer has moved far enough in any direction', () => {
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(exceedsDragThreshold(0, -DRAG_THRESHOLD_PX)).toBe(true);
    expect(exceedsDragThreshold(5, 5)).toBe(true);
  });
});
