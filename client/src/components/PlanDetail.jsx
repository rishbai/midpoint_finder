import { useCallback, useEffect, useState } from 'react';
import {
  getPlan,
  updatePlan,
  deletePlan,
  invitePlan,
  addPersonToPlan,
  setPlanTravelModes,
  leavePlan,
  respondToPlan,
  sharePlanLocation,
  getPlanResults,
  getPlanVenueRoutes,
  getFriends,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  modeIcon,
  vehicleLabel,
  formatWhen,
  initial,
  travelModeIcons,
  travelModeSummary,
  ALL_TRAVEL_MODES,
} from '../format.js';
import Avatar from './Avatar.jsx';
import InviteLinkBox from './InviteLinkBox.jsx';
import PlanForm from './PlanForm.jsx';
import PlanMap from './PlanMap.jsx';
import RouteMap from './RouteMap.jsx';
import VenueCard from './VenueCard.jsx';
import TravelModes from './TravelModes.jsx';

function participantStatus(p) {
  if (p.status === 'declined') return { kind: 'muted', text: 'Declined' };
  if (p.hasLocation) return { kind: 'ready', text: 'Location shared' };
  if (p.status === 'joined') return { kind: 'waiting', text: 'No location yet' };
  return { kind: 'invited', text: 'Invited' };
}

function Section({ title, action, children }) {
  return (
    <section className="section">
      <div className="section-head">
        <h3 className="section-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function InvitePanel({ plan, onInvited, onClose }) {
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getFriends().then((d) => setFriends(d.friends)).catch(() => {});
  }, []);

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
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Invite friends</p>
      {invitable.length === 0 ? (
        <p className="form-hint">Everyone you know is already on this plan — share the invite link for anyone else.</p>
      ) : (
        <div className="people-picker">
          {invitable.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className="person-chip"
              aria-pressed={selected.includes(f.id)}
              onClick={() => toggle(f.id)}
            >
              <Avatar index={i} label={initial(f.name)} />
              {f.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="notice">{error}</p>}
      <div className="people-actions">
        <button type="button" className="link" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={submit} disabled={busy || selected.length === 0}>
          {busy ? 'Inviting' : 'Send invites'}
        </button>
      </div>
    </div>
  );
}

// Someone who isn't signing up for anything — the host gives a name and
// where they're coming from. Useful for family: half of them will never make
// an account, but they still have to count in "fair for everyone".
function AddPersonPanel({ onAdd, onClose }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [travelModes, setTravelModes] = useState(ALL_TRAVEL_MODES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onAdd({ name: name.trim(), address: address.trim(), travelModes });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <p className="card-title">Add someone without an account</p>
      <label>
        <span className="form-label">Their name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mom" required autoFocus />
      </label>
      <label>
        <span className="form-label">Where they're coming from</span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Cary, NC"
          required
        />
      </label>
      <div className="form-section">
        <span className="form-label">How they'll get there</span>
        <TravelModes value={travelModes} onChange={setTravelModes} />
      </div>
      {error && <p className="notice">{error}</p>}
      <div className="people-actions">
        <button type="button" className="link" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !name.trim() || !address.trim()}>
          {busy ? 'Adding' : 'Add to plan'}
        </button>
      </div>
    </form>
  );
}

