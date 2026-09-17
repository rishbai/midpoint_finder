import { useEffect, useState } from 'react';
import { parseQuery, getFriends, getMeta } from '../api.js';
import { summarizeFilters } from '../format.js';
import Filters, { EMPTY_FILTERS } from './Filters.jsx';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Shared by NewPlan (create) and PlanDetail's edit mode.
export default function PlanForm({ initial, existingParticipantIds = [], onSubmit, onCancel, submitLabel }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [queryText, setQueryText] = useState(initial?.queryText || '');
  const [filters, setFilters] = useState(initial?.filters || EMPTY_FILTERS);
  const [plannedFor, setPlannedFor] = useState(toLocalInput(initial?.plannedFor));
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

  return (
    <form onSubmit={submit} className="plan-form">
      <label>
        Describe it (optional)
        <input
          type="text"
          placeholder="happy hour that goes past 7pm"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          onBlur={() => queryText.trim() && parse(queryText)}
        />
      </label>
      {parsing && <p className="notice">Reading that…</p>}

      <Filters meta={meta} filters={filters} onChange={setFilters} />
      {summary && <p className="notice">Looking for: {summary}</p>}

      <label>
        Title
        <input type="text" placeholder="Ramen tonight?" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label>
        When (optional)
        <input type="datetime-local" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
      </label>

      {invitable.length > 0 && (
        <fieldset>
          <legend>{existingParticipantIds.length ? 'Invite more friends' : 'Invite friends'}</legend>
          <div className="chips">
            {invitable.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={selected.includes(f.id)}
                onClick={() => toggleFriend(f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {friends.length === 0 && (
        <p className="notice">No friends yet — add some in the Friends tab first. You can still save and invite people later.</p>
      )}

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
