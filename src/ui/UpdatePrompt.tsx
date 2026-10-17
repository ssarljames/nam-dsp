import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * A new service worker is waiting. Shown as a modal with a single Update
 * button: Escape and backdrop clicks do not dismiss it, so the only way out is
 * to take the update.
 */
export function UpdatePrompt() {
  const ref = useRef<HTMLDialogElement | null>(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const dialog = ref.current;
    if (needRefresh && dialog && !dialog.open) dialog.showModal();
  }, [needRefresh]);

  if (!needRefresh) return null;

  return (
    <dialog
      ref={ref}
      className="update-modal"
      aria-labelledby="update-modal-message"
      // Escape would close a native dialog; this one has no dismiss. Chromium
      // only honours preventDefault on cancel after a user gesture, so a close
      // that slips through reopens it.
      onCancel={(e) => e.preventDefault()}
      onClose={() => ref.current?.showModal()}
    >
      <div className="update-modal__body">
        <p id="update-modal-message" className="update-modal__message">
          A new version is ready. Reloading will stop the audio stream.
        </p>
        <button
          type="button"
          className="update-modal__button"
          autoFocus
          onClick={() => void updateServiceWorker(true)}
        >
          Update
        </button>
      </div>
    </dialog>
  );
}
