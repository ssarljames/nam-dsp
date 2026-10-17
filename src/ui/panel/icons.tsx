/** Small line icons for icon-only buttons. They inherit the button's colour. */

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V5m0 0L8 9m4-4 4 4M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The tremolo's waves, as the WAVE switch draws them: a little over one cycle
 * each, on a 24 x 12 grid. The saw rises and drops, as the tremolo's swells.
 */
const WAVE_PATHS = [
  'M1 6C4.5 0 8.5 0 12 6S19.5 12 23 6',
  'M1 6L6.5 1.5L17.5 10.5L23 6',
  'M1 10V2H12V10H23V2',
  'M1 10L12 2V10L23 2V10',
] as const;

function WaveIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 12" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The four wave drawings, in the order the engine numbers the waves: sine, triangle, square, saw. */
export const WAVE_ICONS = WAVE_PATHS.map((path) => <WaveIcon key={path} path={path} />);
