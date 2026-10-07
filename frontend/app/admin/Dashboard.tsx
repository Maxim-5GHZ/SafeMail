// frontend/app/admin/Dashboard.tsx
'use client';

import { useState } from 'react';
import type { AdminStats, DayBucket } from '@/lib/types';

const PERIODS = [7, 14, 30];

function Card({
  title,
  value,
  subtext,
  top,
  badgeBg,
}: {
  title: string;
  value: number;
  subtext?: string;
  top?: string;
  badgeBg?: string;
}) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-slate-200/80 px-4 py-3 min-w-0 border-t-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${
        top ?? 'border-t-slate-400'
      }`}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">
          {title}
        </span>
        {badgeBg && <span className={`w-2 h-2 rounded-full ${badgeBg}`} />}
      </div>
      <div className="text-2xl font-black text-slate-800 tracking-tight">{value.toLocaleString('ru-RU')}</div>
      {subtext && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{subtext}</div>}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-3 min-w-0">
      <div className="h-3 w-2/3 rounded bg-slate-200 animate-pulse" />
      <div className="h-8 w-1/3 rounded bg-slate-200 animate-pulse mt-2" />
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

/** SVG Donut Chart для структуры статусов */
function TrafficDonut({
  stats,
}: {
  stats: AdminStats;
}) {
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
    <div className="flex flex-col h-full justify-between">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Структура потока</h3>
        <span className="text-[11px] font-mono font-bold text-slate-500">{stats.total} писем</span>
      </div>

      <div className="flex items-center justify-center gap-4 my-auto py-2">
        {/* SVG Donut */}
        <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            {/* Базовое кольцо */}
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="14" />
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
            <span className="text-lg font-black text-slate-800 leading-tight">
              {stats.total > 0 ? `${Math.round(((rerouted + forwarded) / stats.total) * 100)}%` : '0%'}
            </span>
            <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Угроз</span>
          </div>
        </div>

        {/* Легенда с цветными метками */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-1 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className={`w-2.5 h-2.5 rounded-full ${it.bgClass} shrink-0`} />
                <span className="text-slate-600 truncate">{it.label}</span>
              </div>
              <span className="font-mono font-bold text-slate-800 shrink-0">{it.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 text-center">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-6">
          <div className="h-64 rounded-lg bg-slate-100 animate-pulse" />
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
      {/* КАРТОЧКИ KPI С ЦВЕТНЫМИ АКЦЕНТАМИ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card title="Всего писем" value={stats.total} subtext="За все время" top="border-t-slate-700" />
        <Card
          title="Доставлено"
          value={stats.byStatus.DELIVERED ?? 0}
          subtext="Чистые письма"
          top="border-t-emerald-500"
          badgeBg="bg-emerald-500"
        />
        <Card
          title="Карантин"
          value={stats.byStatus.REROUTED ?? 0}
          subtext="Заблокировано"
          top="border-t-rose-500"
          badgeBg="bg-rose-500"
        />
        <Card
          title="В расследовании"
          value={stats.byStatus.FORWARDED ?? 0}
          subtext="Передано в ИБ"
          top="border-t-blue-500"
          badgeBg="bg-blue-500"
        />
        <Card
          title="Ошибки MTA"
          value={stats.byStatus.FAILED ?? 0}
          subtext="Сбои доставки"
          top="border-t-amber-500"
          badgeBg="bg-amber-500"
        />
        <Card
          title="В очереди"
          value={queued}
          subtext="Анализируются"
          top="border-t-purple-500"
          badgeBg="bg-purple-500"
        />
      </div>

      {/* ДВЕ КОЛОНКИ: ГРАФИК ДИНАМИКИ + КРУГОВАЯ ДИАГРАММА */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* График динамики по дням (8 колонок) */}
        <div className="lg:col-span-8 bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
          <div>
            {/* Шапка графика */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-800">Динамика потока сообщений</h2>
                  <span className="badge badge-sm font-mono font-medium bg-slate-100 text-slate-600 border-none">
                    {days} дн.
                  </span>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-2">
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
                {/* Легенда графика */}
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

                {/* Периоды */}
                <div className="join bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      onClick={() => onDays(p)}
                      className={`btn btn-xs join-item border-none text-[11px] font-semibold ${
                        days === p
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'bg-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {p}д
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Всплывающая плашка при наведении */}
            {hoveredDay && (
              <div className="absolute z-20 pointer-events-none bg-slate-900/95 text-white text-xs px-3 py-2 rounded-lg shadow-xl backdrop-blur-sm flex flex-col gap-1 border border-slate-700 animate-fadeIn">
                <div className="font-bold text-slate-200 border-b border-slate-700 pb-1">
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

            {/* Сам график */}
            <div className="flex gap-3 h-52 pt-2">
              {/* Ось Y */}
              <div className="flex flex-col justify-between text-[11px] font-mono text-slate-400 text-right w-7 select-none pb-6">
                {yTicks.map((tick, i) => (
                  <span key={i}>{tick}</span>
                ))}
              </div>

              {/* Область колонок с горизонтальной сеткой */}
              <div className="flex-1 flex flex-col h-full min-w-0">
                <div className="relative flex-1 flex items-end">
                  {/* Горизонтальная сетка */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {yTicks.map((_, i) => (
                      <div
                        key={i}
                        className={`w-full border-b ${
                          i === yTicks.length - 1 ? 'border-slate-300' : 'border-slate-100 border-dashed'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Столбики */}
                  <div className="relative z-10 w-full h-full flex items-end gap-1 sm:gap-2 px-1">
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
                          className="flex-1 h-full flex flex-col justify-end items-center group cursor-pointer"
                        >
                          <div
                            className={`w-full max-w-[36px] h-full rounded-md flex flex-col justify-end transition-all p-0.5 ${
                              isHovered ? 'bg-slate-100/90 ring-2 ring-primary/30' : 'hover:bg-slate-50'
                            }`}
                          >
                            {/* Сегмент: Карантин / Угрозы (Ярко-красный градиент) */}
                            {d.rerouted > 0 && (
                              <div
                                style={{ height: `${reroutedPct}%` }}
                                className="w-full bg-gradient-to-t from-rose-600 to-red-500 rounded-t-sm shadow-sm transition-all duration-300 group-hover:brightness-110 min-h-[3px] border-b border-white/20"
                              />
                            )}

                            {/* Сегмент: Чистые (Изумрудно-бирюзовый градиент) */}
                            {cleanCount > 0 && (
                              <div
                                style={{ height: `${cleanPct}%` }}
                                className={`w-full bg-gradient-to-t from-emerald-500 to-teal-400 shadow-sm transition-all duration-300 group-hover:brightness-110 min-h-[3px] ${
                                  d.rerouted === 0 ? 'rounded-t-sm' : ''
                                }`}
                              />
                            )}

                            {/* Пустой день: аккуратная цветная полоска */}
                            {d.total === 0 && (
                              <div className="w-full h-1.5 bg-slate-200/70 rounded-full mx-auto" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Ось X (даты) */}
                <div className="flex gap-1 sm:gap-2 px-1 mt-2 h-5 items-center">
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

        {/* Круговая диаграмма долей (4 колонки) */}
        <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
          <TrafficDonut stats={stats} />
        </div>
      </div>
    </div>
  );
}