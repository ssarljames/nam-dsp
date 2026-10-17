type MeterCallback = (deltaMs: number) => void;

const callbacks = new Set<MeterCallback>();
let handle = 0;
let last = 0;

function tick(now: number): void {
  const delta = last === 0 ? 16 : now - last;
  last = now;
  for (const callback of callbacks) callback(delta);
  handle = callbacks.size > 0 ? requestAnimationFrame(tick) : 0;
}

/**
 * Meters are the one thing allowed to animate continuously, and they all share
 * a single rAF — one loop per meter is exactly the main-thread pressure that
 * turns into audio dropouts.
 */
export function registerMeter(callback: MeterCallback): () => void {
  callbacks.add(callback);
  if (handle === 0) {
    last = 0;
    handle = requestAnimationFrame(tick);
  }
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && handle !== 0) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
  };
}
