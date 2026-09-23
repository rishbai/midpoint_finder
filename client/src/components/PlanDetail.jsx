import { useCallback, useEffect, useState } from 'react';
import {
  getPlan,
  updatePlan,
  deletePlan,
  invitePlan,
  addPersonToPlan,
  setPlanTravelModes,
  removeFromPlan,
  leavePlan,
  respondToPlan,
  sharePlanLocation,
  getPlanResults,
  getPlanVenueRoutes,
  getFriends,
} from '../api.js';
import { useAuth } from '../auth.jsx';
import { modeWord, vehicleLabel, formatWhen, initial, travelModeSummary } from '../format.js';
import { navigate } from '../router.js';
import Avatar from './Avatar.jsx';
import InviteLinkBox from './InviteLinkBox.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';
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
      {busy && <LoadingOverlay label="Sending invites" />}
      <p className="card-title">Invite friends</p>
      {invitable.length === 0 ? (
        <p className="form-hint">Everyone you know is already on this plan. Share the invite link for anyone else.</p>
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
          Send invites
        </button>
      </div>
    </div>
  );
}

// Someone who isn't signing up for anything: the host gives a name and where
// they're coming from. Useful for family, since half of them will never make
// an account, but they still have to count in "fair for everyone".
function AddPersonPanel({ onAdd, onClose }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [travelModes, setTravelModes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!travelModes.length) return;
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
      {busy && <LoadingOverlay label={`Adding ${name.trim() || 'them'} to the plan`} />}
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
          placeholder="An address, cross streets, or a town"
          required
        />
      </label>
      <div className="form-section">
        <span className="form-label">How they'll get there</span>
        <TravelModes value={travelModes} onChange={setTravelModes} />
        {!travelModes.length && <span className="form-hint">Pick at least one.</span>}
      </div>
      {error && <p className="notice">{error}</p>}
      <div className="people-actions">
        <button type="button" className="link" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          className="primary"
          disabled={busy || !name.trim() || !address.trim() || !travelModes.length}
        >
          Add to plan
        </button>
      </div>
    </form>
  );
}

