import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { logStore, useLogEntries, type LogEntry, type LogLevel } from '../../state/logStore';
import './terminal.css';

const HOST = 'sarl@sarlifier';
const COMMAND = 'tail -f /var/log/sarlifier.log';

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clockOf(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function worstLevel(entries: LogEntry[]): LogLevel | null {
  let worst: LogLevel | null = null;
  for (const entry of entries) {
    if (entry.level === 'error') return 'error';
    if (entry.level === 'warn') worst = 'warn';
    else if (entry.level === 'info' && worst === null) worst = 'info';
  }
  return worst;
}

function Prompt() {
  return (
    <>
      <span className="term-prompt__user">{HOST}</span>
      <span className="term-prompt__sigil">:</span>
      <span className="term-prompt__path">~</span>
      <span className="term-prompt__sigil">$ </span>
    </>
  );
}

export function TerminalDock() {
  const entries = useLogEntries();
  const [open, setOpen] = useState(false);
  // Everything at or below this id has been seen, so the badge counts only
  // what arrived while the drawer was shut.
  const [seenThrough, setSeenThrough] = useState(0);
  const screenRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // One-shot. An error that arrives with the drawer shut would otherwise be
  // invisible — the panel no longer prints anything — but reopening on every
  // subsequent error would fight someone who deliberately closed it.
  const autoOpenedRef = useRef(false);

  const latestId = entries.length > 0 ? entries[entries.length - 1].id : 0;
  const unseen = entries.filter((e) => e.id > seenThrough);
  const unseenLevel = worstLevel(unseen);

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!entries.some((e) => e.level === 'error')) return;
    autoOpenedRef.current = true;
    setOpen(true);
  }, [entries]);

  useEffect(() => {
    if (open) setSeenThrough(latestId);
  }, [open, latestId]);

  // Layout effect, not a plain effect: scrolling after paint shows the old
  // bottom for a frame before jumping.
  useLayoutEffect(() => {
    if (!open) return;
    const screen = screenRef.current;
    if (screen) screen.scrollTop = screen.scrollHeight;
  }, [open, entries]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <div className="term-dock">
      {open && (
        <section className="term-window" aria-label="Message log">
          <header className="term-titlebar">
            <span className="term-titlebar__title">{HOST}: ~</span>
            <span className="term-titlebar__actions">
              <button type="button" className="term-action" onClick={() => logStore.clear()}>
                CLEAR
              </button>
              <button
                type="button"
                className="term-close"
                onClick={close}
                aria-label="Close message log"
              >
                ✕
              </button>
            </span>
          </header>

          <div className="term-screen" ref={screenRef} role="log" aria-live="polite" tabIndex={0}>
            <span className="term-line">
              <Prompt />
              <span className="term-prompt__command">{COMMAND}</span>
            </span>

            {entries.map((entry) => (
              <span key={entry.id} className={`term-line term-line--${entry.level}`}>
                <span className="term-line__time">[{clockOf(entry.at)}] </span>
                <span className="term-line__level">{entry.level}: </span>
                <span className="term-line__text">{entry.text}</span>
                {entry.count > 1 && <span className="term-line__count"> (×{entry.count})</span>}
              </span>
            ))}

            <span className="term-line">
              {entries.length === 0 && (
                <span className="term-line__time">waiting for events… </span>
              )}
              <span className="term-cursor" aria-hidden="true" />
            </span>
          </div>
        </section>
      )}

      {/*
        Enter activates this, not Space: usePanicKey takes Space on window with
        capture and preventDefault, so the panic mute works from any focus
        state — including this button. That is the intended priority; a safety
        cut must not depend on where focus happens to be.
      */}
      <button
        ref={buttonRef}
        type="button"
        className="term-button"
        data-tour="log"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={
          unseen.length > 0
            ? `Message log, ${unseen.length} new ${unseen.length === 1 ? 'message' : 'messages'}`
            : 'Message log'
        }
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="1.5"
            y="3.5"
            width="21"
            height="17"
            rx="2.5"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M6 9.5l3 2.5-3 2.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M11.5 15.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {!open && unseen.length > 0 && (
          <span className={`term-badge${unseenLevel === 'error' ? ' term-badge--error' : ''}`}>
            {unseen.length > 99 ? '99+' : unseen.length}
          </span>
        )}
      </button>
    </div>
  );
}
