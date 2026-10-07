'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError, getAdminStats, getMessage, listMessages } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { AdminStats, MessageDto, Page, ThreatCategory } from '@/lib/types';
import EngineerDrawer from './EngineerDrawer';
import Dashboard from './Dashboard';
import Stopwords from './Stopwords';

const CATS: ThreatCategory[] = ['TERRORISM', 'MAN_MADE', 'ILLEGAL_ACTIONS', 'OTHER_THREAT'];

function VerdictBadge({ v }: { v: ThreatCategory | null }) {
  if (!v || v === 'NONE') return <span className="badge badge-ghost">NONE</span>;
  return <span className="badge badge-error text-white">{v}</span>;
}

export default function AdminPage() {
  const { ready, token, role, logout } = useAuth();
  const router = useRouter();
  const [category, setCategory] = useState<'' | ThreatCategory>('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<MessageDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MessageDto | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await listMessages(token, {
        status: 'REROUTED',
        ...(category ? { category } : {}),
        page,
        size: 20,
      });
      setData(d);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        router.replace('/login');
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  }, [token, category, page, logout, router]);

  useEffect(() => {
    load();
  }, [load]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      setStats(await getAdminStats(token, days));
      setStatsError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        router.replace('/login');
        return;
      }
      setStatsError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  }, [token, days, logout, router]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    const t = setInterval(() => {
      load();
      loadStats();
    }, 10000);
    return () => clearInterval(t);
  }, [load, loadStats]);

  useEffect(() => {
    setPage(0);
  }, [category]);

  const openDetails = async (id: string) => {
    if (!token) return;
    try {
      setOpen(await getMessage(token, id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  };

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

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 border-b">
        <span className="font-bold text-lg text-error px-4">SafeMail · SOC</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as '' | ThreatCategory)}
          className="select select-bordered select-sm ml-4"
        >
          <option value="">Все категории</option>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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

      <div className="p-4">
        <Dashboard
          stats={stats}
          days={days}
          onDays={setDays}
          onSelectCategory={(c) => {
            setCategory(c);
            setPage(0);
          }}
        />
        {statsError && (
          <div className="alert alert-warning mb-3">
            <span>Статистика недоступна: {statsError}</span>
          </div>
        )}
        {token && <Stopwords token={token} />}
        {error && (
          <div className="alert alert-error mb-3">
            <span>{error}</span>
          </div>
        )}
        <div className="overflow-x-auto bg-base-100 rounded-xl shadow">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Дата</th>
                <th>От</th>
                <th>Кому предназначалось</th>
                <th>Тема</th>
                <th>Вердикт</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400">
                    Загрузка…
                  </td>
                </tr>
              ) : data.content.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400">
                    Карантин пуст
                  </td>
                </tr>
              ) : (
                data.content.map((m) => (
                  <tr key={m.id} onClick={() => openDetails(m.id)} className="hover cursor-pointer">
                    <td className="whitespace-nowrap">{formatDate(m.createdAt)}</td>
                    <td className="max-w-48 truncate">{m.senderEmail}</td>
                    <td className="max-w-48 truncate">{m.recipientEmail}</td>
                    <td className="max-w-64 truncate">{m.subject || '(без темы)'}</td>
                    <td>
                      <VerdictBadge v={m.verdict} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-3 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn btn-sm"
          >
            ‹
          </button>
          <span>
            Стр. {page + 1} из {data?.totalPages ?? 1} (всего {data?.totalElements ?? 0})
          </span>
          <button
            onClick={() => setPage((p) => (data && p + 1 < data.totalPages ? p + 1 : p))}
            disabled={!data || page + 1 >= data.totalPages}
            className="btn btn-sm"
          >
            ›
          </button>
          <button onClick={load} className="btn btn-sm btn-ghost">
            ⟳ Обновить
          </button>
        </div>
      </div>

      {open && token && (
        <EngineerDrawer
          msg={open}
          token={token}
          onClose={() => setOpen(null)}
          onReprocessed={(fresh) => {
            setOpen(fresh);
            load();
          }}
        />
      )}
    </div>
  );
}
