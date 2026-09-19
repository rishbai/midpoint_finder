import { useEffect, useState } from 'react';
import { parseQuery, getFriends, getMeta } from '../api.js';
import { summarizeFilters, initial } from '../format.js';
import Avatar from './Avatar.jsx';
import Filters, { EMPTY_FILTERS } from './Filters.jsx';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Shared by NewPlan (create) and PlanDetail's edit mode.
export default function PlanForm({ initial: initialPlan, existingParticipantIds = [], onSubmit, onCancel, submitLabel }) {
  const [title, setTitle] = useState(initialPlan?.title || '');
  const [queryText, setQueryText] = useState(initialPlan?.queryText || '');
  const [filters, setFilters] = useState(initialPlan?.filters || EMPTY_FILTERS);
  const [plannedFor, setPlannedFor] = useState(toLocalInput(initialPlan?.plannedFor));
  const [meta, setMeta] = useState({ categories: [], vibes: [], cuisines: [] });
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFriends().then((d) => setFriends(d.friends)).catch(() => {});
    getMeta().then(setMeta).catch(() => {});
  }, []);

  // Parses the free-text description into filters, merged on top of the
  // current ones so pills the person already set by hand aren't lost.
  async function parse(text) {
    if (!text.trim()) return null;
    setParsing(true);
    setError('');
    try {
      const { filters: parsed } = await parseQuery(text.trim());
      const merged = { ...EMPTY_FILTERS, ...parsed };
      setFilters(merged);
      return merged;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setParsing(false);
    }
  }

  function toggleFriend(id) {
    setSelected(selected.includes(id) ? selected.filter((f) => f !== id) : [...selected, id]);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Enter-to-submit before the description box ever blurs: parse once,
      // but only if nobody has touched a filter pill yet (don't clobber
      // manual edits with a stale parse of the description text).
      const isPristine = JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS);
      const resolvedFilters = queryText.trim() && isPristine ? (await parse(queryText)) || filters : filters;
      await onSubmit({
        title: title.trim() || queryText.trim() || 'Untitled plan',
        queryText: queryText.trim(),
        filters: resolvedFilters,
        plannedFor: plannedFor ? new Date(plannedFor).toISOString() : null,
        friendIds: selected,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const invitable = friends.filter((f) => !existingParticipantIds.includes(f.id));
  const summary = summarizeFilters(filters);
  const editing = existingParticipantIds.length > 0;

  return (
    <form onSubmit={submit} className="plan-form">
      <div className="form-section">
        <label>
          <span className="form-label">What's the plan?</span>
          <input
            type="text"
            className="input-lg"
            placeholder="Ramen tonight?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!editing}
          />
        </label>
      </div>

      <div className="form-section">
        <label>
          <span className="form-label">What are you looking for?</span>
          <span className="form-hint">Say it however you'd say it to a friend — it gets turned into the filters below.</span>
          <input
            type="text"
            placeholder="cheap drinks and good deals · quiet coffee shop · late night tacos"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onBlur={() => queryText.trim() && parse(queryText)}
          />
        </label>
        {parsing && <p className="form-hint">Reading that…</p>}
        <Filters meta={meta} filters={filters} onChange={setFilters} />
        {summary && <p className="notice">Looking for: {summary}</p>}
      </div>

      <div className="form-section">
        <label>
          <span className="form-label">When</span>
          <span className="form-hint">Optional — transit times get checked for this time of day.</span>
          <input type="datetime-local" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
        </label>
      </div>

      <div className="form-section">
        <span className="form-label">{editing ? 'Invite more friends' : 'Who\'s coming?'}</span>
        {friends.length === 0 ? (
          <p className="form-hint">
            No friends added yet — you can still create the plan and share its invite link afterward, no accounts needed.
          </p>
        ) : invitable.length === 0 ? (
          <p className="form-hint">Everyone you know is already on this plan.</p>
        ) : (
          <div className="people-picker">
            {invitable.map((f, i) => (
              <button
                key={f.id}
                type="button"
                className="person-chip"
                aria-pressed={selected.includes(f.id)}
                onClick={() => toggleFriend(f.id)}
              >
                <Avatar index={i} label={initial(f.name)} />
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="notice">{error}</p>}
      <div className="people-actions">
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving' : submitLabel}
        </button>
      </div>
    </form>
  );
}
