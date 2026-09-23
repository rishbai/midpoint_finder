import { TRAVEL_MODES } from '../format.js';

// How one person is willing to travel. Multi-select, and nothing is picked
// to begin with: choosing how you'll get there is a decision, not a default
// to undo. The parent decides whether an empty answer is allowed through.
export default function TravelModes({ value, onChange, disabled }) {
  const modes = value || [];

  function toggle(mode) {
    const next = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    onChange(TRAVEL_MODES.map((m) => m.value).filter((m) => next.includes(m)));
  }

  return (
    <span className="mode-picker" role="group" aria-label="Ways of getting there">
      {TRAVEL_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          className="mode-chip"
          aria-pressed={modes.includes(m.value)}
          disabled={disabled}
          onClick={() => toggle(m.value)}
        >
          {m.label}
        </button>
      ))}
    </span>
  );
}
