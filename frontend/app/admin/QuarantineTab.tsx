'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ApiError, getMessage, listMessages } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AdminStats, MessageDto, MessageStatus, Page, ThreatCategory } from '@/lib/types';
import EngineerDrawer from './EngineerDrawer';
import { CATS, categoryLabel, severityDotClass } from '@/lib/labels';

type Box = 'REROUTED' | 'FORWARDED';
const BOXES: Box[] = ['REROUTED', 'FORWARDED'];

function VerdictBadge({ v }: { v: ThreatCategory | null }) {
  if (!v || v === 'NONE') return <span className="text-sm text-slate-400">Чисто</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-800 whitespace-nowrap">
      <span className={`inline-block w-2 h-2 rounded-full ${severityDotClass(v)}`} aria-hidden />
      {categoryLabel(v)}
    </span>
  );
}

function TableSkeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i}>
          <td colSpan={5} className="px-4 py-2">
            <div className="h-5 rounded bg-white/60 animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );
}

export default function QuarantineTab({
  token,
  stats,
  onStatsRefresh,
  onAuthFail,
  feedSignal,
  openSignal,
  live,
}: {
  token: string;
  stats: AdminStats | null;
  onStatsRefresh: () => void;
  onAuthFail: (e: unknown) => boolean;
  /** +1 на каждую новую угрозу из SSE — мгновенно перезагрузить список. */
  feedSignal: number;
  /** Открыть разбор письма из тоста (id + метка для повторов). */
  openSignal: { id: string; tick: number } | null;
  /** SSE жива — поллинг замедляется до страховки. */
  live: boolean;
}) {
  const [box, setBox] = useState<Box>('REROUTED');
  const [category, setCategory] = useState<'' | ThreatCategory>('');
  const [page, setPage] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<Page<MessageDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MessageDto | null>(null);

  const openRef = useRef<MessageDto | null>(null);
  openRef.current = open;
  const tickBusy = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const d = await listMessages(
        token,
        {
          status: box as MessageStatus,
          ...(category ? { category } : {}),
          page,
          size: 20,
        },
        ctl.signal,
      );
      if (ctl.signal.aborted) return;
      setData(d);
      setError(null);
      const cur = openRef.current;
      if (cur && d.content.some((m) => m.id === cur.id)) {
        try {
          const fresh = await getMessage(token, cur.id, ctl.signal);
          if (!ctl.signal.aborted) setOpen(fresh);
        } catch {
          /* оставляем предыдущий снапшот */
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (onAuthFail(e)) return;
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, box, category, page, reloadToken, onAuthFail]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    // Тот же гард, что у статистики: если таб смонтировался до токена,
    // первая попытка пропускается, повтор — когда токен приехал.
    if (!token) return;
    loadRef.current();
  }, [box, category, page, reloadToken, token]);

  useEffect(() => {
    setPage(0);
    setData(null);
  }, [box, category]);

  useEffect(() => {
    // При живой SSE список и так обновляется по событию — интервал страховка.
    const t = setInterval(() => {
      if (document.hidden || tickBusy.current) return;
      tickBusy.current = true;
      loadRef.current().finally(() => {
        tickBusy.current = false;
      });
    }, live ? 30000 : 10000);
    return () => {
      clearInterval(t);
      abortRef.current?.abort();
    };
  }, [live]);

  const openDetails = async (id: string) => {
    try {
      setOpen(await getMessage(token, id));
    } catch (e) {
      if (onAuthFail(e)) return;
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  };

  // Живая лента: новая угроза — перезагрузить список сразу, не ждать поллинга.
  const lastFeed = useRef(feedSignal);
  useEffect(() => {
    if (feedSignal !== lastFeed.current) {
      lastFeed.current = feedSignal;
      setReloadToken((t) => t + 1);
    }
  }, [feedSignal]);

  // Живая лента: кнопка «Открыть разбор» в тосте.
  const lastOpenKey = useRef<string | null>(null);
  useEffect(() => {
    if (!openSignal) return;
    const key = `${openSignal.id}#${openSignal.tick}`;
    if (key === lastOpenKey.current) return;
    lastOpenKey.current = key;
    openDetails(openSignal.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  const counts = box === 'REROUTED' ? (stats?.byCategoryRerouted ?? {}) : (stats?.byCategoryForwarded ?? {});
  const boxCount = (s: Box) => stats?.byStatus[s] ?? 0;

  const boxIdx = BOXES.indexOf(box);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Ящики со скользящей подложкой */}
        <div className="inline-flex p-1 rounded-full
                        bg-white/40 backdrop-blur-md border border-white/60
                        shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(0,0,0,0.06)]">
          <div
            className="relative inline-grid"
            style={{ gridTemplateColumns: `repeat(${BOXES.length}, minmax(0, 1fr))` }}
          >
            <span
              aria-hidden
              className="absolute top-0 bottom-0 left-0 rounded-full
                         bg-white/95
                         shadow-[0_2px_6px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]
                         transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                width: `calc(100% / ${BOXES.length})`,
                transform: `translateX(${boxIdx * 100}%)`,
              }}
            />

            {BOXES.map((b) => {
              const active = box === b;
              return (
                <button
                  key={b}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setBox(b)}
                  className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-4 py-1.5
                              text-sm whitespace-nowrap
                              transition-colors duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                                active
                                  ? 'text-slate-900 font-medium'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                >
                  <span>{b === 'REROUTED' ? 'В карантине' : 'Отправлено в ИБ'}</span>
                  <span className="font-bold shrink-0">{boxCount(b)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <span className="ml-1 text-xs text-slate-500">клик по категории — фильтр таблицы</span>

        <span className="flex flex-wrap gap-1 ml-auto">
          {CATS.map((c) => {
            const n = counts[c] ?? 0;
            const active = category === c;
            return (
              <button
                key={c}
                onClick={() => setCategory(active ? '' : c)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs
                            transition-all duration-200 ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600 font-medium shadow-[0_2px_6px_rgba(37,99,235,0.30)]'
                                : 'border-white/60 bg-white/40 backdrop-blur-sm hover:bg-white/70 text-slate-700'
                            }`}
                title={active ? `Сбросить фильтр «${categoryLabel(c)}»` : `Показать «${categoryLabel(c)}» в таблице`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-white' : severityDotClass(c)}`} aria-hidden />
                {categoryLabel(c)} · <b>{n}</b>
                {active && <X className="w-3 h-3" />}
              </button>
            );
          })}
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl
                      bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                      border border-white/50
                      shadow-[0_8px_24px_rgba(31,38,135,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-white/50">
              <th className="px-4 py-3 font-bold text-left">Дата/время</th>
              <th className="px-4 py-3 font-bold text-left">От</th>
              <th className="px-4 py-3 font-bold text-left">Кому предназначалось</th>
              <th className="px-4 py-3 font-bold text-left">Тема</th>
              <th className="px-4 py-3 font-bold text-left">Вердикт</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <TableSkeleton />
            ) : data.content.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  {category ? (
                    <span className="inline-flex items-center gap-2">
                      {box === 'REROUTED' ? 'В карантине нет писем категории' : 'В ИБ не отправляли писем категории'}{' '}
                      {categoryLabel(category)}
                      <button
                        onClick={() => setCategory('')}
                        className="px-2 py-1 text-xs transition border rounded-lg bg-white/70 border-white/70 hover:bg-white/90"
                      >
                        Показать всё
                      </button>
                    </span>
                  ) : box === 'REROUTED' ? (
                    'Карантин пуст'
                  ) : (
                    'Безопасникам пока ничего не отправляли'
                  )}
                </td>
              </tr>
            ) : (
              data.content.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => openDetails(m.id)}
                  className="transition border-b cursor-pointer border-white/30 last:border-0 hover:bg-white/50"
                >
                  <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatDateTime(m.createdAt)}</td>
                  <td className="px-4 py-2 truncate max-w-48 text-slate-700">{m.senderEmail}</td>
                  <td className="px-4 py-2 truncate max-w-48 text-slate-700">{m.recipientEmail}</td>
                  <td className="px-4 py-2 truncate max-w-64 text-slate-800">{m.subject || '(без темы)'}</td>
                  <td className="px-4 py-2">
                    <VerdictBadge v={m.verdict} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-600">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm border border-white/70
                     hover:bg-white/90 disabled:opacity-40 transition
                     shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span>
          Стр. {page + 1} из {data?.totalPages ?? 1} (всего {data?.totalElements ?? 0})
        </span>
        <button
          onClick={() => setPage((p) => (data && p + 1 < data.totalPages ? p + 1 : p))}
          disabled={!data || page + 1 >= data.totalPages}
          className="p-1.5 rounded-lg bg-white/60 backdrop-blur-sm border border-white/70
                     hover:bg-white/90 disabled:opacity-40 transition
                     shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => loadRef.current()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                     hover:bg-white/90 transition
                     shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Обновить
        </button>
      </div>

      {open && (
        <EngineerDrawer
          msg={open}
          token={token}
          onClose={() => setOpen(null)}
          onReprocessed={(fresh) => {
            setOpen(fresh);
            setReloadToken((t) => t + 1);
            onStatsRefresh();
          }}
          onResolved={(status) => {
            if (status === 'REROUTED' || status === 'FORWARDED') setBox(status);
            setReloadToken((t) => t + 1);
            onStatsRefresh();
          }}
        />
      )}
    </div>
  );
}