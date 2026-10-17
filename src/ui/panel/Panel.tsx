import { useId, type HTMLAttributes, type ReactNode } from 'react';
import './panel.css';

interface PanelProps {
  children: ReactNode;
  /**
   * Silkscreened at the top of the panel, naming what it is for. Also becomes
   * the section's accessible name. Omitted for a panel whose single control
   * already says what it does — the live switch, whose legend reads LIVE.
   */
  title?: string;
  /**
   * Rendered at the far right of the title row — the per-panel bypass switch,
   * for any panel that has one. No-op without `title`, since there is no
   * title row to join.
   */
  titleAction?: ReactNode;
  /**
   * Lights the title in the LED colour: this panel's stage is on. Panels with
   * nothing to switch simply never pass it.
   */
  lit?: boolean;
  /** Modifier for panels that need to deviate, e.g. `panel--narrow`. */
  className?: string;
  /**
   * Makes the title a handle (a placed effect's, dragged to reorder): these
   * props go on a focusable span around the title text. The title action —
   * the power switch, a remove button — stays outside it, so it still clicks.
   */
  titleHandle?: HTMLAttributes<HTMLSpanElement>;
  /**
   * The panel's accessible name when it must not be read from the title: a
   * handle carries its own instruction as a label, which would otherwise
   * become the whole panel's name too.
   */
  label?: string;
}

export function Panel({ children, title, titleAction, lit, className, titleHandle, label }: PanelProps) {
  const titleId = useId();

  const classes = ['panel'];
  if (title) classes.push('panel--titled');
  if (lit) classes.push('panel--lit');
  if (className) classes.push(className);

  return (
    <section
      className={classes.join(' ')}
      aria-label={label}
      aria-labelledby={label ? undefined : title ? titleId : undefined}
    >
      <div className="panel__screws" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      {title && (
        <div className="panel__title-row">
          <h2 className="panel__title" id={titleId}>
            {titleHandle ? (
              <span className="panel__handle" tabIndex={0} {...titleHandle}>
                {title}
              </span>
            ) : (
              title
            )}
          </h2>
          {titleAction}
        </div>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}