// One person's modes for THIS plan. The same person takes the subway at home
// and drives when visiting family, so it belongs to the trip rather than to
// them. Edited as a draft and saved deliberately, so an empty pick is never
// sent by accident: choosing how you'll travel is a decision, not a default.
function ParticipantTravel({ person, canEdit, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // "Set" means someone actually said; otherwise ranking assumes any way.
  const unset = !person.travelModesSet;
  const summary = unset ? null : travelModeSummary(person.travelModes);

  if (!canEdit) {
    return <span className="travel-static">{summary || 'Any way of getting there'}</span>;
  }

  function begin() {
    setDraft(unset ? [] : person.travelModes);
    setError('');
    setOpen(true);
  }

  async function save() {
    if (!draft.length) return;
    setSaving(true);
    setError('');
    try {
      await onChange(draft);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const subject = person.isMe ? 'you' : person.name;
  return (
    <span className="participant-travel">
      <button
        type="button"
        className={`travel-chip${unset ? ' travel-chip-unset' : ''}`}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : begin())}
      >
        {unset ? `How ${person.isMe ? 'are you' : `is ${person.name}`} getting there?` : summary}
      </button>
      {open && (
        <span className="travel-popover">
          <span className="form-label">How {person.isMe ? 'are you' : `is ${person.name}`} getting there?</span>
          <span className="form-hint">
            Pick everything {subject === 'you' ? "you'd" : `${person.name} would`} be happy to take.
            Just for this plan; other plans are unaffected.
          </span>
          <TravelModes value={draft} onChange={setDraft} disabled={saving} />
          {error && <span className="notice">{error}</span>}
          <span className="people-actions">
            <button type="button" className="link" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="primary small-btn" onClick={save} disabled={saving || !draft.length}>
              {saving ? 'Saving' : 'Save'}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

// Step-by-step directions to one venue, per person. Fetched lazily on first
// expand, not for every venue in the results list.
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
          {loading && (
            <p className="inline-loading">
              <span className="spinner spinner-sm" aria-hidden="true" /> Looking up directions
            </p>
          )}
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
                    {r.minutes != null ? `${r.minutes} min ${modeWord(r.mode)}` : 'no route found'}
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

// The one thing the plan needs next, so nobody has to work out the order.
function nextStep({ plan, me, isHost, sharedCount, results }) {
  if (me?.status === 'invited') return null; // the join card handles this
  if (me && !me.hasLocation) return 'Share where you\'re coming from so the spots are fair for you too.';
  const others = plan.participants.filter((p) => p.status !== 'declined').length;
  if (others < 2) return isHost ? 'Invite someone, or add them by address, to have a middle to find.' : null;
  if (sharedCount < 2) return 'Waiting on others to share their location.';
  if (!results) return 'Everyone needed is in. Find spots when you\'re ready.';
  return null;
}

export default function PlanDetail({ id, editing, onBack }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [busyLabel, setBusyLabel] = useState('');
  const [results, setResults] = useState(null);
  const [resultsError, setResultsError] = useState('');
  const [loadingResults, setLoadingResults] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const busy = Boolean(busyLabel);

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

  if (error && !plan) {
    return (
      <section>
        <button type="button" className="link back" onClick={onBack}>&larr; Your plans</button>
        <p className="notice">{error}</p>
      </section>
    );
  }
  if (!plan) return <LoadingOverlay label="Opening the plan" />;

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

  // Every write to the plan goes through here so the overlay label is always
  // right and nothing can be double-submitted while one is in flight.
  async function run(label, fn) {
    setBusyLabel(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyLabel('');
    }
  }

  // Old results were computed from old inputs. Showing them next to an
  // updated pin on the map would be actively misleading.
  function applyPlan(updated) {
    setPlan(updated);
    setResults(null);
    setResultsError('');
  }

  const respond = (action) => run(action === 'joined' ? 'Joining' : 'Declining', async () => {
    applyPlan((await respondToPlan(id, action)).plan);
  });

  function shareGeolocation() {
    if (!navigator.geolocation) {
      setError("Your browser can't share location. Type an address instead.");
      return;
    }
    setBusyLabel('Finding your location');
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          setBusyLabel('Saving your location');
          applyPlan((await sharePlanLocation(id, { lat, lng })).plan);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusyLabel('');
        }
      },
      () => {
        setError('Location sharing was blocked. Type an address instead.');
        setBusyLabel('');
      }
    );
  }

  const shareAddress = (e) => {
    e.preventDefault();
    if (!address.trim()) return;
    run('Saving your location', async () => {
      applyPlan((await sharePlanLocation(id, { address: address.trim() })).plan);
      setAddress('');
    });
  };

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
    applyPlan(finalPlan);
    navigate(`/plans/${id}`);
  }

  const removePlan = () => {
    if (!window.confirm(`Delete "${plan.title}"? This can't be undone.`)) return;
    run('Deleting the plan', async () => {
      await deletePlan(id);
      onBack();
    });
  };

  const leave = () => {
    if (!window.confirm('Leave this plan?')) return;
    run('Leaving the plan', async () => {
      await leavePlan(id);
      onBack();
    });
  };

  const removePerson = (p) => {
    if (!window.confirm(`Remove ${p.name} from this plan?`)) return;
    run(`Removing ${p.name}`, async () => {
      applyPlan((await removeFromPlan(id, p.userId)).plan);
    });
  };

  if (editing) {
    return (
      <section>
        <button type="button" className="link back" onClick={() => navigate(`/plans/${id}`)}>&larr; Back to plan</button>
        <div className="page-head">
          <h2>Edit plan</h2>
        </div>
        <PlanForm
          initial={plan}
          existingParticipantIds={plan.participants.map((p) => p.userId)}
          onSubmit={saveEdit}
          onCancel={() => navigate(`/plans/${id}`)}
          submitLabel="Save changes"
        />
      </section>
    );
  }

  const hint = nextStep({ plan, me, isHost, sharedCount, results });

  return (
    <div className="plan-detail">
      {busy && <LoadingOverlay label={busyLabel} />}
      {loadingResults && <LoadingOverlay label="Finding spots that work for everyone" />}

      <button type="button" className="link back" onClick={onBack}>&larr; Your plans</button>

      <header className="plan-hero">
        <div className="plan-hero-head">
          <h2>{plan.title}</h2>
          {isHost && (
            <div className="plan-actions">
              <button type="button" className="ghost" onClick={() => navigate(`/plans/${id}/edit`)}>Edit</button>
              <button type="button" className="ghost danger" onClick={removePlan} disabled={busy}>Delete</button>
            </div>
          )}
        </div>
        <div className="plan-meta">
          {plan.queryText && <span className="meta-chip">{plan.queryText}</span>}
          {plan.plannedFor && <span className="meta-chip">{formatWhen(plan.plannedFor)}</span>}
          {host && !isHost && <span className="meta-chip muted">Hosted by {host.name}</span>}
        </div>
        {hint && <p className="next-step">{hint}</p>}
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
            const isMe = p.userId === user.id;
            return (
              <li key={p.userId} className="person-row">
                <Avatar index={i} label={initial(p.name)} />
                <div className="person-main">
                  <span className="person-line">
                    <span className="person-name">{p.name}</span>
                    {isMe && <span className="role-tag">you</span>}
                    {p.userId === plan.hostId && <span className="role-tag">host</span>}
                    {p.addedByHost && <span className="role-tag">no account</span>}
                    {p.address && <span className="muted small person-from">from {p.address}</span>}
                  </span>
                  <ParticipantTravel
                    person={{ ...p, isMe }}
                    canEdit={isMe || (isHost && p.addedByHost)}
                    onChange={async (modes) => {
                      applyPlan((await setPlanTravelModes(id, p.userId, modes)).plan);
                    }}
                  />
                </div>
                <span className="person-side">
                  <span className={`status-chip status-${status.kind}`}>{status.text}</span>
                  {isHost && !isMe && (
                    <button type="button" className="link danger small" onClick={() => removePerson(p)} disabled={busy}>
                      Remove
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {showLink && (
          <InviteLinkBox
            label="Anyone with this link can join. No account needed."
            url={`${window.location.origin}/join/${plan.shareToken}`}
          />
        )}
        {inviting && (
          <InvitePanel
            plan={plan}
            onInvited={(ids) => invitePlan(id, ids).then((d) => applyPlan(d.plan))}
            onClose={() => setInviting(false)}
          />
        )}
        {addingPerson && (
          <AddPersonPanel
            onAdd={async (person) => applyPlan((await addPersonToPlan(id, person)).plan)}
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
          <div className={`card location-card${me.hasLocation ? '' : ' card-accent'}`}>
            <p className="card-title">
              {me.hasLocation ? 'Your starting point' : 'Where are you coming from?'}
            </p>
            {me.hasLocation && <p className="muted small">{me.address || 'Current location'}</p>}
            <div className="location-actions">
              <button type="button" className="primary" onClick={shareGeolocation} disabled={busy}>
                {me.hasLocation ? 'Update my location' : 'Use my current location'}
              </button>
              <form onSubmit={shareAddress} className="address-form">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="or type an address or cross streets"
                  aria-label="Address"
                />
                <button type="submit" className="ghost" disabled={busy || !address.trim()}>Use address</button>
              </form>
            </div>
          </div>
        )}
      </Section>

      {error && <p className="notice notice-error">{error}</p>}

      <Section
        title="Spots for everyone"
        action={
          canSeeResults && (
            <button type="button" className="primary" onClick={loadResults} disabled={loadingResults}>
              {results ? 'Refresh spots' : 'Find spots'}
            </button>
          )
        }
      >
        {!canSeeResults && (
          <p className="form-hint">
            {sharedCount} of {plan.participants.length} have shared their location. Once at least two have, you can find spots.
          </p>
        )}
        {canSeeResults && !results && !loadingResults && (
          <p className="form-hint">{sharedCount} of {plan.participants.length} are in. Ready when you are.</p>
        )}

        {resultsError && <p className="notice notice-error">{resultsError}</p>}
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
                    // to. Look up their position in plan.participants so the
                    // color here matches the list and map above.
                    const person = results.people[i];
                    const personIndex = Math.max(
                      0,
                      plan.participants.findIndex((p) => p.userId === person?.userId)
                    );
                    return (
                      <li key={i} title={person?.name}>
                        <Avatar index={personIndex} label={initial(person?.name)} /> {m} min {modeWord(r.modes?.[i])}
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
