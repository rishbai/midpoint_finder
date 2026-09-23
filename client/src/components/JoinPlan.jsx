import { useEffect, useState } from 'react';
import { getPlanPreview, joinPlan } from '../api.js';
import { useAuth } from '../auth.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';
import TravelModes from './TravelModes.jsx';

// The page a plan's invite link opens to. No login required: a signed-in
// visitor (real account or an existing guest) joins with one click; an
// anonymous visitor just gives a name and gets a lightweight guest account.
export default function JoinPlan({ token }) {
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  // Asked here because this is the one moment we have a new person's
  // attention, and their answer is what makes their travel times honest.
  // Starts empty on purpose: picking how you'll get there is a decision.
  const [travelModes, setTravelModes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPlanPreview(token)
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    if (!travelModes.length) return;
    setBusy(true);
    setError('');
    try {
      const { plan } = await joinPlan(token, name.trim(), travelModes);
      // Full reload so the session (a new guest cookie, if any) is picked up
      // cleanly, landing straight on the plan just joined.
      window.location.href = `/plans/${plan.id}`;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (error && !preview) {
    return (
      <div className="app">
        <div className="join-screen">
          <h1>midpoint</h1>
          <p className="notice">{error}</p>
        </div>
      </div>
    );
  }

  if (!preview || authLoading) {
    return (
      <div className="app">
        <LoadingOverlay label="Opening your invite" />
      </div>
    );
  }

  const ready = travelModes.length > 0 && (user || name.trim());

  return (
    <div className="app">
      {busy && <LoadingOverlay label="Joining the plan" />}
      <div className="join-screen">
        <h1>midpoint</h1>
        <p className="welcome-kicker">You're invited</p>
        <h2>{preview.title}</h2>
        <p className="muted">
          Hosted by {preview.hostName} · {preview.participantCount} {preview.participantCount === 1 ? 'person' : 'people'} so far
        </p>

        <form onSubmit={submit}>
          {!user && (
            <label>
              Your name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should we call you?"
                required
                autoFocus
              />
            </label>
          )}
          <div className="form-section">
            <span className="form-label">How will you get there?</span>
            <span className="form-hint">
              Pick everything you'd be happy to take. The spot that gets chosen is a fair trip for you by
              these, and it only applies to this plan.
            </span>
            <TravelModes value={travelModes} onChange={setTravelModes} />
            {!travelModes.length && <span className="form-hint">Choose at least one to join.</span>}
          </div>
          {error && <p className="notice">{error}</p>}
          <button type="submit" className="primary" disabled={busy || !ready}>
            {user ? `Join as ${user.name}` : 'Join'}
          </button>
        </form>
      </div>
    </div>
  );
}
