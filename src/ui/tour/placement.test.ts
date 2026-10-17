import { describe, expect, it } from 'vitest';
import { EDGE_MARGIN, GAP, placeTooltip } from './placement';

const viewport = { width: 1280, height: 800 };
const tooltip = { width: 320, height: 160 };

describe('placeTooltip', () => {
  it('goes below a target near the top, centred on it', () => {
    const p = placeTooltip({ top: 20, left: 600, width: 80, height: 32 }, tooltip, viewport);
    expect(p.side).toBe('below');
    expect(p.top).toBe(20 + 32 + GAP);
    expect(p.left).toBe(640 - 160);
    expect(p.arrow).toBe(160);
  });

  it('goes above a target near the bottom', () => {
    const p = placeTooltip({ top: 740, left: 600, width: 80, height: 40 }, tooltip, viewport);
    expect(p.side).toBe('above');
    expect(p.top).toBe(740 - GAP - 160);
  });

  it('stays inside the left edge and points the arrow at the target', () => {
    const p = placeTooltip({ top: 20, left: 0, width: 40, height: 32 }, tooltip, viewport);
    expect(p.left).toBe(EDGE_MARGIN);
    expect(p.arrow).toBe(18); // the target's centre (20) is inside the corner inset
  });

  it('stays inside the right edge', () => {
    const p = placeTooltip({ top: 20, left: 1250, width: 30, height: 32 }, tooltip, viewport);
    expect(p.left).toBe(1280 - 320 - EDGE_MARGIN);
    expect(p.arrow).toBe(320 - 18);
  });

  it('goes beside a tall target rather than covering it', () => {
    const p = placeTooltip({ top: 100, left: 400, width: 300, height: 640 }, tooltip, viewport);
    // 60 px below, 74 px above: neither fits, so to the right, level with its middle.
    expect(p.side).toBe('right');
    expect(p.left).toBe(400 + 300 + GAP);
    expect(p.top).toBe(420 - 80);
    expect(p.arrow).toBe(80);
  });

  it('goes to the left when only the left has room', () => {
    const p = placeTooltip({ top: 100, left: 800, width: 400, height: 640 }, tooltip, viewport);
    expect(p.side).toBe('left');
    expect(p.left).toBe(800 - GAP - 320);
  });

  it('when nothing fits, uses the roomier of below and above and stays on screen', () => {
    const p = placeTooltip({ top: 100, left: 100, width: 1080, height: 640 }, tooltip, viewport);
    expect(p.side).toBe('above');
    expect(p.top).toBe(EDGE_MARGIN);
  });

  it('never places the tooltip off a viewport smaller than itself', () => {
    const p = placeTooltip({ top: 10, left: 10, width: 20, height: 20 }, tooltip, { width: 300, height: 150 });
    expect(p.left).toBe(EDGE_MARGIN);
    expect(p.top).toBe(EDGE_MARGIN);
  });
});
