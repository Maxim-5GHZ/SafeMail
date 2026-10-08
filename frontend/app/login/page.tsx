'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
<<<<<<< Updated upstream
import Link from 'next/link';
=======
import { Mail, Lock, User, LogIn, UserPlus } from 'lucide-react';
>>>>>>> Stashed changes
import { useAuth, homeForRole, roleOf, storedRole } from '@/lib/auth';
import { ApiError, getPublicConfig } from '@/lib/api';
import { LogoFull } from '@/components/Logo';
import ShaderBackground from '@/components/ShaderBackground';

const FALLBACK_DOMAIN = process.env.NEXT_PUBLIC_MAIL_DOMAIN ?? '';

export default function LoginPage() {
  const { ready, token, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState(FALLBACK_DOMAIN);

  useEffect(() => {
    if (ready && token) router.replace(homeForRole(roleOf(token)));
  }, [ready, token, router]);

  useEffect(() => {
    let alive = true;
    getPublicConfig()
      .then((c) => {
        if (alive && c.primaryDomain) setDomain(c.primaryDomain);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
<<<<<<< Updated upstream
    <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-xl shadow p-6 flex flex-col gap-3">
=======
    <div className="relative flex items-center justify-center min-h-screen px-4 overflow-hidden">
      <ShaderBackground />

      <div
        className="absolute inset-0 pointer-events-none bg-black/20"
        aria-hidden="true"
      />

      <form
        onSubmit={submit}
        className="relative z-10 w-1/3 p-6 flex flex-col gap-3 rounded-2xl
                   bg-white/30 backdrop-blur-2xl backdrop-saturate-150
                   border border-white/50
                   shadow-[0_8px_32px_rgba(31,38,135,0.12),inset_0_1px_0_rgba(255,255,255,0.85)]"
      >
>>>>>>> Stashed changes
        <div className="flex justify-center">
          <LogoFull />
        </div>

        <div
          className="relative flex w-full rounded-full p-1 text-sm
                     bg-white/40 backdrop-blur-md
                     border border-white/60
                     shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(0,0,0,0.06)]"
        >
          <span
            aria-hidden
            className={`absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full
                        bg-white/95
                        shadow-[0_2px_6px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]
                        transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
                        ${mode === 'login' ? 'translate-x-0' : 'translate-x-full'}`}
          />
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`relative z-10 flex-1 py-1.5 rounded-full
                        transition-colors duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
                        ${mode === 'login'
                          ? 'text-gray-900 font-medium'
                          : 'text-gray-600 hover:text-gray-900'}`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`relative z-10 flex-1 py-1.5 rounded-full
                        transition-colors duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
                        ${mode === 'register'
                          ? 'text-gray-900 font-medium'
                          : 'text-gray-600 hover:text-gray-900'}`}
          >
            Регистрация
          </button>
        </div>

        <div className="grid">
          <div
            aria-hidden={mode !== 'login'}
            className={`col-start-1 row-start-1 transition-opacity duration-300
                        ${mode === 'login' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <div className="relative">
              <Mail className="absolute w-4 h-4 text-gray-500 -translate-y-1/2 pointer-events-none left-3 top-1/2" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="электронная почта"
                type="email"
                required={mode === 'login'}
                tabIndex={mode === 'login' ? 0 : -1}
                className="w-full pl-10 pr-3 py-2 rounded-lg outline-none transition
                           bg-white/60 backdrop-blur-sm
                           border border-white/70
                           placeholder:text-gray-500
                           focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              />
            </div>
          </div>

          <div
            aria-hidden={mode !== 'register'}
            className={`col-start-1 row-start-1 transition-opacity duration-300
                        ${mode === 'register' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <div className="relative">
              <User className="absolute w-4 h-4 text-gray-500 -translate-y-1/2 pointer-events-none left-3 top-1/2" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="логин (латиница, цифры, . _ -)"
                required={mode === 'register'}
                minLength={2}
                tabIndex={mode === 'register' ? 0 : -1}
                className="w-full pl-10 pr-3 py-2 rounded-lg outline-none transition
                           bg-white/60 backdrop-blur-sm
                           border border-white/70
                           placeholder:text-gray-500
                           focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              />
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-700 min-h-[1rem]">
          {mode === 'login' ? (
            <span>Используйте пароль от почтового ящика</span>
          ) : domain ? (
            <>
              Ящик будет создан автоматически:{' '}
              <b>
                {username || 'логин'}@{domain}
              </b>
            </>
          ) : (
            <span>Почтовый домен не настроен — нет ответа от сервера</span>
          )}
        </div>

        <div className="relative">
          <Lock className="absolute w-4 h-4 text-gray-500 -translate-y-1/2 pointer-events-none left-3 top-1/2" />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'пароль (мин. 6 символов)' : 'пароль'}
            type="password"
            required
            minLength={mode === 'register' ? 6 : undefined}
            className="w-full pl-10 pr-3 py-2 rounded-lg outline-none transition
                       bg-white/60 backdrop-blur-sm
                       border border-white/70
                       placeholder:text-gray-500
                       focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          />
        </div>

        {error && (
          <div className="px-3 py-2 text-sm text-red-700 border rounded-lg bg-red-50/80 backdrop-blur-sm border-red-200/60">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-2 py-2
                     bg-blue-600 text-white rounded-lg font-medium
                     hover:bg-blue-700 disabled:opacity-50 transition
                     shadow-[0_2px_8px_rgba(37,99,235,0.30)]"
        >
          {mode === 'login' ? (
            <LogIn className="w-4 h-4" />
          ) : (
            <UserPlus className="w-4 h-4" />
          )}
          {busy ? '…' : mode === 'login' ? 'Войти' : 'Создать ящик'}
        </button>
      </form>
      <Link href="/" className="text-sm text-gray-500 hover:text-blue-600 transition-colors">
        ← Назад к презентации
      </Link>
    </div>
  );
}