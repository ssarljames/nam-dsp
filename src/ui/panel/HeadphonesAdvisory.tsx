import { useState } from 'react';

const KEY = 'nam-pwa.headphones-advisory-dismissed';

export function HeadphonesAdvisory() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <div className="advisory" role="alert" data-tour="advisory">
      <strong>Use headphones.</strong> Monitoring an instrument or microphone through speakers is
      an acoustic feedback loop. Spacebar is a panic mute at any time.
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* private mode — the advisory simply comes back next time */
          }
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
