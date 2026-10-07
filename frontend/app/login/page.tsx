'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, homeForRole, roleOf, storedRole } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const MAIL_DOMAIN = process.env.NEXT_PUBLIC_MAIL_DOMAIN ?? 'corp-sec.ru';

export default function LoginPage() {
  const { ready, token, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && token) router.replace(homeForRole(roleOf(token)));
  }, [ready, token, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(username.trim().toLowerCase(), password);
      }
      router.replace(homeForRole(storedRole()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-xl shadow p-6 flex flex-col gap-3">
        <h1 className="text-xl font-bold text-blue-700 text-center">СейфМейл</h1>
        <div className="flex rounded-full bg-gray-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-1.5 rounded-full ${mode === 'login' ? 'bg-white shadow font-medium' : 'text-gray-500'}`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-1.5 rounded-full ${mode === 'register' ? 'bg-white shadow font-medium' : 'text-gray-500'}`}
          >
            Регистрация
          </button>
        </div>
        {mode === 'login' ? (
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="электронная почта"
            type="email"
            required
            className="px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
          />
        ) : (
          <>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="логин (латиница, цифры, . _ -)"
              required
              minLength={2}
              className="px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="text-xs text-gray-500">
              Ящик будет создан автоматически: <b>{username || 'логин'}@{MAIL_DOMAIN}</b>
            </div>
          </>
        )}
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'пароль (мин. 6 символов)' : 'пароль'}
          type="password"
          required
          minLength={mode === 'register' ? 6 : undefined}
          className="px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
        />
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '…' : mode === 'login' ? 'Войти' : 'Создать ящик'}
        </button>
      </form>
    </div>
  );
}
