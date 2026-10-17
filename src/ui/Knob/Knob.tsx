import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type ParamSpec,
  formatValue,
  normalizedToValue,
  valueToNormalized,
} from '../../audio/params';
import { CanvasKnobRenderer, type KnobRenderer } from './KnobRenderer';
import { applyDetent, deltaToNormalized, isTap, stepValue } from './dragMath';
import './Knob.css';

/** What a parent can do to a knob it does not control: move it. */
export interface KnobHandle {
  /** Moves the knob and its parameter to `value`, like a drag would. Does not call `onCommit`. */
  set: (value: number) => void;
}

interface KnobProps {
  spec: ParamSpec;
  /** Written to directly during a drag. Null before the engine exists. */
  param: AudioParam | null;
  /** Called on pointerup / keyup so React state can catch up once, not per frame. */
  onCommit?: (value: number) => void;
  /**
   * Seeds the initial refs on mount only — e.g. a value restored from
   * persistence. Defaults to `spec.default`. This does NOT make the knob
   * controlled: there is no prop-driven effect after mount, and double-click
   * still resets to `spec.default`, never to this.
   */
  initialValue?: number;
  size?: number;
  renderer?: KnobRenderer;
  /**
   * Called when the knob is clicked without being dragged, with the click's
   * `timeStamp`. A knob that takes taps does not reset on double-click, since
   * two quick taps are a tap. The value is left as it was.
   */
  onTap?: (timeStamp: number) => void;
  /** Filled with a handle for moving the knob from outside (a tap tempo sets it). */
  handleRef?: MutableRefObject<KnobHandle | null>;
  /**
   * The readout, when it is not `formatValue(spec, value)`: the reverb's DECAY
   * is stored as a percent and read out in seconds for the current type.
   */
  format?: (value: number) => string;
}

const defaultRenderer = new CanvasKnobRenderer();

