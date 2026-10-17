import { useEffect, useRef, useState } from 'react';
import { TUTORIAL_TOPICS } from './tutorialContent';

interface TutorialModalProps {
  open: boolean;
  onClose: () => void;
  /** Closes the guide and runs the guided tour over the live screen. */
  onStartTour: () => void;
}

const GROUPS = [...new Set(TUTORIAL_TOPICS.map((topic) => topic.group))];

/**
 * The guide: a large modal with the topics down the left and the chosen one on
 * the right. A native <dialog>, like the tuner, so focus stays inside, Escape
 * closes it, and the preset shortcuts stand down while it is open.
 */
export function TutorialModal({ open, onClose, onStartTour }: TutorialModalProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [topicId, setTopicId] = useState(TUTORIAL_TOPICS[0].id);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // A new topic starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [topicId]);

  const index = TUTORIAL_TOPICS.findIndex((topic) => topic.id === topicId);
  const topic = TUTORIAL_TOPICS[index];
  const previous = TUTORIAL_TOPICS[index - 1];
  const next = TUTORIAL_TOPICS[index + 1];

  return (
    <dialog
      ref={ref}
      className="tutorial-modal"
      aria-labelledby="tutorial-modal-title"
      // Fires for Escape and for close() alike; onClose is idempotent.
      onClose={onClose}
      // The dialog has no padding of its own, so a click on the dialog element
      // itself is a click on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="tutorial">
        <header className="tutorial__header">
          <h2 id="tutorial-modal-title" className="tutorial__heading">
            GUIDE
          </h2>
          <span className="tutorial__header-actions">
            <button type="button" className="tutorial__tour-btn" onClick={onStartTour}>
              Take the tour
            </button>
            <button type="button" className="tutorial__close" aria-label="Close guide" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        </header>

        <nav className="tutorial__nav" aria-label="Guide topics">
          {GROUPS.map((group) => (
            <div key={group} className="tutorial__nav-group">
              <span className="tutorial__nav-legend">{group}</span>
              {TUTORIAL_TOPICS.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tutorial__nav-item${t.id === topicId ? ' tutorial__nav-item--on' : ''}`}
                  aria-current={t.id === topicId ? 'page' : undefined}
                  onClick={() => setTopicId(t.id)}
                >
                  {t.title}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="tutorial__content" ref={contentRef}>
          <article className="tutorial__article">
            <span className="tutorial__crumb">{topic.group}</span>
            <h2 className="tutorial__title">{topic.title}</h2>
            {topic.body}
          </article>

          <footer className="tutorial__pager">
            {previous ? (
              <button type="button" className="tutorial__page-btn" onClick={() => setTopicId(previous.id)}>
                ‹ {previous.title}
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button
                type="button"
                className="tutorial__page-btn tutorial__page-btn--next"
                onClick={() => setTopicId(next.id)}
              >
                {next.title} ›
              </button>
            ) : (
              <button type="button" className="tutorial__page-btn tutorial__page-btn--next" onClick={onClose}>
                Done
              </button>
            )}
          </footer>
        </div>
      </div>
    </dialog>
  );
}

/** The top-bar button that opens the guide. */
export function TutorialButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="topnav__icon-btn"
      aria-label="Open guide"
      data-tour="guide"
      aria-haspopup="dialog"
      title="Guide"
      onClick={onOpen}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9.2 9.2a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1.1-1.3 2v.7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="18" r="1.1" fill="currentColor" />
      </svg>
    </button>
  );
}
