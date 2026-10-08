'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, createStopword, deleteStopword, listStopwords, updateStopword } from '@/lib/api';
import { CATS, categoryLabel, severityDotClass } from '@/lib/labels';
import type { ThreatCategory, ThreatStopword } from '@/lib/types';

const inputCls =
  'px-3 py-2 rounded-lg text-sm outline-none transition ' +
  'bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800 ' +
  'placeholder:text-slate-400 ' +
  'focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]';

const selectCls =
  'px-2 py-2 rounded-lg text-sm outline-none transition ' +
  'bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800 ' +
  'focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70';

/** Аккуратный свитч: фиксированные размеры, симметричные отступы пимпочки. */
function Toggle({
  checked,
  disabled,
  onToggle,
  title,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={disabled}
      title={title}
      className={`relative inline-flex items-center w-9 h-5 p-0 shrink-0 rounded-full
                  transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                  ${checked ? 'bg-blue-600' : 'bg-slate-300/80'}
                  ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white
                    shadow-[0_1px_2px_rgba(0,0,0,0.20)]
                    transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                    ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

export default function Stopwords({ token }: { token: string }) {
  const [rules, setRules] = useState<ThreatStopword[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<ThreatCategory>('OTHER_THREAT');
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRules(await listStopwords(token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = async (id: number | 'new', fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Оптимистичное переключение активности:
   * сразу меняем UI, а сервер догоняет в фоне. При ошибке — откат.
   * Никаких перезагрузок списка — поэтому нет "проглатывания" кликов.
   */
  const toggleActive = async (id: number, nextActive: boolean) => {
    setError(null);
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active: nextActive } : r)));
    setBusyId(id);
    try {
      await updateStopword(token, id, { active: nextActive });
    } catch (e) {
      // Откат при ошибке
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active: !nextActive } : r)));
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  };

  const add = () =>
    mutate('new', async () => {
      await createStopword(token, pattern.trim(), category);
      setPattern('');
    });

  return (
    <div className="rounded-2xl px-5 py-4
                    bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                    border border-white/50
                    shadow-[0_8px_24px_rgba(31,38,135,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]">
      <h3 className="mb-2 text-sm font-bold text-slate-800">Стоп-слова</h3>
      <details className="mb-3 text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-700">
          Стоп-слова — сигнал в классификатор (нажми — как работает)
        </summary>
        <p className="mt-1">
          Совпадение подстроки в нормализованном тексте (обфускация уже снята) сразу даёт вердикт
          категории с флагом <code className="px-1 py-0.5 bg-white/60 rounded">стоп-слово: …</code>. Влияет на все новые письма после сохранения.
        </p>
      </details>

      {error && (
        <div className="px-3 py-2 mb-3 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="паттерн (мин. 2 символа)"
          minLength={2}
          maxLength={200}
          className={`${inputCls} flex-1 min-w-40`}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ThreatCategory)}
          className={selectCls}
        >
          {CATS.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={busyId !== null || pattern.trim().length < 2}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium
                     bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition
                     shadow-[0_2px_8px_rgba(37,99,235,0.30)]"
        >
          <Plus className="w-3.5 h-3.5" />
          {busyId === 'new' ? '…' : 'Добавить'}
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="text-sm text-slate-400">Правил нет</div>
      ) : (
        <div className="overflow-x-auto border rounded-xl border-white/50 bg-white/30 backdrop-blur-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-white/50">
                <th className="px-3 py-2 font-bold text-left">Паттерн</th>
                <th className="px-3 py-2 font-bold text-left">Категория</th>
                <th className="px-3 py-2 font-bold text-left">Активно</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const busy = busyId === r.id;
                return (
                  <tr key={r.id} className="border-b border-white/30 last:border-0">
                    <td className="px-3 py-2 font-mono text-slate-800">{r.pattern}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${severityDotClass(r.category)}`} aria-hidden />
                        <select
                          value={r.category}
                          disabled={busyId !== null}
                          onChange={(e) =>
                            mutate(r.id, () =>
                              updateStopword(token, r.id, {
                                category: e.target.value as ThreatCategory,
                              }),
                            )
                          }
                          className={`${selectCls} py-1 text-xs`}
                        >
                          {CATS.map((c) => (
                            <option key={c} value={c}>
                              {categoryLabel(c)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Toggle
                        checked={r.active}
                        disabled={busy}
                        onToggle={() => toggleActive(r.id, !r.active)}
                        title={r.active ? 'Выключить' : 'Включить'}
                      />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {confirmDelete === r.id ? (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() =>
                              mutate(r.id, () => deleteStopword(token, r.id)).then(() =>
                                setConfirmDelete(null),
                              )
                            }
                            disabled={busy}
                            className="px-2 py-1 rounded text-[11px] font-medium bg-rose-600 text-white hover:bg-rose-700"
                          >
                            {busy ? '…' : 'Удалить?'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-2 py-1 rounded text-[11px] font-medium text-slate-600 hover:bg-white/60"
                          >
                            Нет
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(r.id)}
                          disabled={busyId !== null}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-white/60 transition"
                          title="Удалить"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}