import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeTooltip } from '../tour/placement';

/** How long the tooltip waits after the pointer leaves, so it can travel into it. */
const CLOSE_DELAY_MS = 180;

interface InfoTipProps {
  /** Names the button for screen readers: "About NAM models". */
  label: string;
  children: ReactNode;
}

/**
 * A small ⓘ button with an explanation beside it. Hover opens it with a mouse,
 * focus with the keyboard, and a tap on a touch screen. It stays open while the
 * pointer is over it, so its links can be clicked. Escape or a click elsewhere
 * closes it.
 *
 * The tooltip is portalled to <body> and positioned with `position: fixed`: the
 * signal chain scrolls sideways and would clip anything drawn inside it.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef(0);
  // Set while Escape hands focus back to the button, so that focus (which reads
  // as keyboard focus) does not reopen what Escape just closed.
  const returningFocus = useRef(false);
  const [open, setOpen] = useState(false);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const place = useCallback(() => {
    const button = buttonRef.current;
    const tip = tipRef.current;
    if (!button || !tip) return;
    const r = button.getBoundingClientRect();
    const p = placeTooltip(
      { top: r.top, left: r.left, width: r.width, height: r.height },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    tip.style.top = `${p.top}px`;
    tip.style.left = `${p.left}px`;
    tip.style.setProperty('--arrow', `${p.arrow}px`);
    tip.dataset.side = p.side;
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // While open: follow the button through scrolling and resizing, and close on
  // Escape or on a press anywhere outside the button and the tooltip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        returningFocus.current = true;
        buttonRef.current?.focus();
        returningFocus.current = false;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !tipRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, place]);

  useEffect(() => () => cancelClose(), []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') hideSoon();
        }}
        // Keyboard focus only: a tap also focuses the button, and its click
        // would then toggle straight back closed.
        onFocus={(e) => {
          if (!returningFocus.current && e.currentTarget.matches(':focus-visible')) show();
        }}
        onBlur={(e) => {
          // Tabbing into the tooltip's links keeps it open.
          if (!tipRef.current?.contains(e.relatedTarget as Node)) hideSoon();
        }}
        // A tap on touch, or Enter / Space from the keyboard. A mouse already
        // opened it on hover, so its click leaves it open.
        onClick={(e) => {
          if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType !== 'mouse') setOpen((o) => !o);
          else show();
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="7.6" r="1.1" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            className="info-tip"
            role="group"
            aria-label={label}
            onPointerEnter={cancelClose}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') hideSoon();
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (!tipRef.current?.contains(next) && next !== buttonRef.current) hideSoon();
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
