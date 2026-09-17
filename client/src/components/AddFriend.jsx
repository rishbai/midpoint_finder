import { useEffect, useState } from 'react';
import { getFriendInvitePreview, acceptFriendInvite } from '../api.js';
import { useAuth } from '../auth.jsx';
import AuthPanel from './AuthPanel.jsx';

// The page a personal "add me as a friend" link opens to. Unlike a plan's
// invite link (instant, guest accounts welcome), this requires a real login —
// friendship is a lasting identity, not a one-off — and lands as a normal
// pending request the inviter approves from their Friends tab.
export default function AddFriend({ token }) {
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    getFriendInvitePreview(token)
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [token]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      await acceptFriendInvite(token);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
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
        <h2>{preview.inviterName} wants to connect</h2>

        {sent ? (
          <p className="notice">Request sent — {preview.inviterName} will see it in their Friends tab.</p>
        ) : user ? (
          <>
            <p className="muted">Signed in as {user.name}.</p>
            {error && <p className="notice">{error}</p>}
            <button type="button" className="primary" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send friend request'}
            </button>
          </>
        ) : (
          <>
            <p className="muted">Sign in or create an account to connect with {preview.inviterName}.</p>
            <AuthPanel />
          </>
        )}
      </div>
    </div>
  );
}
