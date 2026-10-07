'use client';

import type { AdminStats, ThreatCategory } from '@/lib/types';

const CATS: ThreatCategory[] = ['TERRORISM', 'MAN_MADE', 'ILLEGAL_ACTIONS', 'OTHER_THREAT'];

const PERIODS = [7, 14, 30];

function Card({ title, value, accent }: { title: string; value: number; accent?: string }) {
  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 min-w-0">
      <div className="text-xs text-gray-500 truncate">{title}</div>
      <div className={`text-2xl font-bold ${accent ?? ''}`}>{value}</div>
    </div>
  );
}

/** Дашборд ИБ: KPI + категории + посуточная динамика. Без внешних chart-зависимостей — div-бары. */
export default function Dashboard({
  stats,
  days,
  onDays,
  onSelectCategory,
}: {
  stats: AdminStats | null;
  days: number;
  onDays: (d: number) => void;
  onSelectCategory: (c: ThreatCategory) => void;
}) {
  const max = Math.max(1, ...(stats?.perDay.map((d) => d.total) ?? [1]));
  const queued = (stats?.queue.pending ?? 0) + (stats?.queue.inProgress ?? 0);

  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card title="Всего писем" value={stats?.total ?? 0} />
        <Card title="Доставлено" value={stats?.byStatus.DELIVERED ?? 0} accent="text-success" />
        <Card title="Карантин" value={stats?.byStatus.REROUTED ?? 0} accent="text-error" />
        <Card title="Ошибки" value={stats?.byStatus.FAILED ?? 0} accent="text-warning" />
        <Card title="В очереди" value={queued} />
      </div>

      <div className="bg-base-100 rounded-xl shadow px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Категории (клик — фильтр таблицы):</span>
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => onSelectCategory(c)}
              className="badge badge-error badge-outline gap-1 hover:bg-error hover:text-white cursor-pointer py-2.5"
              title={`Показать ${c} в таблице`}
            >
              {c} · <b>{stats?.byCategory[c] ?? 0}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-base-100 rounded-xl shadow px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">Динамика по дням</span>
          <span className="ml-auto flex gap-1">
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
        </div>
        {!stats || stats.perDay.length === 0 ? (
          <div className="text-sm text-gray-400 py-4 text-center">Нет данных за период</div>
        ) : (
          <>
            <div className="flex items-end gap-1 h-32" title="серый — всего, красный — карантин">
              {stats.perDay.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col justify-end h-full min-w-0" title={`${d.date}: всего ${d.total}, карантин ${d.rerouted}`}>
                  <div className="bg-error rounded-t" style={{ height: `${(d.rerouted / max) * 100}%` }} />
                  <div className="bg-base-300 rounded-b" style={{ height: `${((d.total - d.rerouted) / max) * 100}%` }} />
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
          </>
        )}
      </div>
    </div>
  );
}
