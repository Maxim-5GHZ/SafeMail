'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, createStopword, deleteStopword, listStopwords, updateStopword } from '@/lib/api';
import { CATS, categoryLabel, severityDotClass } from '@/lib/labels';
import { CloseIcon } from '@/components/icons';
import type { ThreatCategory, ThreatStopword } from '@/lib/types';

/** Стоп-слова ИБ: подстрока (без учёта регистра) по нормализованному тексту → вердикт категории. */
export default function Stopwords({ token }: { token: string }) {
  const [rules, setRules] = useState<ThreatStopword[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<ThreatCategory>('OTHER_THREAT');
  /** Какая строка сейчас мутирует ('new' — форма добавления). Остальные контролы живые. */
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

  const add = () =>
    mutate('new', async () => {
      await createStopword(token, pattern.trim(), category);
      setPattern('');
    });

  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 mb-4">
      <h3 className="soc-panel-title mb-2">Стоп-слова</h3>
      <details className="text-xs text-gray-500 mb-2">
        <summary className="cursor-pointer hover:text-gray-700">
          Стоп-слова — сигнал в классификатор (нажми — как работает)
        </summary>
        <p className="mt-1">
          Совпадение подстроки в нормализованном тексте (обфускация уже снята) сразу даёт вердикт
          категории с флагом <code>стоп-слово: …</code>. Влияет на все новые письма после сохранения.
        </p>
      </details>
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
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={busyId !== null || pattern.trim().length < 2}
          className="btn btn-primary btn-sm"
        >
          {busyId === 'new' ? '…' : '+ Добавить'}
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
              {rules.map((r) => {
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="font-mono">{r.pattern}</td>
                    <td>
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
                        className="select select-bordered select-xs"
                      >
                        {CATS.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                      </span>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.active}
                        disabled={busyId !== null}
                        onChange={() =>
                          mutate(r.id, () => updateStopword(token, r.id, { active: !r.active }))
                        }
                        className="toggle toggle-sm"
                        title={r.active ? 'Выключить' : 'Включить'}
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      {confirmDelete === r.id ? (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() =>
                              mutate(r.id, () => deleteStopword(token, r.id)).then(() =>
                                setConfirmDelete(null),
                              )
                            }
                            disabled={busy}
                            className="btn btn-error btn-xs"
                            title="Подтвердить удаление"
                          >
                            {busy ? '…' : 'Удалить?'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="btn btn-ghost btn-xs"
                          >
                            Нет
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(r.id)}
                          disabled={busyId !== null}
                          className="btn btn-ghost btn-xs text-error"
                          title="Удалить"
                        >
                          <CloseIcon className="w-3 h-3" />
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