// One person's modes for THIS plan. The same person takes the subway at home
// and drives when they're visiting family, so this is deliberately separate
// from the account default they started with.
function ParticipantTravel({ person, canEdit, onChange }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const icons = travelModeIcons(person.travelModes);
  if (!canEdit) {
    return travelModeSummary(person.travelModes) ? (
      <span className="muted small" title={travelModeSummary(person.travelModes)}>{icons}</span>
    ) : null;
  }

  async function change(modes) {
    setError('');
    try {
      await onChange(modes);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <span className="participant-travel">
      <button
        type="button"
        className="link"
        aria-expanded={open}
        title={travelModeSummary(person.travelModes) || 'Any way of getting there'}
        onClick={() => setOpen(!open)}
      >
        {icons}
      </button>
      {open && (
        <span className="travel-popover">
          <span className="form-label">How {person.isMe ? 'are you' : `is ${person.name}`} getting there?</span>
          <span className="form-hint">Just for this plan — it won't change other plans.</span>
          <TravelModes value={person.travelModes} onChange={change} />
          {error && <span className="notice">{error}</span>}
          <button type="button" className="link" onClick={() => setOpen(false)}>Done</button>
        </span>
      )}
    </span>
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
  const [inviting, setInviting] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [showLink, setShowLink] = useState(false);

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
  const host = plan.participants.find((p) => p.userId === plan.hostId);

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
          // Old results were computed from the old location — showing them
          // next to an updated pin on the map would be actively misleading.
          setResults(null);
          setResultsError('');
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
      setResults(null);
      setResultsError('');
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
        <button type="button" className="link" onClick={() => setMode('view')}>&larr; Back to plan</button>
        <div className="page-head">
          <h2>Edit plan</h2>
        </div>
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
    <div className="plan-detail">
      <button type="button" className="link" onClick={onBack}>&larr; Your plans</button>

      <header className="plan-hero">
        <div className="plan-hero-head">
          <h2>{plan.title}</h2>
          {isHost && (
            <div className="plan-actions">
              <button type="button" className="ghost" onClick={() => setMode('edit')}>Edit</button>
              <button type="button" className="ghost danger" onClick={removePlan} disabled={busy}>Delete</button>
            </div>
          )}
        </div>
        <div className="plan-meta">
          {plan.queryText && <span className="meta-chip">{plan.queryText}</span>}
          {plan.plannedFor && <span className="meta-chip">{formatWhen(plan.plannedFor)}</span>}
          {host && !isHost && <span className="meta-chip muted">Hosted by {host.name}</span>}
        </div>
      </header>

      {me?.status === 'invited' && (
        <div className="card card-accent">
          <p className="card-title">{host?.name || 'Someone'} invited you</p>
          <p className="form-hint">Join to share where you're coming from and see spots that work for everyone.</p>
          <div className="people-actions">
            <button type="button" className="link" onClick={() => respond('declined')} disabled={busy}>
              Decline
            </button>
            <button type="button" className="primary" onClick={() => respond('joined')} disabled={busy}>
              Join
            </button>
          </div>
        </div>
      )}

      <Section
        title={`Who's in · ${plan.participants.length}`}
        action={
          <div className="invite-row">
            {isHost && !inviting && (
              <button type="button" className="ghost" onClick={() => setInviting(true)}>+ Invite friends</button>
            )}
            {isHost && !addingPerson && (
              <button type="button" className="ghost" onClick={() => setAddingPerson(true)}>+ Add by address</button>
            )}
            <button type="button" className="ghost" onClick={() => setShowLink((v) => !v)}>
              {showLink ? 'Hide link' : 'Share link'}
            </button>
          </div>
        }
      >
        <ul className="people-list">
          {plan.participants.map((p, i) => {
            const status = participantStatus(p);
            return (
              <li key={p.userId} className="person-row">
                <Avatar index={i} />
                <span className="person-name">
                  {p.name}
                  {p.userId === plan.hostId && <span className="muted small">host</span>}
                  <ParticipantTravel
                    person={{ ...p, isMe: p.userId === user.id }}
                    canEdit={p.userId === user.id || (isHost && p.addedByHost)}
                    onChange={async (modes) => {
                      const { plan: updated } = await setPlanTravelModes(id, p.userId, modes);
                      setPlan(updated);
                      setResults(null); // times were priced under the old preference
                    }}
                  />
                </span>
                <span className={`status-chip status-${status.kind}`}>{status.text}</span>
              </li>
            );
          })}
        </ul>
        {showLink && (
          <InviteLinkBox
            label="Anyone with this link can join — no account needed"
            url={`${window.location.origin}/join/${plan.shareToken}`}
          />
        )}
        {inviting && (
          <InvitePanel
            plan={plan}
            onInvited={(ids) => invitePlan(id, ids).then((d) => setPlan(d.plan))}
            onClose={() => setInviting(false)}
          />
        )}
        {addingPerson && (
          <AddPersonPanel
            onAdd={async (person) => {
              const { plan: updated } = await addPersonToPlan(id, person);
              setPlan(updated);
              setResults(null);
            }}
            onClose={() => setAddingPerson(false)}
          />
        )}
      </Section>

      <Section title="Where everyone is">
        {peopleForMap.length > 0 ? (
          <PlanMap people={peopleForMap} venues={venuesForMap} />
        ) : (
          <p className="form-hint">The map fills in as people share where they're coming from.</p>
        )}

        {me && me.status !== 'declined' && (
          <div className="card location-card">
            <p className="card-title">
              {me.hasLocation ? 'Your starting point' : 'Where are you coming from?'}
            </p>
            {me.hasLocation && <p className="muted small">{me.address || 'Current location'}</p>}
            <button type="button" className="primary" onClick={shareGeolocation} disabled={busy}>
              {me.hasLocation ? 'Update my location' : 'Share my location'}
            </button>
            <form onSubmit={shareAddress} className="address-form">
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="or type an address / cross streets"
                aria-label="Address"
              />
              <button type="submit" className="ghost" disabled={busy || !address.trim()}>Use address</button>
            </form>
          </div>
        )}
      </Section>

      {error && <p className="notice">{error}</p>}

      <Section
        title="Spots for everyone"
        action={
          canSeeResults && (
            <button type="button" className="primary" onClick={loadResults} disabled={loadingResults}>
              {loadingResults ? 'Checking travel times…' : results ? 'Refresh spots' : 'Find spots'}
            </button>
          )
        }
      >
        {!canSeeResults && (
          <p className="form-hint">
            {sharedCount}/{plan.participants.length} shared their location — once at least two have, you can find spots.
          </p>
        )}
        {canSeeResults && !results && !loadingResults && (
          <p className="form-hint">{sharedCount} of {plan.participants.length} are in. Ready when you are.</p>
        )}

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
      </Section>

      {me && !isHost && me.status !== 'declined' && (
        <p className="plan-foot">
          <button type="button" className="link danger" onClick={leave} disabled={busy}>Leave this plan</button>
        </p>
      )}
    </div>
  );
}
