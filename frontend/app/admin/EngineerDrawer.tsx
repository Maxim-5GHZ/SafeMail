'use client';

import { useState } from 'react';
import { ApiError, getMessage, reprocessMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useHighlighted } from '@/lib/highlight';
import type { MessageDto, SpellerFix } from '@/lib/types';

interface Props {
  msg: MessageDto;
  token: string;
  onClose: () => void;
  onReprocessed: (fresh: MessageDto) => void;
}

function asSpellerFixes(v: unknown): SpellerFix[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === 'object' && x !== null && 'original' in x && 'suggested' in x,
    )
    .map((x) => ({ original: String(x.original), suggested: String(x.suggested) }));
}

function asReasons(details: unknown): string[] {
  if (typeof details === 'object' && details !== null && 'reasons' in details) {
    const r = (details as Record<string, unknown>).reasons;
    if (Array.isArray(r)) return r.map(String);
  }
  return [];
}

function LinkStatusBadge({ s }: { s: string }) {
  const cls =
    s === 'MALICIOUS'
      ? 'badge-error'
      : s === 'SUSPICIOUS'
        ? 'badge-warning'
        : s === 'SAFE'
          ? 'badge-success'
          : 'badge-ghost';
  return <span className={`badge ${cls}`}>{s}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-sm uppercase text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

export default function EngineerDrawer({ msg, token, onClose, onReprocessed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flags = msg.threat?.heuristicFlags ?? [];
  const highlightedClean = useHighlighted(msg.cleanText, flags);
  const highlightedNorm = useHighlighted(msg.normalizedText, flags);
  const fixes = asSpellerFixes(msg.threat?.spellerFixes);

  const reprocess = async () => {
    setBusy(true);
    setError(null);
    try {
      await reprocessMessage(token, msg.id);
      onReprocessed(await getMessage(token, msg.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[560px] max-w-full bg-base-100 h-full overflow-y-auto shadow-2xl p-5 flex flex-col gap-5">
        <div className="flex items-start gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge badge-error text-white">{msg.threat?.category ?? msg.verdict ?? '?'}</span>
              {msg.threat?.confidence != null && (
                <span className="text-sm">уверенность {(msg.threat.confidence * 100).toFixed(0)}%</span>
              )}
              <span className="text-xs text-gray-400">{msg.status}</span>
            </div>
            <h2 className="font-bold mt-1">{msg.subject || '(без темы)'}</h2>
            <div className="text-xs text-gray-500">
              {msg.senderEmail} → <b>{msg.recipientEmail}</b> · {formatDate(msg.createdAt)}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-sm btn-ghost ml-auto" title="Закрыть">
            ✕
          </button>
        </div>

        {error && (
          <div className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}

        <Section title="Триггеры в тексте">
          <div className="flex flex-wrap gap-1">
            {flags.length === 0 ? (
              <span className="text-sm text-gray-400">нет</span>
            ) : (
              flags.map((f, i) => (
                <span key={i} className="badge badge-outline">
                  {f}
                </span>
              ))
            )}
          </div>
          <pre className="whitespace-pre-wrap text-sm font-sans bg-base-200 rounded-lg p-3">{highlightedClean}</pre>
        </Section>

        <Section title="Спеллер: было → стало">
          {fixes.length === 0 ? (
            <span className="text-sm text-gray-400">исправлений нет</span>
          ) : (
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>Было</th>
                  <th>Стало</th>
                </tr>
              </thead>
              <tbody>
                {fixes.map((f, i) => (
                  <tr key={i}>
                    <td className="text-red-600">{f.original}</td>
                    <td className="text-green-700">{f.suggested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Нормализованный текст (деобфускация)">
          <pre className="whitespace-pre-wrap text-sm font-sans bg-base-200 rounded-lg p-3">{highlightedNorm}</pre>
        </Section>

        <Section title={`Ссылки (${msg.links.length})`}>
          {msg.links.length === 0 ? (
            <span className="text-sm text-gray-400">ссылок нет</span>
          ) : (
            msg.links.map((l, i) => {
              const score = l.reputationScore ?? 0;
              const reasons = asReasons(l.details);
              return (
                <div key={i} className="card card-compact bg-base-200 p-3 flex flex-col gap-1">
                  <div className="text-xs break-all font-mono">{l.url}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <LinkStatusBadge s={l.status} />
                    <span>Threat Score: {score}%</span>
                    <progress className="progress progress-error w-24" value={score} max={100} />
                  </div>
                  {reasons.length > 0 && (
                    <ul className="text-xs text-gray-500 list-disc ml-4">
                      {reasons.map((r, j) => (
                        <li key={j}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </Section>

        <Section title="Обоснование ИИ">
          <p className="text-sm">{msg.threat?.explanation || '—'}</p>
          {msg.threat?.heuristicScore != null && (
            <span className="text-xs text-gray-500">
              heuristic_score: {msg.threat.heuristicScore.toFixed(2)}
            </span>
          )}
        </Section>

        <Section title="Маршрут: кому предназначалось → куда ушло">
          {msg.deliveries.length === 0 ? (
            <span className="text-sm text-gray-400">записей доставки нет</span>
          ) : (
            msg.deliveries.map((d, i) => (
              <div key={i} className="text-sm bg-base-200 rounded-lg p-2">
                <div>
                  {msg.recipientEmail} → <b>{d.destinationRecipients.join(', ')}</b>
                </div>
                <div className="text-xs text-gray-500">
                  {d.actionTaken} · {d.success ? 'успешно' : 'ОШИБКА'} ·{' '}
                  {d.attemptedAt ? formatDate(d.attemptedAt) : '—'}
                  {d.smtpResponse ? ` · ${d.smtpResponse}` : ''}
                </div>
              </div>
            ))
          )}
        </Section>

        <button onClick={reprocess} disabled={busy} className="btn btn-outline btn-sm">
          {busy ? '…' : '⟳ Перепроверить (reprocess)'}
        </button>
      </div>
    </div>
  );
}
