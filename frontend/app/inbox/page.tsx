'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, RefreshCw, Paperclip, Star } from 'lucide-react';
import TopBar from '@/components/TopBar';
import Sidebar, { type Folder } from '@/components/Sidebar';
import FullPageLoader from '@/components/FullPageLoader';
import { useAuth } from '@/lib/auth';
import { ApiError, getPublicConfig, listMessages } from '@/lib/api';
import { formatDate, snippet } from '@/lib/format';
import { categoryLabel } from '@/lib/labels';
import { loadRead, loadStarred, markRead, toggleStarred } from '@/lib/marks';
import type { MessageDto, Page } from '@/lib/types';
import ReaderView from './ReaderView';
import ComposeWindow from './ComposeWindow';

const PAGE_SIZE = 20;

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function InboxPage() {
  const { ready, token, email, role, logout } = useAuth();
  const router = useRouter();
  const [folder, setFolder] = useState<Folder>('inbox');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 400);
  const [data, setData] = useState<Page<MessageDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [starred, setStarred] = useState<string[]>([]);
  const [domains, setDomains] = useState<string[]>([]);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  useEffect(() => {
    setReadIds(loadRead());
    setStarred(loadStarred());
    getPublicConfig()
      .then((c) => setDomains((c.allowedDomains || []).map((d) => d.toLowerCase())))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!token || !email) return;
    try {
      const q = debouncedQuery.trim();
      const d = await listMessages(token, {
        ...(folder === 'inbox' ? { recipient: email } : { sender: email }),
        mailbox: folder,
        ...(q ? { query: q } : {}),
        page,
        size: PAGE_SIZE,
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
  }, [token, email, folder, page, debouncedQuery, logout, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    document.title = `${folder === 'inbox' ? 'Входящие' : 'Отправленные'} — СейфМейл`;
  }, [folder]);

  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [folder, debouncedQuery]);

  const open = (id: string) => {
    setReadIds(markRead(id));
    setOpenId(id);
  };

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 3000);
  };

  if (!ready || !token || !email) {
    return <FullPageLoader label="Загрузка почты…" />;
  }

  const totalPages = data?.totalPages ?? 0;
  const range =
    data && data.totalElements > 0
      ? `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + data.content.length} из ${data.totalElements}`
      : '0';

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50 bg-dot-grid">
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 w-[40rem] h-[40rem] rounded-full bg-cyan-300/[0.07] blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-32 w-[42rem] h-[42rem] rounded-full bg-blue-400/[0.06] blur-3xl" />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 50% 30%, rgba(255,255,255,0.55), transparent 70%)',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-noise opacity-[0.025]" />

      <div className="relative z-10 flex flex-col h-full">
        <TopBar
          query={query}
          onQuery={setQuery}
          email={email}
          role={role}
          onLogout={() => {
            logout();
            router.replace('/login');
          }}
        />

        <div className="flex flex-1 min-h-0 gap-3 p-3">
          <Sidebar
            folder={folder}
            onFolder={setFolder}
            onCompose={() => setCompose(true)}
            email={email}
          />

          {openId ? (
            <ReaderView
              id={openId}
              token={token}
              folder={folder}
              onBack={() => setOpenId(null)}
              onChanged={load}
            />
          ) : (
            <div className="flex flex-col flex-1 min-w-0 rounded-2xl overflow-hidden
                            bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                            border border-white/50
                            shadow-[0_8px_32px_rgba(31,38,135,0.10),inset_0_1px_0_rgba(255,255,255,0.85)]">
              {/* Заголовок списка */}
              <div className="flex items-center gap-2 px-4 py-3 text-sm border-b text-slate-500 border-white/50">
                <span className="font-bold text-slate-800">
                  {folder === 'inbox' ? 'Входящие' : 'Отправленные'}
                </span>
                <span className="ml-auto font-mono text-xs">{range}</span>

                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm border border-white/70
                               text-slate-600 hover:bg-white/90 disabled:opacity-40 transition
                               shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                    title="Новее"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage((p) => (totalPages === 0 || p + 1 >= totalPages ? p : p + 1))}
                    disabled={totalPages === 0 || page + 1 >= totalPages}
                    className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm border border-white/70
                               text-slate-600 hover:bg-white/90 disabled:opacity-40 transition
                               shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                    title="Раньше"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={load}
                    className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm border border-white/70
                               text-slate-600 hover:bg-white/90 transition
                               shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                    title="Обновить"
                    aria-label="Обновить"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 mx-4 mt-3 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
                  {error}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {!data ? (
                  <div className="flex flex-col gap-2 p-4" aria-label="Загрузка писем">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-4 h-4 rounded-full bg-white/60" />
                        <div className="h-4 rounded bg-white/60 w-44" />
                        <div className="flex-1 h-4 rounded bg-white/40" />
                        <div className="w-12 h-3 rounded bg-white/40" />
                      </div>
                    ))}
                  </div>
                ) : data.content.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">Писем нет</div>
                ) : (
                  data.content.map((m) => {
                    const unread = !readIds.includes(m.id);
                    const threat = m.verdict != null && m.verdict !== 'NONE';
                    const sentState =
                      folder !== 'sent'
                        ? null
                        : m.status === 'FAILED'
                          ? { text: 'Не доставлено', cls: 'bg-rose-100/80 text-rose-700 border-rose-200/60', title: m.lastError ?? 'Ошибка доставки' }
                          : m.status === 'DELIVERED'
                            ? { text: 'Доставлено', cls: 'bg-emerald-100/80 text-emerald-700 border-emerald-200/60', title: 'Письмо дошло до получателя' }
                            : m.status === 'REROUTED' || m.status === 'FORWARDED'
                              ? { text: 'В карантине', cls: 'bg-rose-100/80 text-rose-700 border-rose-200/60', title: 'Заблокировано шлюзом' }
                              : { text: 'Проверка…', cls: 'bg-amber-100/80 text-amber-700 border-amber-200/60', title: 'Письмо в очереди анализа' };
                    return (
                      <div
                        key={m.id}
                        onClick={() => open(m.id)}
                        className={`flex items-center gap-3 px-4 py-2.5 border-b border-white/30 last:border-0
                                    cursor-pointer transition-colors duration-200
                                    hover:bg-white/50
                                    ${unread ? 'bg-white/30 text-slate-900 font-semibold' : 'text-slate-600'}`}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setStarred(toggleStarred(m.id));
                          }}
                          className={`shrink-0 transition ${
                            starred.includes(m.id)
                              ? 'text-amber-500'
                              : 'text-slate-300 hover:text-amber-400'
                          }`}
                          title={starred.includes(m.id) ? 'Убрать из избранного' : 'В избранное'}
                          aria-label={starred.includes(m.id) ? 'Убрать из избранного' : 'В избранное'}
                        >
                          <Star
                            className="w-4 h-4"
                            fill={starred.includes(m.id) ? 'currentColor' : 'none'}
                          />
                        </button>

                        {threat && (
                          <span
                            className="w-2 h-2 rounded-full bg-rose-500 shrink-0"
                            title={categoryLabel(m.verdict)}
                          />
                        )}

                        <span className="text-sm truncate w-44 shrink-0">
                          {folder === 'inbox' ? m.senderEmail : `→ ${m.recipientEmail}`}
                        </span>

                        <span className="flex-1 text-sm truncate">
                          {m.subject || '(без темы)'}
                          <span className="font-normal text-slate-400">
                            {' '}—{' '}
                            {m.cleanText?.trim()
                              ? snippet(m.cleanText)
                              : m.attachmentCount > 0
                                ? `Вложение: ${m.attachmentCount} шт.`
                                : 'без текста'}
                          </span>
                        </span>

                        {m.attachmentCount > 0 && (
                          <span className="inline-flex text-slate-400 shrink-0" title="Есть вложения">
                            <Paperclip className="w-3.5 h-3.5" />
                          </span>
                        )}

                        {sentState && (
                          <span
                            title={sentState.title}
                            className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 border ${sentState.cls}`}
                          >
                            {sentState.text}
                          </span>
                        )}

                        <span className="font-mono text-xs text-slate-400 shrink-0">
                          {formatDate(m.createdAt)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {compose && (
        <ComposeWindow
          from={email}
          token={token}
          onClose={() => setCompose(false)}
          onSent={(to) => {
            const low = to.toLowerCase();
            const baked = (process.env.NEXT_PUBLIC_MAIL_DOMAIN ?? '').toLowerCase();
            const local =
              domains.length > 0
                ? domains.some((d) => low.endsWith(`@${d}`))
                : baked !== '' && low.endsWith(`@${baked}`);
            flash(local ? 'Принято — идёт проверка шлюза' : 'Письмо отправлено');
            load();
            if (folder !== 'sent') setFolder('sent');
          }}
        />
      )}

      {toast && (
        <div className="fixed z-50 px-4 py-2 text-sm text-white -translate-x-1/2 border rounded-full shadow-xl bottom-6 left-1/2 bg-slate-900/90 backdrop-blur-sm border-white/10">
          {toast}
        </div>
      )}
    </div>
  );
}