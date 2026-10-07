'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getMessage, listMessages } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AdminStats, MessageDto, MessageStatus, Page, ThreatCategory } from '@/lib/types';
import EngineerDrawer from './EngineerDrawer';
import { CloseIcon } from '@/components/icons';

import { CATS, categoryLabel } from '@/lib/labels';

type Box = 'REROUTED' | 'FORWARDED';

function VerdictBadge({ v }: { v: ThreatCategory | null }) {
  if (!v || v === 'NONE') return <span className="badge badge-ghost">Чисто</span>;
  return <span className="badge badge-error text-white">{categoryLabel(v)}</span>;
}

function TableSkeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i}>
          <td colSpan={5}>
            <div className="h-5 rounded bg-base-200 animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Вкладка «Карантин»: два ящика (в карантине / отправлено в ИБ) + чипы категорий
 * со счётчиками активного ящика + таблица + шторка. Свой polling списка 10с.
 */
export default function QuarantineTab({
  token,
  stats,
  onStatsRefresh,
  onAuthFail,
}: {
  token: string;
  stats: AdminStats | null;
  /** Вызвать после release/forward: статистика обновится следующим тиком. */
  onStatsRefresh: () => void;
  onAuthFail: (e: unknown) => boolean;
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
      // Шторка не должна показывать устаревший снапшот после тихого рефреша.
      const cur = openRef.current;
      if (cur && d.content.some((m) => m.id === cur.id)) {
        try {
          const fresh = await getMessage(token, cur.id, ctl.signal);
          if (!ctl.signal.aborted) setOpen(fresh);
        } catch {
          /* шторка остаётся на старом снапшоте до следующего тика */
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (onAuthFail(e)) return;
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  // reloadToken не читается внутри load — он лишь дёргает эффект ниже через loadRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, box, category, page, reloadToken, onAuthFail]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
  }, [box, category, page, reloadToken]);

  useEffect(() => {
    setPage(0);
    setData(null);
  }, [box, category]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || tickBusy.current) return;
      tickBusy.current = true;
      loadRef.current().finally(() => {
        tickBusy.current = false;
      });
    }, 10000);
    return () => {
      clearInterval(t);
      abortRef.current?.abort();
    };
  }, []);

  const openDetails = async (id: string) => {
    try {
      setOpen(await getMessage(token, id));
    } catch (e) {
      if (onAuthFail(e)) return;
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  };

  const counts = box === 'REROUTED' ? (stats?.byCategoryRerouted ?? {}) : (stats?.byCategoryForwarded ?? {});
  const boxCount = (s: Box) => stats?.byStatus[s] ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="tabs tabs-boxed" role="tablist" aria-label="Ящик">
          {(['REROUTED', 'FORWARDED'] as Box[]).map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={box === b}
              onClick={() => setBox(b)}
              className={`tab ${box === b ? 'tab-active' : ''}`}
            >
              {b === 'REROUTED' ? 'В карантине' : 'Отправлено в ИБ'} · <b>{boxCount(b)}</b>
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 ml-1">клик по категории — фильтр таблицы</span>
        <span className="ml-auto flex gap-1 flex-wrap">
          {CATS.map((c) => {
            const n = counts[c] ?? 0;
            const active = category === c;
            return (
              <button
                key={c}
                onClick={() => setCategory(active ? '' : c)}
                className={`badge gap-1 cursor-pointer ${active ? 'badge-error text-white' : 'badge-outline'}`}
                title={active ? `Сбросить фильтр «${categoryLabel(c)}»` : `Показать «${categoryLabel(c)}» в таблице`}
              >
                {categoryLabel(c)} · <b>{n}</b>
                {active && <span aria-hidden className="inline-flex"><CloseIcon className="w-3 h-3" /></span>}
              </button>
            );
          })}
        </span>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-x-auto bg-base-100 rounded-xl shadow">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Дата/время</th>
              <th>От</th>
              <th>Кому предназначалось</th>
              <th>Тема</th>
              <th>Вердикт</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <TableSkeleton />
            ) : data.content.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-4">
                  {category ? (
                    <span className="inline-flex items-center gap-2">
                      {box === 'REROUTED' ? 'В карантине нет писем категории' : 'В ИБ не отправляли писем категории'}{' '}
                      {categoryLabel(category)}
                      <button onClick={() => setCategory('')} className="btn btn-xs btn-outline">
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
                <tr key={m.id} onClick={() => openDetails(m.id)} className="hover cursor-pointer">
                  <td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
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
      <div className="flex items-center gap-2 text-sm">
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
        <button onClick={() => loadRef.current()} className="btn btn-sm btn-ghost">
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
            // Письмо могло сменить ящик (forward → FORWARDED, release → ушло из SOC):
            // переключаемся за ним; список дотягивается reloadToken.
            if (fresh.status === 'REROUTED' || fresh.status === 'FORWARDED') {
              setCategory('');
              setPage(0);
              setBox(fresh.status);
            }
            setReloadToken((t) => t + 1);
            onStatsRefresh();
          }}
        />
      )}
    </div>
  );
}
