import { useEffect, useState } from 'react';
import { getMeta } from './api.js';
import { AuthProvider, useAuth } from './auth.jsx';
import { EMPTY_FILTERS } from './components/Filters.jsx';
import SearchView from './components/SearchView.jsx';
import Plans from './components/Plans.jsx';
import Friends from './components/Friends.jsx';
import AuthPanel from './components/AuthPanel.jsx';
import JoinPlan from './components/JoinPlan.jsx';
import AddFriend from './components/AddFriend.jsx';

function UpgradePrompt() {
  const { upgrade } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return <button type="button" className="link" onClick={() => setOpen(true)}>Save this account</button>;
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await upgrade(form.email, form.password);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="upgrade-form" onSubmit={submit}>
      <input
        type="email"
        placeholder="email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        required
      />
      <input
        type="password"
        placeholder="password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        required
        minLength={8}
      />
      <button type="submit" className="link" disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
      {error && <span className="notice">{error}</span>}
    </form>
  );
}

function AccountWidget() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;
  if (!user) return <span className="muted">Signed out</span>;
  return (
    <span className="account">
      {user.name}
      {user.isGuest && <UpgradePrompt />}
      <button type="button" className="link" onClick={logout}>Log out</button>
    </span>
  );
}

function AppShell() {
  const { user, loading } = useAuth();
  const [meta, setMeta] = useState({ categories: [], vibes: [], cuisines: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [tab, setTab] = useState('plans');

  useEffect(() => {
    getMeta().then(setMeta).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="sign">
        <h1>midpoint</h1>
        <nav className="tabs" aria-label="Mode">
          <button aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}>
            Plans
          </button>
          <button aria-pressed={tab === 'search'} onClick={() => setTab('search')}>
            Find a spot
          </button>
          <button aria-pressed={tab === 'friends'} onClick={() => setTab('friends')}>
            Friends
          </button>
        </nav>
        <AccountWidget />
      </header>

      <div className="layout">
        <main className="full">
          {tab === 'plans' && (loading ? null : user ? <Plans /> : <AuthPanel prompt="Sign in to make plans with friends." />)}
          {tab === 'search' && <SearchView meta={meta} filters={filters} onFilters={setFilters} />}
          {tab === 'friends' && (loading ? null : user ? <Friends /> : <AuthPanel prompt="Sign in to add friends." />)}
        </main>
      </div>
    </div>
  );
}

// No router dependency for just two deep links: a plan's invite URL
// (/join/:token) and a personal friend-invite URL (/add-friend/:token).
// Everything else is the normal tabbed app.
const JOIN_PATH = /^\/join\/([a-zA-Z0-9]+)\/?$/;
const ADD_FRIEND_PATH = /^\/add-friend\/([a-zA-Z0-9]+)\/?$/;

export default function App() {
  const path = window.location.pathname;
  const joinToken = path.match(JOIN_PATH)?.[1];
  const friendToken = path.match(ADD_FRIEND_PATH)?.[1];

  return (
    <AuthProvider>
      {joinToken ? (
        <JoinPlan token={joinToken} />
      ) : friendToken ? (
        <AddFriend token={friendToken} />
      ) : (
        <AppShell />
      )}
    </AuthProvider>
  );
}
