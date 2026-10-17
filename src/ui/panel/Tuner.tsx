import { useEffect, useRef } from 'react';
import { detectPitch, frequencyToNote, type NoteReading } from '../../audio/pitch';
import { registerMeter } from './meterLoop';

interface TunerProps {
  /**
   * The engine's dedicated tuner tap (see AudioEngine.tunerAnalyserNode) —
   * before the worklet, so this works whether or not the engine is engaged.
   * Null before the engine exists.
   */
  analyser: AnalyserNode | null;
}

/** Cents deviation within this band reads as in tune. */
const IN_TUNE_CENTS = 5;

/** The bar sweeps ±this many cents; anything beyond pins to the edge. */
const MAX_CENTS = 50;

/**
 * Roughly 10 Hz. `detectPitch` is an autocorrelation over a 4096-sample
 * window — running it every rAF tick would put ~167k multiply-adds on the
 * main thread 60 times a second, and a stalled main thread starves
 * `MediaStream` delivery: a UI cost becomes an audio dropout.
 */
const DETECT_INTERVAL_MS = 100;

const MINUS = '−'; // U+2212 MINUS SIGN, matching src/audio/params.ts's convention.

function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  if (rounded === 0) return '+0';
  return rounded > 0 ? `+${rounded}` : `${MINUS}${Math.abs(rounded)}`;
}

export function Tuner({ analyser }: TunerProps) {
  const noteRef = useRef<HTMLSpanElement | null>(null);
  const centsRef = useRef<HTMLSpanElement | null>(null);
  const needleRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    // Written imperatively, the same way Knob writes its value readout — this
    // updates at ~10 Hz and setState-ing it would re-render the whole panel
    // for the life of the session.
    const writeIdle = () => {
      if (noteRef.current) noteRef.current.textContent = '—';
      if (centsRef.current) centsRef.current.textContent = '';
      if (needleRef.current) {
        needleRef.current.style.left = '50%';
        needleRef.current.style.background = 'var(--legend-dim)';
      }
    };

    const writeReading = (note: NoteReading) => {
      if (noteRef.current) noteRef.current.textContent = `${note.name}${note.octave}`;
      if (centsRef.current) centsRef.current.textContent = formatCents(note.cents);
      if (needleRef.current) {
        const clamped = Math.max(-MAX_CENTS, Math.min(MAX_CENTS, note.cents));
        const pct = 50 + (clamped / MAX_CENTS) * 50;
        needleRef.current.style.left = `${pct}%`;
        needleRef.current.style.background =
          Math.abs(note.cents) <= IN_TUNE_CENTS ? 'var(--led-on)' : 'var(--legend-dim)';
      }
    };

    // No stale last reading: idle whenever there is nothing to read, rather
    // than leaving the previous note on screen.
    writeIdle();
    if (!analyser) return;

    // Allocated once for the life of this analyser, not per callback.
    const samples = new Float32Array(analyser.fftSize);
    let accumulatedMs = 0;

    return registerMeter((deltaMs) => {
      accumulatedMs += deltaMs;
      if (accumulatedMs < DETECT_INTERVAL_MS) return;
      accumulatedMs = 0;

      analyser.getFloatTimeDomainData(samples);
      const pitch = detectPitch(samples, analyser.context.sampleRate);
      if (!pitch) {
        writeIdle();
        return;
      }
      writeReading(frequencyToNote(pitch.frequency));
    });
  }, [analyser]);

  return (
    <div className="tuner">
      <span className="tuner__note" ref={noteRef}>
        —
      </span>
      <span className="tuner__cents" ref={centsRef} />
      <div className="tuner__bar">
        <span className="tuner__centre" aria-hidden="true" />
        <span className="tuner__needle" ref={needleRef} aria-hidden="true" />
      </div>
    </div>
  );
}
