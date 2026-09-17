import { useEffect, useState } from 'react';
import { getPlanPreview, joinPlan } from '../api.js';
import { useAuth } from '../auth.jsx';

// The page a plan's invite link opens to — no login required. A signed-in
// visitor (real account or an existing guest) joins with one click; an
// anonymous visitor just gives a name and gets a lightweight guest account.
export default function JoinPlan({ token }) {
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    getPlanPreview(token)
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await joinPlan(token, name.trim());
      setJoined(true);
      // Full reload so the auth/session state (new guest cookie, if any) is
      // picked up cleanly — lands on Plans, where the joined plan now shows.
      window.location.href = '/';
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
        <div className="join-screen">
          <h1>midpoint</h1>
          <p className="count">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="join-screen">
        <h1>midpoint</h1>
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
          {error && <p className="notice">{error}</p>}
          <button type="submit" className="primary" disabled={busy || joined}>
            {busy || joined ? 'Joining…' : user ? `Join as ${user.name}` : 'Join'}
          </button>
        </form>
      </div>
    </div>
  );
}
