import { type CSSProperties, type ReactNode, useRef } from 'react';
import { type ParamSpec, formatValue, normalizedToValue, valueToNormalized } from '../../audio/params';
import { applyDetent } from './dragMath';
import { LEVEL_SLIDER_LENGTH } from './sliderGeometry';
import './LevelSlider.css';

interface LevelSliderProps {
  spec: ParamSpec;
  /** Written to directly while the slider moves. Null before the engine exists. */
  param: AudioParam | null;
  /** Called when the slider is released, so React state catches up once, not per frame. */
  onCommit?: (value: number) => void;
  /** Seeds the position on mount only, e.g. a value restored from storage. */
  initialValue?: number;
  /** Track length in CSS pixels. */
  length?: number;
  /**
   * Called with every new value as the slider moves, for something drawn beside
   * it that needs to follow — a meter that marks the value on its own scale.
   * It runs outside React's render, so it must not set state.
   */
  onLive?: (value: number) => void;
  /** Sits right next to the track, level with it — a meter on the same scale. */
  beside?: ReactNode;
  /**
   * Narrower, and without the value printed beside the mid mark: for several
   * sliders side by side, where each one's label would run into the next. The
   * tick itself stays.
   */
  compact?: boolean;
  /** Vertical is a fader; horizontal runs legend, track and value along one row. */
  orientation?: 'vertical' | 'horizontal';
}

/**
 * A vertical fader for a level: the same parameter, taper and detent as the
 * knob it replaces, and the same rule that React stays out of the way while it
 * moves — the value goes straight to the AudioParam and to the readout, and
 * state syncs on release. Double-click puts it back to its default.
 */
export function LevelSlider({
  spec,
  param,
  onCommit,
  initialValue,
  length = LEVEL_SLIDER_LENGTH,
  onLive,
  beside,
  compact,
  orientation = 'vertical',
}: LevelSliderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const start = initialValue ?? spec.default;
  const valueRef = useRef(start);

  const write = (value: number) => {
    valueRef.current = value;
    if (param) param.value = value; // direct set: no automation event queue
    const text = formatValue(spec, value);
    if (readoutRef.current) readoutRef.current.textContent = text;
    inputRef.current?.setAttribute('aria-valuetext', text);
    onLive?.(value);
  };

  const commit = () => onCommit?.(valueRef.current);

  const onInput = () => {
    const input = inputRef.current;
    if (!input) return;
    const raw = normalizedToValue(spec, input.valueAsNumber);
    const value = applyDetent(spec, raw);
    // The magnetic snap has to move the thumb too, or it would sit beside the
    // value it is reporting.
    if (value !== raw) input.value = String(valueToNormalized(spec, value));
    write(value);
  };

  const reset = () => {
    if (inputRef.current) inputRef.current.value = String(valueToNormalized(spec, spec.default));
    write(spec.default);
    commit();
  };

  // The middle of the travel. A parameter with a detent is marked there, since
  // that is the value worth finding by feel (0 dB on a gain); one without is
  // marked at half travel, which its taper is built to put at a useful value.
  const mid = spec.detent === undefined ? 0.5 : valueToNormalized(spec, spec.detent);
  const midLabel = formatValue(spec, normalizedToValue(spec, mid)).replace(' dB', '');
  const horizontal = orientation === 'horizontal';
  const trackVars: Record<string, string | number> = horizontal
    ? { '--mark': mid }
    : { height: length, '--len': `${length}px`, '--mark': mid };
  const trackStyle = trackVars as CSSProperties;
  const classes = ['level-slider'];
  if (compact) classes.push('level-slider--compact');
  if (horizontal) classes.push('level-slider--horizontal');

  return (
    <div className={classes.join(' ')}>
      <span className="level-slider__legend">{spec.label}</span>
      <div className="level-slider__row">
      <div className="level-slider__track" style={trackStyle}>
        <span className="level-slider__mid" aria-hidden="true">
          <span className="level-slider__mid-label">{midLabel}</span>
        </span>
        <input
        ref={inputRef}
        className="level-slider__input"
        type="range"
        min={0}
        max={1}
        step={0.01}
        defaultValue={valueToNormalized(spec, start)}
        aria-label={spec.label}
        aria-valuetext={formatValue(spec, start)}
        onInput={onInput}
        onPointerUp={commit}
        onKeyUp={commit}
        onDoubleClick={reset}
      />
      </div>
      {beside}
      </div>
      <span className="level-slider__readout" ref={readoutRef}>
        {formatValue(spec, start)}
      </span>
    </div>
  );
}
