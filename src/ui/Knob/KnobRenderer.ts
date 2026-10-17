export interface KnobDrawOptions {
  /** Device-pixel size of the square canvas. */
  pixelSize: number;
  dpr: number;
  /** Position in [0,1]. */
  normalized: number;
  /** Where the value arc starts: 0 for unipolar, 0.5 for bipolar. */
  arcOrigin: number;
  /** Draw a notch at this normalized position, if any. */
  detentNormalized?: number;
  focused: boolean;
  dragging: boolean;
}

export interface KnobRenderer {
  draw(ctx: CanvasRenderingContext2D, options: KnobDrawOptions): void;
}

/**
 * 270° of travel, from 7:30 through 12:00 to 4:30.
 *
 * Canvas angles start at 3 o'clock and increase clockwise, so 135° is the
 * 7:30 position. A bipolar parameter's centre detent lands at normalized 0.5,
 * i.e. exactly 12 o'clock — which is where the notch is drawn.
 */
const SWEEP = (270 * Math.PI) / 180;
const START = (3 * Math.PI) / 4;

function angleFor(normalized: number): number {
  return START + normalized * SWEEP;
}

export class CanvasKnobRenderer implements KnobRenderer {
  draw(ctx: CanvasRenderingContext2D, o: KnobDrawOptions): void {
    const size = o.pixelSize;
    const c = size / 2;
    const bodyRadius = size * 0.34;
    const arcRadius = size * 0.44;

    ctx.clearRect(0, 0, size, size);

    // Value arc track.
    ctx.lineWidth = size * 0.055;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(c, c, arcRadius, angleFor(0), angleFor(1));
    ctx.stroke();

    // Value arc fill, from the origin to the current position.
    const from = Math.min(o.arcOrigin, o.normalized);
    const to = Math.max(o.arcOrigin, o.normalized);
    if (to - from > 0.001) {
      ctx.strokeStyle = o.dragging ? '#ffc55a' : '#d8a13a';
      ctx.beginPath();
      ctx.arc(c, c, arcRadius, angleFor(from), angleFor(to));
      ctx.stroke();
    }

    // Tick marks.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, size * 0.008);
    for (let i = 0; i <= 10; i++) {
      const a = angleFor(i / 10);
      const inner = arcRadius + size * 0.045;
      const outer = inner + size * 0.03;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
      ctx.stroke();
    }

    // Detent notch at 12 o'clock (or wherever the detent sits).
    if (o.detentNormalized !== undefined) {
      const a = angleFor(o.detentNormalized);
      ctx.strokeStyle = '#efe4c8';
      ctx.lineWidth = Math.max(1.5, size * 0.012);
      const inner = arcRadius + size * 0.04;
      const outer = inner + size * 0.045;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
      ctx.stroke();
    }

    // Skirted body: radial gradient plus a rim highlight.
    const body = ctx.createRadialGradient(
      c - bodyRadius * 0.4,
      c - bodyRadius * 0.5,
      bodyRadius * 0.1,
      c,
      c,
      bodyRadius,
    );
    body.addColorStop(0, '#5a5a62');
    body.addColorStop(0.55, '#33333a');
    body.addColorStop(1, '#1c1c20');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(c, c, bodyRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, size * 0.006);
    ctx.beginPath();
    ctx.arc(c, c, bodyRadius * 0.98, Math.PI * 1.05, Math.PI * 1.85);
    ctx.stroke();

    // Pointer line.
    const a = angleFor(o.normalized);
    ctx.strokeStyle = '#f2ead8';
    ctx.lineWidth = Math.max(2, size * 0.028);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * bodyRadius * 0.30, c + Math.sin(a) * bodyRadius * 0.30);
    ctx.lineTo(c + Math.cos(a) * bodyRadius * 0.88, c + Math.sin(a) * bodyRadius * 0.88);
    ctx.stroke();

    // Focus ring, drawn outside the body so the canvas cannot swallow it.
    if (o.focused) {
      ctx.strokeStyle = '#7fb2ff';
      ctx.lineWidth = Math.max(2, size * 0.016);
      ctx.beginPath();
      ctx.arc(c, c, size * 0.485, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
