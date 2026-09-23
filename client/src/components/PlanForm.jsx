import { useEffect, useState } from 'react';
import { parseQuery, getFriends, getMeta } from '../api.js';
import { initial } from '../format.js';
import Avatar from './Avatar.jsx';
import FilterSheet, { EMPTY_FILTERS, FilterBar } from './Filters.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Shared by NewPlan (create) and PlanDetail's edit mode. Reads top to bottom
// as a sentence: what, what kind, when, with whom.
export default function PlanForm({ initial: initialPlan, existingParticipantIds = [], onSubmit, onCancel, submitLabel }) {
  const [title, setTitle] = useState(initialPlan?.title || '');
  const [queryText, setQueryText] = useState(initialPlan?.queryText || '');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...(initialPlan?.filters || {}) });
  const [plannedFor, setPlannedFor] = useState(toLocalInput(initialPlan?.plannedFor));
  const [meta, setMeta] = useState({ categories: [], vibes: [], cuisines: [], styles: {} });
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFriends().then((d) => setFriends(d.friends)).catch(() => {});
    getMeta().then(setMeta).catch(() => {});
  }, []);

  // Turns the description into filters. The chips under the field are the
  // readback: whatever appears there is what will actually be searched for.
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
      // Enter-to-submit before the description ever blurs: parse once, but
      // only if no filter has been touched (don't clobber manual picks).
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
  const editing = existingParticipantIds.length > 0;

  return (
    <form onSubmit={submit} className="plan-form">
      {parsing && <LoadingOverlay label="Reading your description" />}
      {busy && !parsing && <LoadingOverlay label={editing ? 'Saving changes' : 'Creating your plan'} />}
      {sheetOpen && <FilterSheet meta={meta} filters={filters} onChange={setFilters} onClose={() => setSheetOpen(false)} />}

      <div className="field">
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

      <div className="field">
        <label>
          <span className="form-label">What are you looking for?</span>
          <input
            type="text"
            placeholder="good Indian food, quiet coffee shop, late night tacos"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onBlur={() => queryText.trim() && parse(queryText)}
          />
        </label>
        <span className="form-hint">Say it however you'd say it to a friend, or pick filters.</span>
        <FilterBar filters={filters} onChange={setFilters} onOpen={() => setSheetOpen(true)} />
      </div>

      <div className="field">
        <label>
          <span className="form-label">When <span className="muted">(optional)</span></span>
          <input type="datetime-local" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
        </label>
        <span className="form-hint">Travel times get checked for this time of day.</span>
      </div>

      <div className="field">
        <span className="form-label">{editing ? 'Invite more friends' : "Who's coming?"}</span>
        {friends.length === 0 ? (
          <span className="form-hint">
            No friends added yet. You can still create the plan and share its invite link afterward, no accounts needed.
          </span>
        ) : invitable.length === 0 ? (
          <span className="form-hint">Everyone you know is already on this plan.</span>
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

      {error && <p className="notice notice-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{submitLabel}</button>
      </div>
    </form>
  );
}
