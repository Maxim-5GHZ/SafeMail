'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, ShieldAlert, Settings as SettingsIcon, Inbox, LogOut, Bell } from 'lucide-react';
import FullPageLoader from '@/components/FullPageLoader';
import ThreatToasts, { type ToastItem } from '@/components/ThreatToasts';
import { useThreatFeed, type ThreatPing } from '@/lib/threatFeed';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/lib/auth';
import { ApiError, getAdminStats } from '@/lib/api';
import type { AdminStats } from '@/lib/types';
import Dashboard from './Dashboard';
import QuarantineTab from './QuarantineTab';
import DomainSettings from './DomainSettings';
import Stopwords from './Stopwords';
import OfficerAddresses from './OfficerAddresses';

type Tab = 'quarantine' | 'overview' | 'settings';

export default function AdminPage() {
  const { ready, token, role, logout } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('quarantine');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  // Живая лента угроз (SSE): тосты, счётчик непрочитанных, сигналы для
  // мгновенного обновления карантина и открытия разбора из тоста.
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [feedSignal, setFeedSignal] = useState(0);
  const [openSignal, setOpenSignal] = useState<{ id: string; tick: number } | null>(null);
  const toastKey = useRef(0);
  const dismissTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const tickBusy = useRef(false);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const onAuthFail = useCallback(
    (e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return true;
      if (e instanceof ApiError && e.status === 401) {
        logout();
        router.replace('/login');
        return true;
      }
      return false;
    },
    [logout, router],
  );

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      setStats(await getAdminStats(token, days));
      setStatsError(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof ApiError && e.status === 401) {
        logout();
        router.replace('/login');
        return;
      }
      setStatsError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  }, [token, days, logout, router]);

  const statsRef = useRef(loadStats);
  statsRef.current = loadStats;

  const dismissToast = useCallback((key: number) => {
    const timer = dismissTimers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.current.delete(key);
    }
    setToasts((prev) => prev.map((t) => (t.key === key ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.key !== key)), 320);
  }, []);

  const pushToast = useCallback(
    (t: ThreatPing) => {
      const key = ++toastKey.current;
      setToasts((prev) => [...prev.slice(-3), { ...t, key }]);
      setUnread((u) => u + 1);
      setFeedSignal((s) => s + 1);
      statsRef.current();
      dismissTimers.current.set(key, setTimeout(() => dismissToast(key), 8000));
    },
    [dismissToast],
  );

  // SSE-лента подключается только при живом токене; без токена — тихо выкл.
  const live = useThreatFeed(token, pushToast);

  useEffect(() => {
    const left = Array.from(dismissTimers.current.values());
    return () => left.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    statsRef.current();
  }, [days]);

  useEffect(() => {
    // При живой SSE статистика и так обновляется по каждому событию —
    // интервал остаётся редкой страховкой; без SSE — основной механизм.
    const t = setInterval(() => {
      if (document.hidden || tickBusy.current) return;
      tickBusy.current = true;
      statsRef.current().finally(() => {
        tickBusy.current = false;
      });
    }, live ? 30000 : 10000);
    return () => clearInterval(t);
  }, [live]);

  if (!ready || !token) {
    return <FullPageLoader label="Проверка доступа…" />;
  }

  if (role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-screen px-4 bg-gradient-to-br from-slate-50 via-white to-sky-50 bg-dot-grid">
        <div className="max-w-md p-6 rounded-2xl
                        bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                        border border-white/50
                        shadow-[0_8px_32px_rgba(31,38,135,0.12),inset_0_1px_0_rgba(255,255,255,0.85)]">
          <div className="px-3 py-2 mb-3 text-sm border rounded-lg text-rose-700 bg-rose-50/70 border-rose-200/60">
            403 — раздел только для ИБ (нужна роль администратора).
          </div>
          <a
            href="/inbox"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium
                       bg-white/70 backdrop-blur-sm border border-white/70
                       hover:bg-white/90 transition
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.05)]"
          >
            <Inbox className="w-4 h-4" />
            Во входящие
          </a>
        </div>
      </div>
    );
  }

  const quarantineCount = stats?.byStatus?.REROUTED ?? 0;

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'quarantine', label: 'Карантин', icon: <ShieldAlert className="w-4 h-4" />, badge: stats ? quarantineCount : undefined },
    { id: 'overview', label: 'Обзор', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'settings', label: 'Настройки', icon: <SettingsIcon className="w-4 h-4" /> },
  ];
  const activeIdx = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50 bg-dot-grid">

      {/* ─── Декоративные слои ─────────────────────────────────────────── */}

      {/* 1. Очень слабые цветные пятна — почти невидимые, только тёплые акценты по краям */}
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 w-[40rem] h-[40rem] rounded-full bg-cyan-300/[0.07] blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-32 w-[42rem] h-[42rem] rounded-full bg-blue-400/[0.06] blur-3xl" />

      {/* 2. Радиальный «свет» в центре рабочей области — мягко подсвечивает контент */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 50% 30%, rgba(255,255,255,0.55), transparent 70%)',
        }}
      />

      {/* 3. Мягкое свечение под шапкой — глубина и «отрыв» хедера от контента */}
      <div aria-hidden className="absolute top-0 left-0 right-0 h-32 pointer-events-none bg-gradient-to-b from-white/55 to-transparent" />

      {/* 4. Тонкая белая линия на самом верху — эффект «блика» шапки */}
      <div aria-hidden className="absolute top-0 left-0 right-0 h-px pointer-events-none bg-gradient-to-r from-transparent via-white/90 to-transparent" />

      {/* 5. Едва заметный шум — «плёнка», убирает ощущение плоского градиента */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-noise opacity-[0.025]" />

      {/* ─── Контент ───────────────────────────────────────────────────── */}

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Стеклянная шапка */}
        <header className="sticky top-0 z-20 px-4 py-3
                           bg-white/25 backdrop-blur-3xl backdrop-saturate-150
                           border-b border-white/60
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_16px_rgba(31,38,135,0.06)]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-lg font-bold text-slate-800">
              <LogoMark className="w-7 h-7" />
              СейфМейл · Пульт ИБ
            </span>
            <span className="flex items-center gap-2 ml-auto">
              <span
                title={live ? 'Живая лента угроз подключена' : 'Живая лента недоступна — работает опрос'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold
                            border backdrop-blur-sm ${
                              live
                                ? 'bg-emerald-50/70 border-emerald-200/60 text-emerald-700'
                                : 'bg-white/60 border-white/70 text-slate-500'
                            }`}
              >
                <span
                  aria-hidden
                  className={`inline-block w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500 severity-ping' : 'bg-slate-400'}`}
                />
                {live ? 'LIVE' : 'опрос'}
              </span>
              <button
                onClick={() => {
                  setUnread(0);
                  setTab('quarantine');
                }}
                title="Непрочитанные угрозы"
                aria-label="Непрочитанные угрозы"
                className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                           bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                           hover:bg-white/90 transition
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              >
                <Bell className="w-3.5 h-3.5" />
                {unread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] font-bold leading-none bg-rose-500 text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
              <a
                href="/inbox"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                           bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                           hover:bg-white/90 transition
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              >
                <Inbox className="w-3.5 h-3.5" />
                Входящие
              </a>
              <button
                onClick={() => {
                  logout();
                  router.replace('/login');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                           bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                           hover:bg-white/90 transition
                           shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              >
                <LogOut className="w-3.5 h-3.5" />
                Выйти
              </button>
            </span>
          </div>
        </header>

        <div className="flex flex-col flex-1 gap-3 p-4">
          {/* Переключатель вкладок со скользящей подложкой */}
          <div className="self-start inline-flex p-1 rounded-full
                          bg-white/40 backdrop-blur-md border border-white/60
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(0,0,0,0.06)]">
            <div
              className="relative inline-grid"
              style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
            >
              <span
                aria-hidden
                className="absolute top-0 bottom-0 left-0 rounded-full
                           bg-white/95
                           shadow-[0_2px_6px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]
                           transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{
                  width: `calc(100% / ${TABS.length})`,
                  transform: `translateX(${activeIdx * 100}%)`,
                }}
              />

              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.id)}
                    className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-4 py-1.5
                                text-sm whitespace-nowrap
                                transition-colors duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                                  active
                                    ? 'text-slate-900 font-medium'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                  >
                    <span className="inline-flex shrink-0" aria-hidden>{t.icon}</span>
                    <span>{t.label}</span>
                    {typeof t.badge === 'number' && t.badge > 0 && (
                      <span
                        className={`shrink-0 inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] font-bold leading-none ${
                          active ? 'bg-rose-100 text-rose-700' : 'bg-rose-500 text-white'
                        }`}
                      >
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {statsError && (
            <div className="px-3 py-2 text-sm border rounded-lg bg-amber-50/80 backdrop-blur-sm border-amber-200/60 text-amber-800">
              Статистика недоступна: {statsError}
            </div>
          )}

          {tab === 'quarantine' && (
            <QuarantineTab
              token={token}
              stats={stats}
              onStatsRefresh={() => statsRef.current()}
              onAuthFail={onAuthFail}
              feedSignal={feedSignal}
              openSignal={openSignal}
              live={live}
            />
          )}

          {tab === 'overview' && <Dashboard stats={stats} days={days} onDays={setDays} />}

          {tab === 'settings' && (
            <div className="flex flex-col gap-3">
              <DomainSettings token={token} />
              <Stopwords token={token} />
              <OfficerAddresses token={token} />
            </div>
          )}
        </div>

        <ThreatToasts
          items={toasts}
          onOpen={(id) => {
            setTab('quarantine');
            setOpenSignal({ id, tick: Date.now() });
          }}
          onDismiss={dismissToast}
        />
      </div>
    </div>
  );
}