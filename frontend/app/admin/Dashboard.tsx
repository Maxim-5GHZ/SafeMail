'use client';

import type { AdminStats, ThreatCategory } from '@/lib/types';

const CATS: ThreatCategory[] = ['TERRORISM', 'MAN_MADE', 'ILLEGAL_ACTIONS', 'OTHER_THREAT'];

const PERIODS = [7, 14, 30];

/** Ненулевой сегмент всегда виден (иначе карантин=1 при max=16 схлопывается в нитку). */
const MIN_SEG_PX = 4;

function Card({ title, value, accent }: { title: string; value: number; accent?: string }) {
  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 min-w-0">
      <div className="text-xs text-gray-500 truncate">{title}</div>
      <div className={`text-2xl font-bold ${accent ?? ''}`}>{value}</div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 min-w-0">
      <div className="h-3 w-2/3 rounded bg-base-300 animate-pulse" />
      <div className="h-8 w-1/3 rounded bg-base-300 animate-pulse mt-2" />
    </div>
  );
}

/** Дашборд ИБ: KPI + категории + посуточная динамика. Без внешних chart-зависимостей — div-бары. */
export default function Dashboard({
  stats,
  days,
  onDays,
  activeCategory,
  onSelectCategory,
}: {
  stats: AdminStats | null;
  days: number;
  onDays: (d: number) => void;
  activeCategory: '' | ThreatCategory;
  onSelectCategory: (c: '' | ThreatCategory) => void;
}) {
  if (!stats) {
    return (
      <div className="flex flex-col gap-3 mb-4" aria-label="Загрузка статистики">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="bg-base-100 rounded-xl shadow px-4 py-3">
          <div className="h-32 rounded bg-base-200 animate-pulse" />
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...stats.perDay.map((d) => d.total));
  const queued = stats.queue.pending + stats.queue.inProgress;
  const periodTotal = stats.perDay.reduce((s, d) => s + d.total, 0);
  const periodRerouted = stats.perDay.reduce((s, d) => s + d.rerouted, 0);
  const mid = Math.round(max / 2);

  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card title="Всего писем" value={stats.total} />
        <Card title="Доставлено" value={stats.byStatus.DELIVERED ?? 0} accent="text-success" />
        <Card title="Карантин" value={stats.byStatus.REROUTED ?? 0} accent="text-error" />
        <Card title="Ошибки" value={stats.byStatus.FAILED ?? 0} accent="text-warning" />
        <Card title="В очереди" value={queued} />
      </div>

      <div className="bg-base-100 rounded-xl shadow px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">
            Карантин по категориям (клик — фильтр таблицы):
          </span>
          {CATS.map((c) => {
            const n = stats.byCategoryRerouted?.[c] ?? 0;
            const active = activeCategory === c;
            return (
              <button
                key={c}
                onClick={() => onSelectCategory(active ? '' : c)}
                className={`badge gap-1 cursor-pointer ${
                  active ? 'badge-error text-white' : 'badge-outline'
                }`}
                title={active ? `Сбросить фильтр ${c}` : `Показать ${c} в таблице`}
              >
                {c} · <b>{n}</b>
                {active && <span aria-hidden>✕</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-base-100 rounded-xl shadow px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">Динамика по дням</span>
          <span className="text-xs text-gray-400">
            · всего {periodTotal}, карантин {periodRerouted} за {days}д
          </span>
          <span className="ml-auto flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-base-300" /> всего
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-error" /> карантин
            </span>
            <span className="flex gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => onDays(p)}
                  className={`btn btn-xs ${days === p ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {p}д
                </button>
              ))}
            </span>
          </span>
        </div>
        {stats.perDay.length === 0 ? (
          <div className="text-sm text-gray-400 py-4 text-center">Нет данных за период</div>
        ) : (
          <div className="flex gap-2">
            <div className="flex flex-col justify-between text-[10px] text-gray-400 h-32 py-0 text-right w-8 shrink-0">
              <span>{max}</span>
              <span>{mid}</span>
              <span>0</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-end gap-1 h-32 border-b border-base-300">
                {stats.perDay.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col justify-end h-full min-w-0"
                    title={`${d.date}: всего ${d.total}, карантин ${d.rerouted}`}
                  >
                    <div
                      className="bg-error rounded-t"
                      style={{
                        height: `${(d.rerouted / max) * 100}%`,
                        minHeight: d.rerouted > 0 ? MIN_SEG_PX : 0,
                      }}
                    />
                    <div
                      className="bg-base-300 rounded-b"
                      style={{
                        height: `${((d.total - d.rerouted) / max) * 100}%`,
                        minHeight: d.total - d.rerouted > 0 ? MIN_SEG_PX : 0,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1 text-[10px] text-gray-400">
                {stats.perDay.map((d, i) => (
                  <div key={d.date} className="flex-1 truncate text-center">
                    {i === 0 || i === stats.perDay.length - 1 ? d.date.slice(5) : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
