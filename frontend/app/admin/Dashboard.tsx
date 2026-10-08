'use client';

import { useState } from 'react';
import { Activity, CheckCircle2, AlertOctagon, ShieldAlert, XCircle, Clock } from 'lucide-react';
import type { AdminStats, DayBucket } from '@/lib/types';

const PERIODS = [7, 14, 30];

/** Палитра акцентов для метрик. Каждой метрике — свой цвет. */
const ACCENTS = {
  slate: { dot: 'bg-slate-500', text: 'text-slate-700', ring: 'ring-slate-200/60' },
  emerald: { dot: 'bg-emerald-500', text: 'text-emerald-600', ring: 'ring-emerald-200/60' },
  rose: { dot: 'bg-rose-500', text: 'text-rose-600', ring: 'ring-rose-200/60' },
  blue: { dot: 'bg-blue-500', text: 'text-blue-600', ring: 'ring-blue-200/60' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-600', ring: 'ring-amber-200/60' },
  purple: { dot: 'bg-purple-500', text: 'text-purple-600', ring: 'ring-purple-200/60' },
} as const;

type AccentKey = keyof typeof ACCENTS;

function Card({
  title,
  value,
  subtext,
  icon,
  accent,
}: {
  title: string;
  value: number;
  subtext?: string;
  icon?: React.ReactNode;
  accent: AccentKey;
}) {
  const isZero = value === 0;
  const a = ACCENTS[accent];

  return (
    <div
      className={`group relative min-w-0 px-4 py-3 rounded-xl overflow-hidden
                  bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                  border border-white/50
                  shadow-[0_8px_24px_rgba(31,38,135,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]
                  transition-all duration-300 hover:-translate-y-0.5
                  hover:shadow-[0_12px_32px_rgba(31,38,135,0.14),inset_0_1px_0_rgba(255,255,255,0.9)]
                  ${isZero ? 'opacity-55 saturate-0' : ''}`}
    >
      {/* Заголовок: цветной кружок + название + иконка */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center min-w-0 gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${isZero ? 'bg-slate-300' : a.dot}`}
            aria-hidden
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">
            {title}
          </span>
        </div>
        {icon && (
          <span className={`shrink-0 ${isZero ? 'text-slate-300' : 'text-slate-400'}`}>
            {icon}
          </span>
        )}
      </div>

      {/* Сама цифра — здесь включается цвет */}
      <div
        className={`text-2xl font-black tracking-tight transition-colors duration-300 ${
          isZero ? 'text-slate-400' : a.text
        }`}
      >
        {value.toLocaleString('ru-RU')}
      </div>

      {subtext && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{subtext}</div>}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="min-w-0 px-4 py-3 border rounded-xl bg-white/40 backdrop-blur-2xl border-white/50">
      <div className="w-2/3 h-3 rounded bg-slate-200/70 animate-pulse" />
      <div className="w-1/3 h-8 mt-2 rounded bg-slate-200/70 animate-pulse" />
    </div>
  );
}

function formatDayLabel(dateStr: string, totalDays: number, index: number): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (totalDays === 7) {
        return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' });
      }
      if (totalDays === 14) {
        return `${parts[2]}.${parts[1]}`;
      }
      return index % 3 === 0 || index === totalDays - 1 ? `${parts[2]}.${parts[1]}` : '';
    }
  } catch {
    // fallback
  }
  return dateStr.slice(5);
}

function formatTooltipDate(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        weekday: 'short',
      });
    }
  } catch {
    // fallback
  }
  return dateStr;
}

function TrafficDonut({ stats }: { stats: AdminStats }) {
  const delivered = stats.byStatus.DELIVERED ?? 0;
  const forwarded = stats.byStatus.FORWARDED ?? 0;
  const rerouted = stats.byStatus.REROUTED ?? 0;
  const failed = stats.byStatus.FAILED ?? 0;
  const total = stats.total || delivered + forwarded + rerouted + failed || 1;

  const items = [
    { label: 'Доставлено', count: delivered, color: '#10b981', bgClass: 'bg-emerald-500' },
    { label: 'В расследовании', count: forwarded, color: '#3b82f6', bgClass: 'bg-blue-500' },
    { label: 'Карантин', count: rerouted, color: '#ef4444', bgClass: 'bg-red-500' },
    { label: 'Ошибки MTA', count: failed, color: '#f59e0b', bgClass: 'bg-amber-500' },
  ].filter((it) => it.count > 0);

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let offsetAcc = 0;

  return (
    <div className="flex flex-col justify-between h-full">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-white/40">
        <h3 className="text-xs font-bold tracking-wider uppercase text-slate-600">Структура потока</h3>
        <span className="text-[11px] font-mono font-bold text-slate-500">{stats.total} писем</span>
      </div>

      <div className="flex items-center justify-center gap-4 py-2 my-auto">
        <div className="relative flex items-center justify-center w-28 h-28 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(241,245,249,0.6)" strokeWidth="14" />
            {items.map((it, idx) => {
              const segLength = (it.count / total) * circumference;
              const currentOffset = offsetAcc;
              offsetAcc += segLength;
              return (
                <circle
                  key={idx}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={it.color}
                  strokeWidth="14"
                  strokeDasharray={`${segLength} ${circumference}`}
                  strokeDashoffset={-currentOffset}
                  strokeLinecap="round"
                  className="transition-all duration-700 hover:opacity-90"
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg font-black leading-tight text-slate-800">
              {stats.total > 0 ? `${Math.round(((rerouted + forwarded) / stats.total) * 100)}%` : '0%'}
            </span>
            <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Угроз</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-1 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className={`w-2.5 h-2.5 rounded-full ${it.bgClass} shrink-0`} />
                <span className="truncate text-slate-600">{it.label}</span>
              </div>
              <span className="font-mono font-bold text-slate-800 shrink-0">{it.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-white/40 text-[11px] text-slate-400 text-center">
        Соотношение категорий за весь период
      </div>
    </div>
  );
}

export default function Dashboard({
  stats,
  days,
  onDays,
}: {
  stats: AdminStats | null;
  days: number;
  onDays: (d: number) => void;
}) {
  const [hoveredDay, setHoveredDay] = useState<DayBucket | null>(null);

  if (!stats) {
    return (
      <div className="flex flex-col gap-3" aria-label="Загрузка статистики">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="px-6 py-6 border rounded-2xl bg-white/40 backdrop-blur-2xl border-white/50">
          <div className="h-64 rounded-lg bg-slate-200/50 animate-pulse" />
        </div>
      </div>
    );
  }

  const rawMax = Math.max(0, ...stats.perDay.map((d) => d.total));
  const max = rawMax === 0 ? 5 : Math.ceil(rawMax / 4) * 4;
  const queued = stats.queue.pending + stats.queue.inProgress;
  const periodTotal = stats.perDay.reduce((s, d) => s + d.total, 0);
  const periodRerouted = stats.perDay.reduce((s, d) => s + d.rerouted, 0);
  const threatRate = periodTotal > 0 ? ((periodRerouted / periodTotal) * 100).toFixed(1) : '0';
  const avgPerDay = stats.perDay.length > 0 ? Math.round(periodTotal / stats.perDay.length) : 0;

  const yTicks = [max, Math.round((max * 3) / 4), Math.round(max / 2), Math.round(max / 4), 0];

  return (
    <div className="flex flex-col gap-4">
      {/* KPI-карточки: нейтральное стекло + цветной акцент только когда метрика > 0 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card
          title="Всего писем"
          value={stats.total}
          subtext="За все время"
          accent="slate"
          icon={<Activity className="w-4 h-4" />}
        />
        <Card
          title="Доставлено"
          value={stats.byStatus.DELIVERED ?? 0}
          subtext="Чистые письма"
          accent="emerald"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <Card
          title="Карантин"
          value={stats.byStatus.REROUTED ?? 0}
          subtext="Заблокировано"
          accent="rose"
          icon={<AlertOctagon className="w-4 h-4" />}
        />
        <Card
          title="В расследовании"
          value={stats.byStatus.FORWARDED ?? 0}
          subtext="Передано в ИБ"
          accent="blue"
          icon={<ShieldAlert className="w-4 h-4" />}
        />
        <Card
          title="Ошибки MTA"
          value={stats.byStatus.FAILED ?? 0}
          subtext="Сбои доставки"
          accent="amber"
          icon={<XCircle className="w-4 h-4" />}
        />
        <Card
          title="В очереди"
          value={queued}
          subtext="Анализируются"
          accent="purple"
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* График динамики */}
        <div className="relative flex flex-col justify-between p-5 lg:col-span-8 rounded-2xl
                        bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                        border border-white/50
                        shadow-[0_8px_32px_rgba(31,38,135,0.10),inset_0_1px_0_rgba(255,255,255,0.85)]">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-white/40">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-800">Динамика потока сообщений</h2>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-white/70 border border-white/60 text-slate-600">
                    {days} дн.
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>
                    Всего: <b className="text-slate-700">{periodTotal}</b>
                  </span>
                  <span>•</span>
                  <span>
                    Угрозы: <b className="text-rose-600">{periodRerouted}</b> ({threatRate}%)
                  </span>
                  <span>•</span>
                  <span>
                    Среднее: <b className="text-slate-700">{avgPerDay}/д</b>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-emerald-500 to-teal-400 shadow-sm" />
                    <span>Чистые</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-rose-700">
                    <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-rose-500 to-red-600 shadow-sm" />
                    <span>Угрозы</span>
                  </div>
                </div>

                <div className="relative inline-grid p-0.5 rounded-full
                                bg-white/60 backdrop-blur-sm border border-white/60
                                shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                     style={{ gridTemplateColumns: `repeat(${PERIODS.length}, minmax(0, 1fr))` }}>
                  <span
                    aria-hidden
                    className="absolute top-0.5 bottom-0.5 left-0.5 rounded-full
                               bg-white/95 shadow-[0_1px_4px_rgba(0,0,0,0.10)]
                               transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
                    style={{
                      width: `calc((100% - 0.25rem) / ${PERIODS.length})`,
                      transform: `translateX(${PERIODS.indexOf(days) * 100}%)`,
                    }}
                  />
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      onClick={() => onDays(p)}
                      className={`relative z-10 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap
                                  transition-colors duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                                    days === p ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                                  }`}
                    >
                      {p}д
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {hoveredDay && (
              <div className="absolute z-20 flex flex-col gap-1 px-3 py-2 text-xs text-white border rounded-lg shadow-xl pointer-events-none bg-slate-900/95 backdrop-blur-sm border-slate-700">
                <div className="pb-1 font-bold border-b text-slate-200 border-slate-700">
                  {formatTooltipDate(hoveredDay.date)}
                </div>
                <div className="flex justify-between gap-4 text-slate-300">
                  <span>Всего писем:</span>
                  <span className="font-mono font-bold text-white">{hoveredDay.total}</span>
                </div>
                <div className="flex justify-between gap-4 text-rose-300">
                  <span>В карантине:</span>
                  <span className="font-mono font-bold text-rose-400">{hoveredDay.rerouted}</span>
                </div>
                <div className="flex justify-between gap-4 text-emerald-300">
                  <span>Чистых:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {Math.max(0, hoveredDay.total - hoveredDay.rerouted)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2 h-52">
              <div className="flex flex-col justify-between text-[11px] font-mono text-slate-400 text-right w-7 select-none pb-6">
                {yTicks.map((tick, i) => (
                  <span key={i}>{tick}</span>
                ))}
              </div>

              <div className="flex flex-col flex-1 h-full min-w-0">
                <div className="relative flex items-end flex-1">
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {yTicks.map((_, i) => (
                      <div
                        key={i}
                        className={`w-full border-b ${
                          i === yTicks.length - 1 ? 'border-slate-300/70' : 'border-slate-200/40 border-dashed'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="relative z-10 flex items-end w-full h-full gap-1 px-1 sm:gap-2">
                    {stats.perDay.map((d) => {
                      const cleanCount = Math.max(0, d.total - d.rerouted);
                      const cleanPct = max > 0 ? (cleanCount / max) * 100 : 0;
                      const reroutedPct = max > 0 ? (d.rerouted / max) * 100 : 0;
                      const isHovered = hoveredDay?.date === d.date;

                      return (
                        <div
                          key={d.date}
                          onMouseEnter={() => setHoveredDay(d)}
                          onMouseLeave={() => setHoveredDay(null)}
                          className="flex flex-col items-center justify-end flex-1 h-full cursor-pointer group"
                        >
                          <div
                            className={`w-full max-w-[36px] h-full rounded-md flex flex-col justify-end transition-all p-0.5 ${
                              isHovered ? 'bg-white/60 backdrop-blur-sm ring-2 ring-blue-300/60' : 'hover:bg-white/40'
                            }`}
                          >
                            {d.rerouted > 0 && (
                              <div
                                style={{ height: `${reroutedPct}%` }}
                                className="w-full bg-gradient-to-t from-rose-600 to-red-500 rounded-t-sm shadow-sm transition-all duration-300 group-hover:brightness-110 min-h-[3px] border-b border-white/20"
                              />
                            )}

                            {cleanCount > 0 && (
                              <div
                                style={{ height: `${cleanPct}%` }}
                                className={`w-full bg-gradient-to-t from-emerald-500 to-teal-400 shadow-sm transition-all duration-300 group-hover:brightness-110 min-h-[3px] ${
                                  d.rerouted === 0 ? 'rounded-t-sm' : ''
                                }`}
                              />
                            )}

                            {d.total === 0 && (
                              <div className="w-full h-1.5 bg-slate-300/50 rounded-full mx-auto" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center h-5 gap-1 px-1 mt-2 sm:gap-2">
                  {stats.perDay.map((d, i) => (
                    <div
                      key={d.date}
                      className="flex-1 text-center truncate text-[11px] font-medium text-slate-400 select-none"
                    >
                      {formatDayLabel(d.date, days, i)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Круговая диаграмма */}
        <div className="flex flex-col justify-between p-5 lg:col-span-4 rounded-2xl
                        bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                        border border-white/50
                        shadow-[0_8px_32px_rgba(31,38,135,0.10),inset_0_1px_0_rgba(255,255,255,0.85)]">
          <TrafficDonut stats={stats} />
        </div>
      </div>
    </div>
  );
}