import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getMe, login as apiLogin, signup as apiSignup, logout as apiLogout, upgradeAccount } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { user } = await apiLogin({ email, password });
    setUser(user);
  }, []);

  const signup = useCallback(async (name, email, password) => {
    const { user } = await apiSignup({ name, email, password });
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  // Turns a guest (joined via a plan's invite link, no password) into a
  // real account — same id, same plans/history, just adds a real login.
  const upgrade = useCallback(async (email, password) => {
    const { user } = await upgradeAccount({ email, password });
    setUser((prev) => ({ ...prev, ...user, isGuest: false }));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, upgrade }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
