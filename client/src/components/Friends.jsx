import { useEffect, useState } from 'react';
import {
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
} from '../api.js';
import InviteLinkBox from './InviteLinkBox.jsx';

export default function Friends() {
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [], inviteToken: null });
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const refresh = () => getFriends().then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    refresh();
  }, []);

  async function addFriend(e) {
    e.preventDefault();
    setError('');
    setStatus('');
    try {
      await sendFriendRequest(email.trim());
      setStatus(`Request sent to ${email.trim()}.`);
      setEmail('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function respond(id, action) {
    setError('');
    try {
      await (action === 'accept' ? acceptFriendRequest(id) : declineFriendRequest(id));
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h2>Friends</h2>

      {data.inviteToken && (
        <InviteLinkBox
          label="Your invite link — anyone who opens it and logs in sends you a friend request"
          url={`${window.location.origin}/add-friend/${data.inviteToken}`}
        />
      )}

      <form className="row" onSubmit={addFriend}>
        <label>
          Add by email
          <input
            type="email"
            placeholder="friend@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary">Send request</button>
      </form>
      {status && <p className="notice">{status}</p>}
      {error && <p className="notice">{error}</p>}

      {data.incoming.length > 0 && (
        <>
          <h3>Requests</h3>
          <ul className="plain-list">
            {data.incoming.map((r) => (
              <li key={r.id}>
                <span>{r.name} <span className="muted">({r.email})</span></span>
                <span>
                  <button type="button" className="link" onClick={() => respond(r.id, 'decline')}>Decline</button>
                  <button type="button" className="link" onClick={() => respond(r.id, 'accept')}>Accept</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.outgoing.length > 0 && (
        <>
          <h3>Sent</h3>
          <ul className="plain-list">
            {data.outgoing.map((r) => (
              <li key={r.id}>
                {r.name} <span className="muted">({r.email}) — pending</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Your friends</h3>
      {data.friends.length === 0 ? (
        <p className="notice">No friends yet. Add someone by email to start planning together.</p>
      ) : (
        <ul className="plain-list">
          {data.friends.map((f) => (
            <li key={f.id}>{f.name} <span className="muted">({f.email})</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
