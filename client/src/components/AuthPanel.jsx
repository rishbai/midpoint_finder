import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function AuthPanel({ prompt, redirectTo }) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await signup(form.name, form.email, form.password, { redirectTo });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-panel">
      {prompt && <p className="notice">{prompt}</p>}
      <form onSubmit={submit}>
        {mode === 'signup' && (
          <label>
            Name
            <input type="text" value={form.name} onChange={set('name')} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={8} />
        </label>
        {error && <p className="notice">{error}</p>}
        <div className="people-actions">
          <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Working' : mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      </form>
    </div>
  );
}
