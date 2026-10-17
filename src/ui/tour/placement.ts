/**
 * Where the tour's tooltip goes relative to the element it points at. Pure, so
 * the edge cases (a target at the top, the bottom, a corner, or taller than the
 * room around it) are tested without a browser.
 */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = 'below' | 'above' | 'right' | 'left';

export interface Placement {
  top: number;
  left: number;
  /** Which side of the target the tooltip sits on; the arrow points back at it. */
  side: Side;
  /**
   * The arrow's position along the tooltip's edge facing the target, so it
   * points at the target's centre: from the left edge for below/above, from
   * the top edge for right/left.
   */
  arrow: number;
}

/** Space kept between the tooltip and the viewport edge. */
export const EDGE_MARGIN = 12;
/** Space between the target and the tooltip, room for the arrow. */
export const GAP = 14;
/** How close the arrow may come to the tooltip's corners. */
const ARROW_INSET = 18;

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : v < lo ? lo : v > hi ? hi : v);

export function placeTooltip(
  target: Rect,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const room = {
    below: viewport.height - (target.top + target.height) - GAP - EDGE_MARGIN,
    above: target.top - GAP - EDGE_MARGIN,
    right: viewport.width - (target.left + target.width) - GAP - EDGE_MARGIN,
    left: target.left - GAP - EDGE_MARGIN,
  };

  // Below is the reading order, then above; beside the target only when
  // neither fits, so the tooltip never has to cover what it describes. When
  // nothing fits, the roomier of below and above, clamped on screen.
  const side: Side =
    room.below >= tooltip.height
      ? 'below'
      : room.above >= tooltip.height
        ? 'above'
        : room.right >= tooltip.width
          ? 'right'
          : room.left >= tooltip.width
            ? 'left'
            : room.below >= room.above
              ? 'below'
              : 'above';

  const maxTop = viewport.height - tooltip.height - EDGE_MARGIN;
  const maxLeft = viewport.width - tooltip.width - EDGE_MARGIN;

  if (side === 'below' || side === 'above') {
    const idealTop = side === 'below' ? target.top + target.height + GAP : target.top - GAP - tooltip.height;
    const top = clamp(idealTop, EDGE_MARGIN, maxTop);
    const centre = target.left + target.width / 2;
    const left = clamp(centre - tooltip.width / 2, EDGE_MARGIN, maxLeft);
    return { top, left, side, arrow: clamp(centre - left, ARROW_INSET, tooltip.width - ARROW_INSET) };
  }

  const left = side === 'right' ? target.left + target.width + GAP : target.left - GAP - tooltip.width;
  const middle = target.top + target.height / 2;
  const top = clamp(middle - tooltip.height / 2, EDGE_MARGIN, maxTop);
  return { top, left, side, arrow: clamp(middle - top, ARROW_INSET, tooltip.height - ARROW_INSET) };
}
