'use client';

import { useState } from 'react';
import { ApiError, forwardMessage, getMessage, releaseMessage, reprocessMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { actionLabel, categoryLabel, flagLabel, linkReasonLabel, linkStatusLabel, routeLabel, severityBorderClass, severityDotClass, spellerSourceLabel, statusLabel } from '@/lib/labels';
import { CloseIcon } from '@/components/icons';
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
    .map((x) => ({
      original: String(x.original),
      suggested: String(x.suggested),
      source: typeof x.source === 'string' ? x.source : undefined,
    }));
}

function asReasons(details: unknown): string[] {
  if (typeof details === 'object' && details !== null && 'reasons' in details) {
    const r = (details as Record<string, unknown>).reasons;
    if (Array.isArray(r)) return r.map((x) => linkReasonLabel(String(x)));
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
  return <span className={`badge ${cls}`}>{linkStatusLabel(s)}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="soc-panel-title">{title}</h3>
      {children}
    </div>
  );
}

/** Этап отчёта: нумерованный маркер + заголовок обычным регистром. */
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-neutral-800 text-white text-xs flex items-center justify-center shrink-0">
        {n}
      </span>
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <h3 className="soc-panel-title">{title}</h3>
        {hint && <p className="soc-subtle -mt-1">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

export default function EngineerDrawer({ msg, token, onClose, onReprocessed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmForward, setConfirmForward] = useState(false);
  const [extraEmail, setExtraEmail] = useState('');
  const [forwardReason, setForwardReason] = useState('');
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

  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      await releaseMessage(token, msg.id, reason.trim() || undefined);
      onReprocessed(await getMessage(token, msg.id));
      setConfirmRelease(false);
      setReason('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const forward = async () => {
    const extra = extraEmail.trim();
    if (extra && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra)) {
      setError('Проверьте дополнительный адрес');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await forwardMessage(token, msg.id, {
        ...(extra ? { emails: [extra] } : {}),
        ...(forwardReason.trim() ? { reason: forwardReason.trim() } : {}),
      });
      onReprocessed(await getMessage(token, msg.id));
      setConfirmForward(false);
      setExtraEmail('');
      setForwardReason('');
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
          <div className={`flex-1 min-w-0 rounded-lg border border-base-300 border-l-4 ${severityBorderClass(msg.threat?.category ?? msg.verdict)} p-3 flex flex-col gap-2`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${severityDotClass(msg.threat?.category ?? msg.verdict)}`} aria-hidden />
                {categoryLabel(msg.threat?.category ?? msg.verdict)}
              </span>
              {msg.threat?.confidence != null && (
                <span className="text-sm text-gray-500">уверенность {(msg.threat.confidence * 100).toFixed(0)}%</span>
              )}
              <span className="badge badge-sm badge-outline ml-auto">
                {msg.status === 'FORWARDED' ? 'Отправлено в ИБ' : msg.status === 'REROUTED' ? 'В карантине' : statusLabel(msg.status)}
              </span>
            </div>
            <h2 className="font-bold">{msg.subject || '(без темы)'}</h2>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <span className="text-gray-500">От</span>
              <span className="soc-artifact">{msg.senderEmail}</span>
              <span className="text-gray-500">Кому</span>
              <span className="soc-artifact">{msg.recipientEmail}</span>
              <span className="text-gray-500">Дата</span>
              <span>{formatDate(msg.createdAt)}</span>
              <span className="text-gray-500">Номер</span>
              <span className="soc-artifact">{msg.id}</span>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-sm btn-ghost" title="Закрыть" aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        {error && (
          <div className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}

        <Step n={1} title="Приём и разбор — триггеры и исходный текст">
          <div className="flex flex-wrap gap-1">
            {flags.length === 0 ? (
              <span className="text-sm text-gray-400">нет</span>
            ) : (
              flags.map((f, i) => (
                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded border border-base-300 bg-base-100 text-xs text-gray-700">
                  {flagLabel(f)}
                </span>
              ))
            )}
          </div>
          <pre className="whitespace-pre-wrap text-sm font-sans rounded-lg border border-base-300 p-3">{highlightedClean}</pre>
        </Step>

        <Step n={2} title="Спеллер — сначала восстанавливаем слова" hint="Спеллер идёт раньше алгоритмов: иначе маскировка прячет угрозу.">
          {fixes.length === 0 ? (
            <span className="text-sm text-gray-400">исправлений нет</span>
          ) : (
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>Было</th>
                  <th>Стало</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {fixes.map((f, i) => (
                  <tr key={i} className="border-t border-base-200">
                    <td className="soc-artifact bg-red-50 text-red-900 px-2 py-1">{f.original}</td>
                    <td className="soc-artifact bg-green-50 text-green-900 px-2 py-1">{f.suggested}</td>
                    <td className="text-gray-500 text-xs px-2 py-1">{spellerSourceLabel(f.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Step>

        <Step n={3} title="Деобфускация — нормализованный текст">
          <pre className="whitespace-pre-wrap text-sm font-sans rounded-lg border border-base-300 p-3">{highlightedNorm}</pre>
        </Step>

        <Step n={4} title={`Проверка ссылок (${msg.links.length})`}>
          {msg.links.length === 0 ? (
            <span className="text-sm text-gray-400">ссылок нет</span>
          ) : (
            msg.links.map((l, i) => {
              const score = l.reputationScore ?? 0;
              const reasons = asReasons(l.details);
              return (
                <div key={i} className="rounded-lg border border-base-300 px-3 py-2 flex flex-col gap-1">
                  <div className="soc-artifact text-xs">{l.url}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <LinkStatusBadge s={l.status} />
                    <span className="text-gray-500">Оценка угрозы: {score}%</span>
                    <progress className="progress progress-error w-20 h-1.5" value={score} max={100} />
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
        </Step>

        <Step n={5} title="Вердикт">
          <div className={`rounded-lg border border-base-300 border-l-4 ${severityBorderClass(msg.threat?.category ?? msg.verdict)} px-3 py-2 flex flex-col gap-1`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 font-semibold text-sm">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${severityDotClass(msg.threat?.category ?? msg.verdict)}`} aria-hidden />
                {categoryLabel(msg.threat?.category ?? msg.verdict)}
              </span>
              {msg.threat?.confidence != null && (
                <span className="text-xs text-gray-500">уверенность {(msg.threat.confidence * 100).toFixed(0)}%</span>
              )}
              {msg.threat?.heuristicScore != null && (
                <span className="text-xs text-gray-500">эвристика: {msg.threat.heuristicScore.toFixed(2)}</span>
              )}
            </div>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {flags.map((f, i) => (
                  <span key={i} className="inline-flex items-center px-2 py-0.5 rounded border border-base-300 bg-base-100 text-xs text-gray-700">
                    {flagLabel(f)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-sm">{msg.threat?.explanation || '—'}</p>
          </div>
        </Step>

        <Section title="Маршрут: кому предназначалось → куда ушло">
          {msg.deliveries.length === 0 ? (
            <span className="text-sm text-gray-400">записей доставки нет</span>
          ) : (
            <div className="flex flex-col">
              {msg.deliveries.map((d, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${d.success ? 'bg-success' : 'bg-error'}`} aria-hidden />
                  <div className="pb-3 text-sm">
                    <div className="soc-artifact text-xs">
                      {msg.recipientEmail} → <b>{d.destinationRecipients.join(', ')}</b>
                    </div>
                    <div className="soc-subtle">
                      {actionLabel(d.actionTaken)} · {d.success ? 'успешно' : 'ошибка'} ·{' '}
                      {d.attemptedAt ? formatDate(d.attemptedAt) : '—'}
                      {routeLabel(d.smtpResponse) ? ` · ${routeLabel(d.smtpResponse)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <button onClick={reprocess} disabled={busy} className="btn btn-ghost btn-sm">
          Перепроверить
        </button>

        <div className="flex gap-2">
          {(msg.status === 'REROUTED' || msg.status === 'FORWARDED') && !confirmRelease && (
            <button onClick={() => setConfirmRelease(true)} disabled={busy} className="btn btn-error btn-sm flex-1">
              Выпустить из карантина
            </button>
          )}
          {msg.status === 'REROUTED' && !confirmForward && (
            <button onClick={() => setConfirmForward(true)} disabled={busy} className="btn btn-primary btn-sm flex-1">
              Отправить безопаснику
            </button>
          )}
        </div>

        {(msg.status === 'REROUTED' || msg.status === 'FORWARDED') && confirmRelease && (
            <div className="flex flex-col gap-2 rounded-lg border border-warning p-3">
              <div className="text-sm">
                Оригинал будет <b>доставлен {msg.recipientEmail}</b>. Действие пишется в аудит.
              </div>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Причина выпуска (необязательно)"
                maxLength={500}
                className="input input-bordered input-sm w-full"
              />
              <div className="flex gap-2">
                <button onClick={release} disabled={busy} className="btn btn-warning btn-sm flex-1">
                  {busy ? '…' : 'Подтвердить выпуск'}
                </button>
                <button
                  onClick={() => {
                    setConfirmRelease(false);
                    setReason('');
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  Отмена
                </button>
              </div>
            </div>
        )}

        {msg.status === 'REROUTED' && confirmForward && (
            <div className="flex flex-col gap-2 rounded-lg border border-info p-3">
              <div className="text-sm">
                Копия оригинала уйдёт <b>безопасникам по правилу категории</b> (см. «Адреса
                ИБ» в Настройках). Письмо сменит статус на <b>«Отправлено в ИБ»</b> и уйдёт
                из карантина, отправка пишется в аудит. Повторно отправить нельзя.
              </div>
              <input
                value={extraEmail}
                onChange={(e) => setExtraEmail(e.target.value)}
                placeholder="Ещё адрес (необязательно)"
                maxLength={200}
                className="input input-bordered input-sm w-full font-mono"
              />
              <input
                value={forwardReason}
                onChange={(e) => setForwardReason(e.target.value)}
                placeholder="Причина/комментарий (необязательно)"
                maxLength={500}
                className="input input-bordered input-sm w-full"
              />
              <div className="flex gap-2">
                <button onClick={forward} disabled={busy} className="btn btn-info btn-sm flex-1">
                  {busy ? '…' : 'Подтвердить отправку'}
                </button>
                <button
                  onClick={() => {
                    setConfirmForward(false);
                    setExtraEmail('');
                    setForwardReason('');
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  Отмена
                </button>
              </div>
            </div>
        )}
      </div>
    </div>
  );
}
