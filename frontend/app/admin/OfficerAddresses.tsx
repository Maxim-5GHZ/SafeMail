'use client';

import { useCallback, useEffect, useState } from 'react';
import { Edit3, Save, X } from 'lucide-react';
import { ApiError, listRules, updateRule } from '@/lib/api';
import { CATS, categoryLabel, severityDotClass } from '@/lib/labels';
import type { RoutingRule, ThreatCategory } from '@/lib/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      setError('Нужен хотя бы один адрес');
      return;
    }
    if (bad.length > 0) {
      setError(`Не адрес: ${bad.join(', ')}`);
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
    <div className="rounded-2xl px-5 py-4
                    bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                    border border-white/50
                    shadow-[0_8px_24px_rgba(31,38,135,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]">
      <h3 className="mb-2 text-sm font-bold text-slate-800">Адреса ИБ</h3>
      <details className="mb-3 text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-700">
          Адреса ИБ — куда уходит карантин (нажми — как работает)
        </summary>
        <p className="mt-1">
          По каждой категории — свой список получателей. Сюда пайплайн автоматически кладёт
          карантинные письма, и сюда же по умолчанию уходит ручная кнопка «Отправить
          безопаснику» в карточке письма.
        </p>
      </details>

      {error && (
        <div className="px-3 py-2 mb-3 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
          {error}
        </div>
      )}

      {rules.length === 0 ? (
        <div className="text-sm text-slate-400">Загрузка…</div>
      ) : (
        <div className="overflow-x-auto border rounded-xl border-white/50 bg-white/30 backdrop-blur-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-white/50">
                <th className="px-3 py-2 font-bold text-left">Категория</th>
                <th className="px-3 py-2 font-bold text-left">Получатели</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {CATS.map((c) => {
                const r = byCat(c);
                const isEditing = editing === c;
                return (
                  <tr key={c} className="border-b border-white/30 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-slate-800">
                        <span className={`inline-block w-2 h-2 rounded-full ${severityDotClass(c)}`} aria-hidden />
                        {categoryLabel(c)}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-64">
                      {isEditing ? (
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={Math.min(5, Math.max(2, draft.split('\n').length))}
                          placeholder="soc@ваш-домен — по одному на строке (можно через запятую)"
                          className="w-full px-3 py-2 rounded-lg font-mono text-xs outline-none transition
                                     bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800
                                     placeholder:text-slate-400
                                     focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70
                                     shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                        />
                      ) : (
                        <span className="text-xs break-all text-slate-700">
                          {(r?.destinationEmails ?? []).join(', ') || <span className="text-slate-400">—</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isEditing ? (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() => save(c)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium
                                       bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                          >
                            <Save className="w-3 h-3" />
                            {busy ? '…' : 'Сохранить'}
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium
                                       text-slate-600 hover:bg-white/70 transition"
                          >
                            <X className="w-3 h-3" />
                            Отмена
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => startEdit(c)}
                          disabled={editing !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium
                                     bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                                     hover:bg-white/90 disabled:opacity-40 transition
                                     shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                        >
                          <Edit3 className="w-3 h-3" />
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