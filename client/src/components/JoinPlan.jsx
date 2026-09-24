import { useEffect, useState } from 'react';
import { getPlanPreview, joinPlan } from '../api.js';
import { useAuth } from '../auth.jsx';
import AuthPanel from './AuthPanel.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';
import TravelModes from './TravelModes.jsx';

// The page a plan's invite link opens to. Joining needs a real account, so
// a visitor who isn't signed in sees the plan's name and a sign-in / sign-up
// form first; once they're in, they say how they'll get there and join.
export default function JoinPlan({ token }) {
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState(null);
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
      const { plan } = await joinPlan(token, travelModes);
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

        {!user ? (
          <>
            <p className="muted">Sign in, or make an account, to join. You'll come straight back here.</p>
            <AuthPanel redirectTo={window.location.href} />
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="form-section">
              <span className="form-label">How will you get there?</span>
              <span className="form-hint">
                Pick everything you'd be happy to take. The spot that gets chosen is a fair trip for you by
                these, and it only applies to this plan.
              </span>
              <TravelModes value={travelModes} onChange={setTravelModes} />
              {!travelModes.length && <span className="form-hint">Choose at least one to join.</span>}
            </div>
            {error && <p className="notice notice-error">{error}</p>}
            <button type="submit" className="primary" disabled={busy || !travelModes.length}>
              Join as {user.name}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
