'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { login as apiLogin, register as apiRegister } from './api';

const TOKEN_KEY = 'sm_token';

interface JwtPayload {
  sub?: string;
  role?: string;
  exp?: number;
}

function decodePayload(token: string): JwtPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

interface AuthCtx {
  ready: boolean;
  token: string | null;
  email: string | null;
  role: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  ready: false,
  token: null,
  email: null,
  role: null,
  login: async () => {},
  register: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      const p = decodePayload(t);
      if (!p || (p.exp && p.exp * 1000 < Date.now())) {
        localStorage.removeItem(TOKEN_KEY);
      } else {
        setToken(t);
      }
    }
    setReady(true);
  }, []);

  const apply = useCallback((t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await apiLogin(email, password);
      apply(r.token);
    },
    [apply],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      const r = await apiRegister(username, password);
      apply(r.token);
    },
    [apply],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  const payload = token ? decodePayload(token) : null;
  return (
    <Ctx.Provider
      value={{
        ready,
        token,
        email: payload?.sub ?? null,
        role: payload?.role ?? null,
        login,
        register,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}

/** Роль из JWT без запроса к бэку (для роль-based редиректов). */
export function roleOf(token: string | null): string | null {
  if (!token) return null;
  return decodePayload(token)?.role ?? null;
}

/** Роль из сохранённого токена (для редиректа сразу после login/register). */
export function storedRole(): string | null {
  try {
    return roleOf(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

/** Куда вести пользователя после входа: админа — сразу в SOC. */
export function homeForRole(role: string | null): string {
  return role === 'ADMIN' ? '/admin' : '/inbox';
}
