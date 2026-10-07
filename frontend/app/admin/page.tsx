'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError, getAdminStats } from '@/lib/api';
import type { AdminStats } from '@/lib/types';
import Dashboard from './Dashboard';
import QuarantineTab from './QuarantineTab';
import Stopwords from './Stopwords';
import OfficerAddresses from './OfficerAddresses';

type Tab = 'quarantine' | 'overview' | 'settings';

/** SOC из трёх вкладок: работа (карантин) / картина (обзор) / конфигурация (настройки). */
export default function AdminPage() {
  const { ready, token, role, logout } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('quarantine');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  const tickBusy = useRef(false);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  /** true, если это протухшая сессия (вызывающий код дальше ничего не делает). */
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

  useEffect(() => {
    statsRef.current();
  }, [days]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || tickBusy.current) return;
      tickBusy.current = true;
      statsRef.current().finally(() => {
        tickBusy.current = false;
      });
    }, 10000);
    return () => clearInterval(t);
  }, []);

  if (!ready || !token) return <div className="p-8">Загрузка…</div>;

  if (role !== 'ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="alert alert-error max-w-md">
          <span>403 — раздел только для ИБ (роль ADMIN).</span>
          <a href="/inbox" className="link link-hover">
            В inbox
          </a>
        </div>
      </div>
    );
  }

  const quarantineCount = stats?.byStatus?.REROUTED ?? 0;

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 border-b">
        <span className="font-bold text-lg text-error px-4">SafeMail · SOC</span>
        <span className="ml-auto flex items-center gap-3 px-4 text-sm">
          <a href="/inbox" className="link link-hover">
            Inbox
          </a>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="link link-hover"
          >
            Выйти
          </button>
        </span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div className="tabs tabs-boxed bg-base-100 shadow self-start" role="tablist" aria-label="Разделы SOC">
          <button role="tab" aria-selected={tab === 'quarantine'} onClick={() => setTab('quarantine')} className={`tab ${tab === 'quarantine' ? 'tab-active' : ''}`}>
            🚨 Карантин{stats && ` · ${quarantineCount}`}
          </button>
          <button role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')} className={`tab ${tab === 'overview' ? 'tab-active' : ''}`}>
            📊 Обзор
          </button>
          <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')} className={`tab ${tab === 'settings' ? 'tab-active' : ''}`}>
            ⚙️ Настройки
          </button>
        </div>

        {statsError && (
          <div className="alert alert-warning">
            <span>Статистика недоступна: {statsError}</span>
          </div>
        )}

        {tab === 'quarantine' && (
          <QuarantineTab
            token={token}
            stats={stats}
            onStatsRefresh={() => statsRef.current()}
            onAuthFail={onAuthFail}
          />
        )}

        {tab === 'overview' && <Dashboard stats={stats} days={days} onDays={setDays} />}

        {tab === 'settings' && (
          <div className="flex flex-col gap-3">
            <Stopwords token={token} />
            <OfficerAddresses token={token} />
          </div>
        )}
      </div>
    </div>
  );
}
