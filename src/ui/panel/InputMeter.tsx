import { useEffect, useRef } from 'react';
import { registerMeter } from './meterLoop';

interface InputMeterProps {
  analyser: AnalyserNode | null;
  width?: number;
  height?: number;
}

/** Ballistics: fast attack, slow release — VU-flavoured rather than sample-accurate. */
const RELEASE_PER_MS = 0.0016;

export function InputMeter({ analyser, width = 180, height = 12 }: InputMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
  const peakRef = useRef(0);

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
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        levelRef.current = Math.max(rms, levelRef.current - deltaMs * RELEASE_PER_MS);
        peakRef.current = Math.max(levelRef.current, peakRef.current - deltaMs * RELEASE_PER_MS * 0.4);
      } else {
        levelRef.current = 0;
        peakRef.current = 0;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = '#0d0d0f';
      ctx.fillRect(0, 0, w, h);

      // -60 dBFS to 0 dBFS across the width.
      const toX = (amplitude: number) => {
        const db = 20 * Math.log10(Math.max(amplitude, 1e-6));
        return Math.max(0, Math.min(1, (db + 60) / 60)) * w;
      };

      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#3f9d54');
      gradient.addColorStop(0.75, '#c9b23a');
      gradient.addColorStop(1, '#d1452f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, toX(levelRef.current), h);

      ctx.fillStyle = '#f2ead8';
      ctx.fillRect(Math.max(0, toX(peakRef.current) - dpr), 0, dpr * 2, h);
    });
  }, [analyser, height, width]);

  return <canvas ref={canvasRef} className="meter" aria-hidden="true" />;
}
