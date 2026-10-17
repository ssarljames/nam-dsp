import { type MutableRefObject, useEffect, useRef } from 'react';
import { LEVEL_SLIDER_LENGTH } from '../Knob/sliderGeometry';
import { GATE_DB_MIN, dbToY, meterSegments, nextLevelDb, peakToDb } from './gateMeterMath';
import { registerMeter } from './meterLoop';

interface GateMeterProps {
  /** The input meter's tap, before the worklet — the level the gate is judging. */
  analyser: AnalyserNode | null;
  /**
   * The gate's threshold in dB, kept current by the slider as it moves. A ref
   * rather than a prop: the meter reads it every frame, and passing it down as
   * state would re-render the panel on every tick of a drag.
   */
  thresholdRef: MutableRefObject<number>;
  /** Match the slider beside it, so the two share a scale. */
  height?: number;
  width?: number;
}

const GRAY = '#6b6b72';
const PASSING = '#3f9d54';

/**
 * A vertical level meter on the gate threshold's own scale, drawn beside its
 * slider so the threshold thumb sits at the height of the level it gates. It
 * follows the signal's peaks, the way the gate's detector does. The part of the
 * signal under the threshold is gray, since the gate would close on it; only
 * the part over it is drawn in colour.
 */
export function GateMeter({
  analyser,
  thresholdRef,
  height = LEVEL_SLIDER_LENGTH,
  width = 14,
}: GateMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelDbRef = useRef(GATE_DB_MIN);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const buffer = new Float32Array(analyser ? analyser.fftSize : 1024);

    return registerMeter((deltaMs) => {
      if (analyser) {
        analyser.getFloatTimeDomainData(buffer);
        let peak = 0;
        for (let i = 0; i < buffer.length; i++) {
          const a = Math.abs(buffer[i]);
          if (a > peak) peak = a;
        }
        levelDbRef.current = nextLevelDb(levelDbRef.current, peakToDb(peak), deltaMs);
      } else {
        levelDbRef.current = GATE_DB_MIN;
      }

      const w = canvas.width;
      const h = canvas.height;
      const y = (db: number) => dbToY(db, height) * dpr;
      const floor = y(GATE_DB_MIN);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0d0d0f';
      ctx.fillRect(0, 0, w, h);

      const threshold = thresholdRef.current;
      const { grayTopDb, colorTopDb } = meterSegments(levelDbRef.current, threshold);

      // Under the threshold: gray, from the floor up to the level or the threshold.
      ctx.fillStyle = GRAY;
      ctx.fillRect(0, y(grayTopDb), w, floor - y(grayTopDb));

      // Over it: colour, from the threshold up to the level.
      if (colorTopDb !== null) {
        ctx.fillStyle = PASSING;
        ctx.fillRect(0, y(colorTopDb), w, y(threshold) - y(colorTopDb));
      }

      // The threshold itself.
      ctx.fillStyle = '#f2ead8';
      ctx.fillRect(0, Math.round(y(threshold)) - dpr / 2, w, dpr);
    });
  }, [analyser, height, thresholdRef, width]);

  return <canvas ref={canvasRef} className="gate-meter" aria-hidden="true" />;
}
