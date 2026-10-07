'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, createStopword, deleteStopword, listStopwords, updateStopword } from '@/lib/api';
import type { ThreatCategory, ThreatStopword } from '@/lib/types';

const CATS: ThreatCategory[] = ['TERRORISM', 'MAN_MADE', 'ILLEGAL_ACTIONS', 'OTHER_THREAT'];

/** Стоп-слова ИБ: подстрока (без учёта регистра) по нормализованному тексту → вердикт категории. */
export default function Stopwords({ token }: { token: string }) {
  const [rules, setRules] = useState<ThreatStopword[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<ThreatCategory>('OTHER_THREAT');
  const [busy, setBusy] = useState(false);

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

  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    mutate(async () => {
      await createStopword(token, pattern.trim(), category);
      setPattern('');
    });

  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 mb-4">
      <div className="text-xs text-gray-500 mb-2">
        Стоп-слова — сигнал в classify: совпадение подстроки в нормализованном тексте (обфускация уже снята)
        сразу даёт вердикт категории с флагом <code>stopword:…</code>
      </div>
      {error && (
        <div className="alert alert-error alert-sm mb-2 text-sm">
          <span>{error}</span>
        </div>
      )}
      <div className="flex gap-2 mb-2 flex-wrap">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="паттерн (мин. 2 символа)"
          minLength={2}
          maxLength={200}
          className="input input-bordered input-sm flex-1 min-w-40"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ThreatCategory)}
          className="select select-bordered select-sm"
        >
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button onClick={add} disabled={busy || pattern.trim().length < 2} className="btn btn-primary btn-sm">
          + Добавить
        </button>
      </div>
      {rules.length === 0 ? (
        <div className="text-sm text-gray-400">Правил нет</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>Паттерн</th>
                <th>Категория</th>
                <th>Активно</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono">{r.pattern}</td>
                  <td>
                    <select
                      value={r.category}
                      disabled={busy}
                      onChange={(e) =>
                        mutate(() => updateStopword(token, r.id, { category: e.target.value as ThreatCategory }))
                      }
                      className="select select-bordered select-xs"
                    >
                      {CATS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.active}
                      disabled={busy}
                      onChange={() => mutate(() => updateStopword(token, r.id, { active: !r.active }))}
                      className="toggle toggle-sm"
                      title={r.active ? 'Выключить' : 'Включить'}
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => mutate(() => deleteStopword(token, r.id))}
                      disabled={busy}
                      className="btn btn-ghost btn-xs text-error"
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
