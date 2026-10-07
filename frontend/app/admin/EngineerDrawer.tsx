'use client';

import { useState } from 'react';
import { ApiError, forwardMessage, getMessage, releaseMessage, reprocessMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { actionLabel, categoryLabel, flagLabel, linkReasonLabel, linkStatusLabel, routeLabel, spellerSourceLabel, statusLabel } from '@/lib/labels';
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
      <h3 className="font-semibold text-sm uppercase text-gray-500">{title}</h3>
      {children}
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
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge badge-error text-white">{categoryLabel(msg.threat?.category ?? msg.verdict)}</span>
              {msg.threat?.confidence != null && (
                <span className="text-sm">уверенность {(msg.threat.confidence * 100).toFixed(0)}%</span>
              )}
              <span
                className={`badge badge-sm ${msg.status === 'FORWARDED' ? 'badge-info text-white' : msg.status === 'REROUTED' ? 'badge-error text-white' : 'badge-ghost'}`}
              >
                {msg.status === 'FORWARDED' ? 'Отправлено в ИБ' : msg.status === 'REROUTED' ? 'В карантине' : statusLabel(msg.status)}
              </span>
            </div>
            <h2 className="font-bold mt-1">{msg.subject || '(без темы)'}</h2>
            <div className="text-xs text-gray-500">
              {msg.senderEmail} → <b>{msg.recipientEmail}</b> · {formatDate(msg.createdAt)}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-sm btn-ghost ml-auto" title="Закрыть" aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        {error && (
          <div className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}

        <Section title="Этап 1 · Приём и разбор — триггеры и исходный текст">
          <div className="flex flex-wrap gap-1">
            {flags.length === 0 ? (
              <span className="text-sm text-gray-400">нет</span>
            ) : (
              flags.map((f, i) => (
                <span key={i} className="badge badge-outline">
                  {flagLabel(f)}
                </span>
              ))
            )}
          </div>
          <pre className="whitespace-pre-wrap text-sm font-sans bg-base-200 rounded-lg p-3">{highlightedClean}</pre>
        </Section>

        <Section title="Этап 2 · Спеллер — сначала восстанавливаем слова">
          <p className="text-xs text-gray-500">
            Спеллер идёт раньше алгоритмов: иначе маскировка прячет угрозу.
          </p>
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
                  <tr key={i}>
                    <td className="text-red-600">{f.original}</td>
                    <td className="text-green-700">{f.suggested}</td>
                    <td className="text-gray-500">{spellerSourceLabel(f.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Этап 3 · Деобфускация — нормализованный текст">
          <pre className="whitespace-pre-wrap text-sm font-sans bg-base-200 rounded-lg p-3">{highlightedNorm}</pre>
        </Section>

        <Section title={`Этап 4 · Проверка ссылок (${msg.links.length})`}>
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
                    <span>Оценка угрозы: {score}%</span>
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

        <Section title="Этап 5 · Вердикт">
          <p className="text-sm">{msg.threat?.explanation || '—'}</p>
          {msg.threat?.heuristicScore != null && (
            <span className="text-xs text-gray-500">
              Эвристика: {msg.threat.heuristicScore.toFixed(2)}
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
                  {actionLabel(d.actionTaken)} · {d.success ? 'успешно' : 'ошибка'} ·{' '}
                  {d.attemptedAt ? formatDate(d.attemptedAt) : '—'}
                  {routeLabel(d.smtpResponse) ? ` · ${routeLabel(d.smtpResponse)}` : ''}
                </div>
              </div>
            ))
          )}
        </Section>

        <button onClick={reprocess} disabled={busy} className="btn btn-ghost btn-sm">
          Перепроверить
        </button>

        <div className="flex gap-2">
          {(msg.status === 'REROUTED' || msg.status === 'FORWARDED') && !confirmRelease && (
            <button onClick={() => setConfirmRelease(true)} disabled={busy} className="btn btn-outline btn-warning btn-sm flex-1">
              Выпустить из карантина
            </button>
          )}
          {msg.status === 'REROUTED' && !confirmForward && (
            <button onClick={() => setConfirmForward(true)} disabled={busy} className="btn btn-outline btn-info btn-sm flex-1">
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
