import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getMe,
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
  upgradeAccount,
  deleteAccount as apiDeleteAccount,
} from './api.js';
import { supabase, SUPABASE_ENABLED } from './supabase.js';

const AuthContext = createContext(null);

// One hook, two backends. With Supabase configured, signing in and up happen
// against Supabase and the server just recognizes the token; otherwise the
// server's own cookie login is used. Components can't tell which.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const { user } = await getMe();
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (!SUPABASE_ENABLED) {
      loadMe().finally(() => setLoading(false));
      return undefined;
    }
    // Supabase keeps the session itself; whenever it changes, ask the server
    // who that is in its own terms (name, guest or not).
    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) await loadMe();
      else setUser(null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, [loadMe]);

  const login = useCallback(
    async (email, password) => {
      if (!SUPABASE_ENABLED) {
        const { user } = await apiLogin({ email, password });
        setUser(user);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      await loadMe();
    },
    [loadMe]
  );

  const signup = useCallback(
    async (name, email, password, { redirectTo } = {}) => {
      if (!SUPABASE_ENABLED) {
        const { user } = await apiSignup({ name, email, password });
        setUser(user);
        return;
      }
      // With email confirmation on, the link in the email opens redirectTo
      // (the invite page, when that's where they started) already signed in.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: redirectTo },
      });
      if (error) throw new Error(error.message);
      // With email confirmation on in Supabase there's no session yet.
      if (!data.session) throw new Error('Check your email to confirm your account, then sign in.');
      await loadMe();
    },
    [loadMe]
  );

  const logout = useCallback(async () => {
    if (SUPABASE_ENABLED) await supabase.auth.signOut();
    else await apiLogout();
    setUser(null);
  }, []);

  // Turns a guest (joined via an invite link, no password) into a real
  // account with the same id, plans and history.
  const upgrade = useCallback(
    async (email, password) => {
      if (!SUPABASE_ENABLED) {
        const { user } = await upgradeAccount({ email, password });
        setUser((prev) => ({ ...prev, ...user, isGuest: false }));
        return;
      }
      const { error } = await supabase.auth.updateUser({ email, password });
      if (error) throw new Error(error.message);
      await supabase.auth.refreshSession();
      await loadMe();
    },
    [loadMe]
  );

  const deleteAccount = useCallback(async () => {
    await apiDeleteAccount();
    if (SUPABASE_ENABLED) await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, upgrade, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
