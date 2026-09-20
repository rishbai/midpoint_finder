import { TRAVEL_MODES } from '../format.js';

// How one person is willing to travel. Multi-select rather than one choice:
// the useful answer is usually a combination ("I'll walk or take a bus, but
// not the subway"), and forcing a single pick would lose exactly the nuance
// that makes someone's travel times honest.
export default function TravelModes({ value, onChange, disabled }) {
  const modes = value?.length ? value : [];

  function toggle(mode) {
    const next = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    // Turning off the last one would leave no way to get anywhere, and the
    // server would just reset it to everything — so hold the floor here,
    // where we can show why nothing happened.
    if (!next.length) return;
    onChange(TRAVEL_MODES.map((m) => m.value).filter((m) => next.includes(m)));
  }

  return (
    <span className="mode-picker">
      {TRAVEL_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          className="mode-chip"
          aria-pressed={modes.includes(m.value)}
          disabled={disabled}
          onClick={() => toggle(m.value)}
        >
          <span aria-hidden="true">{m.icon}</span>
          {m.label}
        </button>
      ))}
    </span>
  );
}
