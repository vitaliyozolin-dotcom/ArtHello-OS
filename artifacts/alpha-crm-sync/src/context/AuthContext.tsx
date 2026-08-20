import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface AuthUser {
  role: 'owner' | 'accountant' | 'viewer';
  name: string;
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (loginStr: string, password: string) => Promise<string | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => 'Not implemented',
  changePassword: async () => 'Not implemented',
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const verifySession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return false;
      const data = await res.json() as AuthUser;
      setUser({ role: data.role, name: data.name, mustChangePassword: Boolean(data.mustChangePassword) });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    verifySession().finally(() => setLoading(false));
  }, [verifySession]);

  const login = async (loginStr: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginStr, password }),
      });
      const data = await res.json() as Partial<AuthUser> & { error?: string };
      if (!res.ok) return data.error ?? 'Ошибка входа';
      setUser({ role: data.role!, name: data.name!, mustChangePassword: Boolean(data.mustChangePassword) });
      return null;
    } catch { return 'Ошибка сети'; }
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<string | null> => {
    try {
      const csrfToken = readCsrfCookie();
      if (!csrfToken) return 'Защитная сессия устарела. Войдите заново.';
      const res = await fetch('/api/auth/password', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) return data.error ?? 'Не удалось изменить пароль';
      setUser(null);
      return null;
    } catch { return 'Ошибка сети'; }
  };

  const logout = () => {
    const csrfToken = readCsrfCookie();
    fetch('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin',
      headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    }).catch(() => null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, changePassword, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const name of ['__Host-arthello_csrf', 'arthello_csrf']) {
    const prefix = `${name}=`;
    const match = document.cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(prefix));
    if (match) return decodeURIComponent(match.slice(prefix.length));
  }
  return null;
}
