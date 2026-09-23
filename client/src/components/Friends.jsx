import { useEffect, useState } from 'react';
import {
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
} from '../api.js';
import { initial } from '../format.js';
import Avatar from './Avatar.jsx';
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
      <div className="page-head">
        <h2>Friends</h2>
      </div>

      <div className="card">
        <p className="card-title">Add people</p>
        {data.inviteToken && (
          <InviteLinkBox
            label="Your invite link. Send it to anyone; once they sign in, you get a friend request"
            url={`${window.location.origin}/add-friend/${data.inviteToken}`}
          />
        )}
        <form className="row" onSubmit={addFriend}>
          <label>
            Or add by email
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
      </div>

      {data.incoming.length > 0 && (
        <>
          <h3 className="section-title">Requests</h3>
          <ul className="people-list">
            {data.incoming.map((r, i) => (
              <li key={r.id} className="person-row">
                <Avatar index={i} label={initial(r.name)} />
                <span className="person-name">
                  {r.name}
                  <span className="muted small">{r.email}</span>
                </span>
                <span className="person-actions">
                  <button type="button" className="ghost" onClick={() => respond(r.id, 'decline')}>Decline</button>
                  <button type="button" className="primary small-btn" onClick={() => respond(r.id, 'accept')}>Accept</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.outgoing.length > 0 && (
        <>
          <h3 className="section-title">Sent</h3>
          <ul className="people-list">
            {data.outgoing.map((r, i) => (
              <li key={r.id} className="person-row">
                <Avatar index={i + 3} label={initial(r.name)} />
                <span className="person-name">
                  {r.name}
                  <span className="muted small">{r.email}</span>
                </span>
                <span className="status-chip status-waiting">Pending</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="section-title">Your friends</h3>
      {data.friends.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No friends yet</p>
          <p className="muted">Share your invite link above, or add someone by email, to start planning together.</p>
        </div>
      ) : (
        <ul className="people-list">
          {data.friends.map((f, i) => (
            <li key={f.id} className="person-row">
              <Avatar index={i} label={initial(f.name)} />
              <span className="person-name">
                {f.name}
                <span className="muted small">{f.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
