'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, listRules, updateRule } from '@/lib/api';
import { CATS, categoryLabel } from '@/lib/labels';
import type { RoutingRule, ThreatCategory } from '@/lib/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Адреса ИБ: куда пайплайн автоматически кладёт карантин по каждой категории
 * (threat_routing_rules) и куда по умолчанию уходит ручная кнопка «Отправить безопаснику».
 */
export default function OfficerAddresses({ token }: { token: string }) {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ThreatCategory | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRules(await listRules(token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const byCat = (c: ThreatCategory) => rules.find((r) => r.category === c);

  const startEdit = (c: ThreatCategory) => {
    setEditing(c);
    setDraft((byCat(c)?.destinationEmails ?? []).join('\n'));
    setError(null);
  };

  const save = async (c: ThreatCategory) => {
    const emails = draft
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = emails.filter((e) => !EMAIL_RE.test(e));
    if (emails.length === 0) {
      setError('Нужен хотя бы один email');
      return;
    }
    if (bad.length > 0) {
      setError(`Не email: ${bad.join(', ')}`);
      return;
    }
    setBusy(true);
    try {
      await updateRule(token, c, Array.from(new Set(emails)));
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 mb-4">
      <details className="text-xs text-gray-500 mb-2">
        <summary className="cursor-pointer hover:text-gray-700">
          Адреса ИБ — куда уходит карантин (нажми — как работает)
        </summary>
        <p className="mt-1">
          По каждой категории — свой список получателей. Сюда пайплайн автоматически кладёт
          карантинные письма, и сюда же по умолчанию уходит ручная кнопка «Отправить
          безопаснику» в карточке письма.
        </p>
      </details>
      {error && (
        <div className="alert alert-error alert-sm mb-2 text-sm">
          <span>{error}</span>
        </div>
      )}
      {rules.length === 0 ? (
        <div className="text-sm text-gray-400">Загрузка…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>Категория</th>
                <th>Получатели</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {CATS.map((c) => {
                const r = byCat(c);
                const isEditing = editing === c;
                return (
                  <tr key={c}>
                    <td className="whitespace-nowrap">{categoryLabel(c)}</td>
                    <td className="min-w-64">
                      {isEditing ? (
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={Math.min(5, Math.max(2, draft.split('\n').length))}
                          placeholder="soc@corp-sec.ru — по одному на строке (можно через запятую)"
                          className="textarea textarea-bordered textarea-xs w-full font-mono"
                        />
                      ) : (
                        <span className="text-xs break-all">
                          {(r?.destinationEmails ?? []).join(', ') || '—'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {isEditing ? (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() => save(c)}
                            disabled={busy}
                            className="btn btn-primary btn-xs"
                          >
                            {busy ? '…' : 'Сохранить'}
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            disabled={busy}
                            className="btn btn-ghost btn-xs"
                          >
                            Отмена
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => startEdit(c)}
                          disabled={editing !== null}
                          className="btn btn-ghost btn-xs"
                        >
                          Изменить
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
