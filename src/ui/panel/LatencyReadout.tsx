import { useEngineState } from '../../state/engineStore';

export function LatencyReadout() {
  const latencyMs = useEngineState().latencyMs;
  return (
    <span
      className="readout"
      data-tour="latency"
      title="Estimated — a true round-trip figure needs a physical loopback and is out of scope"
    >
      <span className="readout__legend">LATENCY</span>
      {latencyMs > 0 ? `~${latencyMs.toFixed(1)} ms` : '—'}
    </span>
  );
}