export function Knob({
  spec,
  param,
  onCommit,
  initialValue,
  size = 64,
  renderer = defaultRenderer,
  onTap,
  handleRef,
  format,
}: KnobProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);

  // The live value lives in refs. React is deliberately not involved during a
  // drag: 60 Hz reconciliation of a panel of these starves the main thread, and
  // a starved main thread interrupts MediaStream delivery.
  const startValue = initialValue ?? spec.default;
  const normalizedRef = useRef(valueToNormalized(spec, startValue));
  const valueRef = useRef(startValue);
  const draggingRef = useRef(false);
  const focusedRef = useRef(false);
  const rafRef = useRef(0);
  // Chromium does not populate MouseEvent.movementY on pointer events whose
  // pointerType is 'touch' — it stays 0. This is the relative-delta fallback
  // the spec requires for wherever pointer lock is refused, touch included:
  // seeded on pointerdown, advanced on every move while unlocked.
  const lastClientYRef = useRef(0);
  // How far the pointer has travelled since it went down, to tell a click from
  // a drag.
  const movedRef = useRef(0);

  const [active, setActive] = useState(false);

  const readout = useCallback((value: number) => (format ? format(value) : formatValue(spec, value)), [format, spec]);

  const paint = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    renderer.draw(ctx, {
      pixelSize: canvas.width,
      dpr: window.devicePixelRatio || 1,
      normalized: valueToNormalized(spec, valueRef.current),
      arcOrigin: spec.bipolar ? 0.5 : 0,
      detentNormalized:
        spec.detent === undefined ? undefined : valueToNormalized(spec, spec.detent),
      focused: focusedRef.current,
      dragging: draggingRef.current,
    });

    if (readoutRef.current) readoutRef.current.textContent = readout(valueRef.current);
    wrapperRef.current?.setAttribute('aria-valuenow', String(valueRef.current));
    wrapperRef.current?.setAttribute('aria-valuetext', readout(valueRef.current));
  }, [renderer, spec, readout]);

  const schedulePaint = useCallback(() => {
    if (rafRef.current === 0) rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  const writeValue = useCallback(
    (value: number) => {
      valueRef.current = value;
      if (param) param.value = value; // direct set: no automation event queue
      schedulePaint();
    },
    [param, schedulePaint],
  );

  const setFromNormalized = useCallback(
    (normalized: number) => {
      normalizedRef.current = Math.min(1, Math.max(0, normalized));
      writeValue(applyDetent(spec, normalizedToValue(spec, normalizedRef.current)));
    },
    [spec, writeValue],
  );

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      set: (value) => {
        normalizedRef.current = valueToNormalized(spec, value);
        writeValue(value);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, spec, writeValue]);

  // Size the canvas for the device pixel ratio, and repaint on DPR change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    paint();
  }, [paint, size]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // React registers `wheel` handlers as passive on the root, so
  // event.preventDefault() inside a JSX onWheel prop is silently ignored
  // (Chrome logs "Unable to preventDefault inside passive event listener")
  // and the page scrolls while a knob is being turned. Attaching natively
  // with { passive: false } is the only way to actually suppress that scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      // Shift is the fine modifier everywhere else, so it must not enlarge the
      // wheel step here either.
      const next = stepValue(spec, valueRef.current, direction, false);
      normalizedRef.current = valueToNormalized(spec, next);
      writeValue(next);
      onCommit?.(next);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [spec, onCommit, writeValue]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    lastClientYRef.current = event.clientY;
    movedRef.current = 0;
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    // preventDefault() above suppresses the default focus-on-pointerdown
    // action, so arrow keys would do nothing after a drag without this.
    wrapperRef.current?.focus();

    // Pointer lock is what makes this feel like hardware rather than a web
    // widget: travel becomes unbounded and the cursor cannot drift away. It is
    // refused on touch, where relative movement still works.
    const locked = event.currentTarget.requestPointerLock?.();
    if (locked && typeof (locked as Promise<void>).catch === 'function') {
      (locked as Promise<void>).catch(() => undefined);
    }
    schedulePaint();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    // movementY is real only under pointer lock. Unlocked — notably on touch,
    // where lock is refused — it stays 0, so fall back to a relative delta
    // against the last seen clientY (spec §8).
    const dy = document.pointerLockElement
      ? event.movementY !== undefined
        ? event.movementY
        : 0
      : event.clientY - lastClientYRef.current;
    lastClientYRef.current = event.clientY;
    movedRef.current += Math.abs(dy);
    setFromNormalized(
      normalizedRef.current +
        deltaToNormalized(dy, {
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        }),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setActive(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (document.pointerLockElement) document.exitPointerLock();
    schedulePaint();
    if (onTap && isTap(movedRef.current)) {
      onTap(event.timeStamp);
      return;
    }
    // React finds out once, here — never during the drag.
    onCommit?.(valueRef.current);
  };

  const onDoubleClick = () => {
    if (onTap) return;
    normalizedRef.current = valueToNormalized(spec, spec.default);
    writeValue(spec.default);
    onCommit?.(spec.default);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = stepValue(spec, valueRef.current, 1, false);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = stepValue(spec, valueRef.current, -1, false);
        break;
      case 'PageUp':
        next = stepValue(spec, valueRef.current, 1, true);
        break;
      case 'PageDown':
        next = stepValue(spec, valueRef.current, -1, true);
        break;
      case 'Home':
        next = spec.min;
        break;
      case 'End':
        next = spec.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    normalizedRef.current = valueToNormalized(spec, next);
    writeValue(next);
    onCommit?.(next);
  };

  return (
    <div
      ref={wrapperRef}
      className={`knob${active ? ' knob--active' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={spec.label}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={valueRef.current}
      aria-valuetext={readout(valueRef.current)}
      onKeyDown={onKeyDown}
      onFocus={() => {
        focusedRef.current = true;
        schedulePaint();
      }}
      onBlur={() => {
        focusedRef.current = false;
        schedulePaint();
      }}
    >
      <canvas
        ref={canvasRef}
        className="knob__surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      />
      <span className="knob__legend">{spec.label}</span>
      <span className="knob__readout" ref={readoutRef}>
        {readout(valueRef.current)}
      </span>
    </div>
  );
}
