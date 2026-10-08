'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import Sidebar, { type Folder } from '@/components/Sidebar';
import { useAuth } from '@/lib/auth';
import { ApiError, getPublicConfig, listMessages } from '@/lib/api';
import { formatDate, snippet } from '@/lib/format';
import { categoryLabel } from '@/lib/labels';
import { loadRead, loadStarred, markRead, toggleStarred } from '@/lib/marks';
import { StarIcon, ClipIcon, RefreshIcon } from '@/components/icons';
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
  /** Живые домены шлюза (алиасы): тост после отправки зависит от того, свой ли получатель. */
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

  // Polling новых писем; открытое письмо и страница не сбрасываются.
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

  if (!ready || !token || !email) return <div className="p-8 text-gray-400">Загрузка…</div>;

  const totalPages = data?.totalPages ?? 0;
  const range =
    data && data.totalElements > 0
      ? `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + data.content.length} из ${data.totalElements}`
      : '0';

  return (
    <div className="h-screen flex flex-col">
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
      <div className="flex-1 flex min-h-0">
        <Sidebar folder={folder} onFolder={setFolder} onCompose={() => setCompose(true)} email={email} />
        {openId ? (
          <ReaderView id={openId} token={token} folder={folder} onBack={() => setOpenId(null)} onChanged={load} />
        ) : (
          <div className="flex-1 bg-white flex flex-col min-w-0">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 text-sm text-gray-500">
              <span className="font-medium text-gray-800">{folder === 'inbox' ? 'Входящие' : 'Отправленные'}</span>
              <span className="ml-auto">{range}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
                title="Новее"
              >
                ‹
              </button>
              <button
                onClick={() => setPage((p) => (totalPages === 0 || p + 1 >= totalPages ? p : p + 1))}
                disabled={totalPages === 0 || page + 1 >= totalPages}
                className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
                title="Раньше"
              >
                ›
              </button>
              <button onClick={load} className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 inline-flex items-center" title="Обновить" aria-label="Обновить">
                <RefreshIcon className="w-4 h-4" />
              </button>
            </div>
            {error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex-1 overflow-y-auto">
              {!data ? (
                <div className="flex flex-col gap-2 p-4" aria-label="Загрузка писем">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-4 h-4 rounded-full bg-gray-200" />
                      <div className="w-44 h-4 rounded bg-gray-200" />
                      <div className="flex-1 h-4 rounded bg-gray-100" />
                      <div className="w-12 h-3 rounded bg-gray-100" />
                    </div>
                  ))}
                </div>
              ) : data.content.length === 0 ? (
                <div className="p-8 text-gray-400 text-center">Писем нет</div>
              ) : (
                data.content.map((m) => {
                  const unread = !readIds.includes(m.id);
                  const threat = m.verdict != null && m.verdict !== 'NONE';
                  const sentState =
                    folder !== 'sent'
                      ? null
                      : m.status === 'FAILED'
                        ? { text: 'Не доставлено', cls: 'bg-red-100 text-red-700', title: m.lastError ?? 'Ошибка доставки' }
                        : m.status === 'DELIVERED'
                          ? { text: 'Доставлено', cls: 'bg-green-100 text-green-700', title: 'Письмо дошло до получателя' }
                          : m.status === 'REROUTED' || m.status === 'FORWARDED'
                            ? { text: 'В карантине', cls: 'bg-red-100 text-red-700', title: 'Заблокировано шлюзом' }
                            : { text: 'Проверка…', cls: 'bg-amber-100 text-amber-700', title: 'Письмо в очереди анализа' };
                  return (
                    <div
                      key={m.id}
                      onClick={() => open(m.id)}
                      className={`msg-row ${unread ? 'unread' : 'text-gray-600'}`}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStarred(toggleStarred(m.id));
                        }}
                        className={`${starred.includes(m.id) ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
                        title={starred.includes(m.id) ? 'Убрать из избранного' : 'В избранное'}
                        aria-label={starred.includes(m.id) ? 'Убрать из избранного' : 'В избранное'}
                      >
                        <StarIcon filled={starred.includes(m.id)} />
                      </button>
                      {threat && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title={categoryLabel(m.verdict)} />}
                      <span className="w-44 shrink-0 truncate text-sm">
                        {folder === 'inbox' ? m.senderEmail : `→ ${m.recipientEmail}`}
                      </span>
                      <span className="flex-1 truncate text-sm">
                        {m.subject || '(без темы)'}
                        <span className="font-normal text-gray-400">
                          {' '}—{' '}
                          {m.cleanText?.trim()
                            ? snippet(m.cleanText)
                            : m.attachmentCount > 0
                              ? `Вложение: ${m.attachmentCount} шт.`
                              : 'без текста'}
                        </span>
                      </span>
                      {m.attachmentCount > 0 && <span title="Есть вложения" className="inline-flex text-gray-400"><ClipIcon /></span>}
                      {sentState && (
                        <span title={sentState.title} className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${sentState.cls}`}>
                          {sentState.text}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 shrink-0">{formatDate(m.createdAt)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
      {compose && (
        <ComposeWindow
          from={email}
          token={token}
          onClose={() => setCompose(false)}
          onSent={(to) => {
            // Своему домену: 202 — лишь приём в пайплайн, вердикт будет позже.
            // Наружу: 202 — relay принял синхронно.
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
