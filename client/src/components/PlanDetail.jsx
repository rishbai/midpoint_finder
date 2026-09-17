import { useCallback, useEffect, useState } from 'react';
import {
  getPlan,
  updatePlan,
  deletePlan,
  invitePlan,
  leavePlan,
  respondToPlan,
  sharePlanLocation,
  getPlanResults,
  getPlanVenueRoutes,
  getFriends,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import { personLetter, modeIcon, vehicleLabel } from '../format.js';
import InviteLinkBox from './InviteLinkBox.jsx';
import PlanForm from './PlanForm.jsx';
import PlanMap from './PlanMap.jsx';
import RouteMap from './RouteMap.jsx';
import VenueCard from './VenueCard.jsx';

function Avatar({ index }) {
  return (
    <span className="avatar" aria-hidden="true" data-i={index % 6}>
      {personLetter(index)}
    </span>
  );
}

function statusLabel(p) {
  if (p.status === 'declined') return 'declined';
  if (p.hasLocation) return 'shared location';
  if (p.status === 'joined') return 'joined, no location yet';
  return 'invited';
}

function InvitePanel({ plan, onInvited }) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) getFriends().then((d) => setFriends(d.friends)).catch(() => {});
  }, [open]);

  const existingIds = plan.participants.map((p) => p.userId);
  const invitable = friends.filter((f) => !existingIds.includes(f.id));

  function toggle(id) {
    setSelected(selected.includes(id) ? selected.filter((f) => f !== id) : [...selected, id]);
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await onInvited(selected);
      setOpen(false);
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>+ Invite more</button>
    );
  }

  return (
    <div className="share-location">
      {invitable.length === 0 ? (
        <p className="notice">Everyone you can invite is already on this plan.</p>
      ) : (
        <div className="chips">
          {invitable.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              aria-pressed={selected.includes(f.id)}
              onClick={() => toggle(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="notice">{error}</p>}
      <div className="people-actions">
        <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="primary" onClick={submit} disabled={busy || selected.length === 0}>
          {busy ? 'Inviting' : 'Send invites'}
        </button>
      </div>
    </div>
  );
}

// Step-by-step directions to one venue, per person — fetched lazily on
// first expand, not for every venue in the results list.
function RouteDetail({ planId, venue, participants, peopleForMap }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError('');
    try {
      setData(await getPlanVenueRoutes(planId, venue.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function describeStep(step) {
    if (!step.transit) return step.instruction;
    const t = step.transit;
    const line = t.line || vehicleLabel(t.vehicle);
    const span = [t.from && `from ${t.from}`, t.to && `to ${t.to}`].filter(Boolean).join(' ');
    return `Take the ${line} ${vehicleLabel(t.vehicle)}${span ? ` ${span}` : ''}${t.stops ? ` (${t.stops} stops)` : ''}`;
  }

  return (
    <div className="route-toggle">
      <button type="button" className="link" onClick={toggle}>
        {open ? 'Hide routes' : 'See routes'}
      </button>
      {open && (
        <div className="route-detail">
          {loading && <p className="notice">Looking up directions…</p>}
          {error && <p className="notice">{error}</p>}
          {data && (
            <RouteMap
              people={peopleForMap}
              venue={venue}
              routes={data.routes.map((r) => ({
                ...r,
                colorIndex: Math.max(0, participants.findIndex((p) => p.userId === r.userId)),
              }))}
            />
          )}
          {data?.routes.map((r) => {
            const personIndex = Math.max(0, participants.findIndex((p) => p.userId === r.userId));
            return (
              <div key={r.userId} className="route-person">
                <p className="route-person-head">
                  <Avatar index={personIndex} /> <strong>{r.name}</strong>
                  <span className="muted">
                    {' '}
                    — {modeIcon(r.mode)} {r.minutes != null ? `${r.minutes} min` : 'no route found'}
                  </span>
                </p>
                <ul className="route-steps">
                  {r.steps
                    .filter((s) => s.transit || s.instruction)
                    .map((s, j) => <li key={j}>{describeStep(s)}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PlanDetail({ id, onBack }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [resultsError, setResultsError] = useState('');
  const [loadingResults, setLoadingResults] = useState(false);

  const refresh = useCallback(
    () => getPlan(id).then((d) => setPlan(d.plan)).catch((err) => setError(err.message)),
    [id]
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while people are still responding, so the host sees updates without hitting refresh.
  useEffect(() => {
    if (!plan) return;
    const waiting = plan.participants.some((p) => p.status !== 'declined' && !p.hasLocation);
    if (!waiting) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [plan, refresh]);

  if (error && !plan) return <p className="notice">{error}</p>;
  if (!plan) return <p className="count">Loading</p>;

  const isHost = plan.hostId === user.id;
  const me = plan.participants.find((p) => p.userId === user.id);
  const sharedCount = plan.participants.filter((p) => p.hasLocation).length;
  const canSeeResults = sharedCount >= 2;

  // colorIndex = position in plan.participants, so a pin matches that
  // person's Avatar color in the list above.
  const peopleForMap = plan.participants
    .map((p, i) => ({ lat: p.lat, lng: p.lng, name: p.name, colorIndex: i }))
    .filter((p) => p.lat != null && p.lng != null);
  const venuesForMap = (results?.results || [])
    .slice(0, 8)
    .map((r) => ({ lat: r.venue.lat, lng: r.venue.lng, name: r.venue.name }));

  async function respond(action) {
    setBusy(true);
    setError('');
    try {
      setPlan((await respondToPlan(id, action)).plan);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function shareGeolocation() {
    if (!navigator.geolocation) {
      setError("Your browser can't share location. Type an address instead.");
      return;
    }
    setError('');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          setPlan((await sharePlanLocation(id, { lat, lng })).plan);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      },
      () => {
        setError('Location sharing was blocked. Type an address instead.');
        setBusy(false);
      }
    );
  }

  async function shareAddress(e) {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    setError('');
    try {
      setPlan((await sharePlanLocation(id, { address: address.trim() })).plan);
      setAddress('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadResults() {
    setLoadingResults(true);
    setResultsError('');
    try {
      setResults(await getPlanResults(id));
    } catch (err) {
      setResultsError(err.message);
    } finally {
      setLoadingResults(false);
    }
  }

  async function saveEdit(data) {
    const { plan: updated } = await updatePlan(id, {
      title: data.title,
      queryText: data.queryText,
      filters: data.filters,
      plannedFor: data.plannedFor,
    });
    let finalPlan = updated;
    if (data.friendIds.length) {
      finalPlan = (await invitePlan(id, data.friendIds)).plan;
    }
    setPlan(finalPlan);
    setMode('view');
    setResults(null);
  }

  async function removePlan() {
    if (!window.confirm(`Delete "${plan.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deletePlan(id);
      onBack();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function leave() {
    if (!window.confirm('Leave this plan?')) return;
    setBusy(true);
    try {
      await leavePlan(id);
      onBack();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (mode === 'edit') {
    return (
      <section>
        <button type="button" className="link" onClick={() => setMode('view')}>&larr; Back</button>
        <h2>Edit plan</h2>
        <PlanForm
          initial={plan}
          existingParticipantIds={plan.participants.map((p) => p.userId)}
          onSubmit={saveEdit}
          onCancel={() => setMode('view')}
          submitLabel="Save changes"
        />
      </section>
    );
  }

  return (
    <section>
      <button type="button" className="link" onClick={onBack}>&larr; All plans</button>
      <div className="plan-title-row">
        <h2>{plan.title}</h2>
        {isHost && (
          <div className="plan-actions">
            <button type="button" className="link" onClick={() => setMode('edit')}>Edit</button>
            <button type="button" className="link danger" onClick={removePlan} disabled={busy}>Delete</button>
          </div>
        )}
      </div>
      {plan.queryText && <p className="muted">Looking for: {plan.queryText}</p>}
      {plan.plannedFor && (
        <p className="muted">When: {new Date(plan.plannedFor).toLocaleString()}</p>
      )}

      <ul className="plain-list">
        {plan.participants.map((p, i) => (
          <li key={p.userId}>
            <span><Avatar index={i} /> {p.name}</span>
            <span className="muted">{statusLabel(p)}</span>
          </li>
        ))}
      </ul>

      <InviteLinkBox
        label="Invite link — anyone with this can join, no account needed"
        url={`${window.location.origin}/join/${plan.shareToken}`}
      />

      {peopleForMap.length > 0 && <PlanMap people={peopleForMap} venues={venuesForMap} />}

      {isHost && <InvitePanel plan={plan} onInvited={(ids) => invitePlan(id, ids).then((d) => setPlan(d.plan))} />}

      {me?.status === 'invited' && (
        <div className="people-actions">
          <button type="button" className="link" onClick={() => respond('declined')} disabled={busy}>
            Decline
          </button>
          <button type="button" className="primary" onClick={() => respond('joined')} disabled={busy}>
            Join
          </button>
        </div>
      )}

      {me && me.status !== 'declined' && (
        <div className="share-location">
          <p className="muted">
            {me.hasLocation ? `Your shared location: ${me.address || 'current location'}` : "You haven't shared your location yet."}
          </p>
          <button type="button" className="primary" onClick={shareGeolocation} disabled={busy}>
            {me.hasLocation ? 'Update my location' : 'Share my location'}
          </button>
          <form onSubmit={shareAddress}>
            <label>
              or type an address
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Address or cross streets"
              />
            </label>
            <button type="submit" className="link" disabled={busy}>Use address</button>
          </form>
        </div>
      )}

      {me && !isHost && me.status !== 'declined' && (
        <button type="button" className="link danger" onClick={leave} disabled={busy}>Leave plan</button>
      )}

      {error && <p className="notice">{error}</p>}

      <div className="results-header">
        <p className="count">{sharedCount}/{plan.participants.length} shared their location</p>
        {canSeeResults && (
          <button type="button" className="primary" onClick={loadResults} disabled={loadingResults}>
            {loadingResults ? 'Checking travel times' : 'Find spots'}
          </button>
        )}
      </div>

      {resultsError && <p className="notice">{resultsError}</p>}
      {results?.note && <p className="notice">{results.note}</p>}

      {results && results.results.length === 0 && (
        <p className="notice">No matching places between everyone. Try fewer filters.</p>
      )}

      {results && results.results.length > 0 && (
        <div className="results">
          {results.results.map((r) => (
            <VenueCard key={r.venue.id} venue={r.venue}>
              <ul className="trips">
                {r.minutes.map((m, i) => {
                  // results.people[i] is who this minutes[i]/modes[i] belongs
                  // to — look up their position in plan.participants so the
                  // color here matches the list and map above.
                  const personIndex = Math.max(
                    0,
                    plan.participants.findIndex((p) => p.userId === results.people[i]?.userId)
                  );
                  return (
                    <li key={i}>
                      <Avatar index={personIndex} /> {m} min {modeIcon(r.modes?.[i])}
                    </li>
                  );
                })}
              </ul>
              <RouteDetail
                planId={id}
                venue={r.venue}
                participants={plan.participants}
                peopleForMap={peopleForMap}
              />
            </VenueCard>
          ))}
        </div>
      )}
    </section>
  );
}
