import { useEffect, useState } from 'react';
import { getMeta } from './api.js';
import { AuthProvider, useAuth } from './auth.jsx';
import { initial } from './format.js';
import { navigate, parsePath, usePath } from './router.js';
import { EMPTY_FILTERS } from './components/Filters.jsx';
import Avatar from './components/Avatar.jsx';
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
  if (loading || !user) return null;
  return (
    <div className="account">
      <Avatar index={1} label={initial(user.name)} />
      <span className="account-name">{user.name}</span>
      {user.isGuest && <UpgradePrompt />}
      <button type="button" className="link" onClick={logout}>Log out</button>
    </div>
  );
}

// What someone sees on Plans/Friends before they're signed in: a reason to,
// not just a form.
function Welcome({ prompt }) {
  return (
    <div className="welcome">
      <p className="welcome-kicker">Meet in the middle</p>
      <h2 className="welcome-title">Pick a spot that's fair for everyone.</h2>
      <p className="muted">
        Make a plan, say what you're in the mood for, invite friends. Everyone shares where they're coming from, and
        midpoint finds places that are a fair trip for all of you, whether that's by train, bus, car, or on foot.
      </p>
      <AuthPanel prompt={prompt} />
    </div>
  );
}

const TABS = [
  { key: 'plans', label: 'Plans', path: '/' },
  { key: 'search', label: 'Find a spot', path: '/search' },
  { key: 'friends', label: 'Friends', path: '/friends' },
];

function AppShell({ route }) {
  const { user, loading } = useAuth();
  const [meta, setMeta] = useState({ categories: [], vibes: [], cuisines: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  useEffect(() => {
    getMeta().then(setMeta).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="sign">
        <h1>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>midpoint</a>
        </h1>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.key} aria-pressed={route.tab === t.key} onClick={() => navigate(t.path)}>
              {t.label}
            </button>
          ))}
        </nav>
        <AccountWidget />
      </header>

      <div className="layout">
        <main className="full">
          {route.tab === 'plans' &&
            (loading ? null : user ? <Plans route={route} /> : <Welcome prompt="Sign in to make plans with friends." />)}
          {route.tab === 'search' && <SearchView meta={meta} filters={filters} onFilters={setFilters} />}
          {route.tab === 'friends' &&
            (loading ? null : user ? <Friends /> : <Welcome prompt="Sign in to add friends." />)}
        </main>
      </div>
    </div>
  );
}

// Two pages live outside the app chrome: a plan's invite link and a personal
// friend-invite link. Everything else is the tabbed app, driven by the URL
// (see router.js) so a refresh stays where you were.
const JOIN_PATH = /^\/join\/([a-zA-Z0-9]+)\/?$/;
const ADD_FRIEND_PATH = /^\/add-friend\/([a-zA-Z0-9]+)\/?$/;

export default function App() {
  const path = usePath();
  const joinToken = path.match(JOIN_PATH)?.[1];
  const friendToken = path.match(ADD_FRIEND_PATH)?.[1];

  return (
    <AuthProvider>
      {joinToken ? (
        <JoinPlan token={joinToken} />
      ) : friendToken ? (
        <AddFriend token={friendToken} />
      ) : (
        <AppShell route={parsePath(path)} />
      )}
    </AuthProvider>
  );
}
