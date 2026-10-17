import { useEffect, useRef } from 'react';
import { Tuner } from './Tuner';

interface TunerModalProps {
  open: boolean;
  onClose: () => void;
  /** The engine's dedicated tuner tap. Null before the engine exists. */
  analyser: AnalyserNode | null;
}

/**
 * The tuner as a modal: the note large in the middle, the cent meter under it,
 * and a close button at the bottom. A native <dialog>, so focus stays inside,
 * Escape closes it, and the page behind is inert while it is up.
 *
 * The tuner only runs while this is open — closed, it is given no analyser and
 * pitch detection stops entirely, rather than the readout merely being hidden.
 */
export function TunerModal({ open, onClose, analyser }: TunerModalProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="tuner-modal"
      aria-label="Tuner"
      // Fires for Escape and for close() alike; onClose is idempotent.
      onClose={onClose}
      // The dialog has no padding of its own, so a click on the dialog element
      // itself is a click on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="tuner-modal__body">
        {open && <Tuner analyser={analyser} />}
        <button type="button" className="tuner-modal__close" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** The top-bar button that opens the tuner. */
export function TunerButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="topnav__icon-btn"
      aria-label="Open tuner"
      data-tour="tuner"
      aria-haspopup="dialog"
      title="Tuner"
      onClick={onOpen}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 3v7a3 3 0 0 0 6 0V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 13v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
