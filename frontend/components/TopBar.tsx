'use client';

import { Search, LogOut, ShieldCheck } from 'lucide-react';
import { LogoMark } from './Logo';

interface Props {
  query: string;
  onQuery: (q: string) => void;
  email: string | null;
  role: string | null;
  onLogout: () => void;
}

export default function TopBar({ query, onQuery, email, role, onLogout }: Props) {
  return (
    <header
      className="sticky top-0 z-20 px-4 py-3
                 bg-white/25 backdrop-blur-3xl backdrop-saturate-150
                 border-b border-white/60
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_16px_rgba(31,38,135,0.06)]"
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <LogoMark className="w-7 h-7" />
          <span className="text-lg font-bold text-slate-800">СейфМейл</span>
        </div>

        <div className="relative flex-1 max-w-2xl">
          <Search
            className="absolute w-4 h-4 -translate-y-1/2 pointer-events-none left-3 top-1/2 text-slate-400"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Поиск: тема, текст, отправитель…"
            className="w-full rounded-full py-2 pl-10 pr-4 text-sm outline-none transition
                       bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800
                       placeholder:text-slate-400
                       focus:bg-white/90 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {role === 'ADMIN' && (
            <a
              href="/admin"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                         bg-rose-100/80 text-rose-700 border border-rose-200/60
                         hover:bg-rose-200/90 transition
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              title="Пульт информационной безопасности"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Пульт ИБ</span>
            </a>
          )}

          {email && (
            <span
              className="hidden sm:inline text-xs text-slate-500 font-mono truncate max-w-[16rem]"
              title={email}
            >
              {email}
            </span>
          )}

          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                       bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                       hover:bg-white/90 transition
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
            title="Выйти"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Выйти</span>
          </button>
        </div>
      </div>
    </header>
  );
}