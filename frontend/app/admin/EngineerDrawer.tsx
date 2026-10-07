'use client';

import { useState } from 'react';
import { ApiError, forwardMessage, getMessage, releaseMessage, reprocessMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  actionLabel,
  categoryLabel,
  flagLabel,
  linkReasonLabel,
  linkStatusLabel,
  routeLabel,
  severityBorderClass,
  severityDotClass,
  spellerSourceLabel,
  statusLabel,
} from '@/lib/labels';
import { CloseIcon, RefreshIcon, WarnIcon } from '@/components/icons';
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

export default function EngineerDrawer({ msg, token, onClose, onReprocessed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmForward, setConfirmForward] = useState(false);
  const [extraEmail, setExtraEmail] = useState('');
  const [forwardReason, setForwardReason] = useState('');
  const [viewMode, setViewMode] = useState<'normalized' | 'raw'>('normalized');

  const flags = msg.threat?.heuristicFlags ?? [];
  const highlightedClean = useHighlighted(msg.cleanText, flags);
  const highlightedNorm = useHighlighted(msg.normalizedText, flags);
  const fixes = asSpellerFixes(msg.threat?.spellerFixes);

  const confidencePct = Math.round((msg.threat?.confidence ?? 0) * 100);
  const actionable = msg.status === 'REROUTED' || msg.status === 'FORWARDED';

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
      {/* Затемнение фона */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

      {/* Выдвижная панель карточки инцидента */}
      <div className="relative w-[680px] max-w-full bg-slate-50 h-full overflow-y-auto shadow-2xl flex flex-col text-slate-800 border-l border-slate-200">

        {/* ХЕДЕР КАРТОЧКИ: Технический статус и действия */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono tracking-wider uppercase text-slate-400 font-semibold">
                INCIDENT ID
              </span>
              <span className="font-mono text-xs font-bold text-slate-700">
                #{msg.id.slice(0, 13)}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase ${
                msg.status === 'REROUTED'
                  ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                  : msg.status === 'FORWARDED'
                  ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                  : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
              }`}>
                {msg.status === 'FORWARDED' ? 'Передано в ИБ' : msg.status === 'REROUTED' ? 'В карантине' : statusLabel(msg.status)}
              </span>
            </div>
            <h2 className="text-base font-bold truncate text-slate-900 mt-0.5">
              {msg.subject || '(Без темы)'}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={reprocess}
              disabled={busy}
              className="btn btn-sm btn-ghost border border-slate-200 hover:bg-slate-100 text-xs gap-1.5 font-medium"
              title="Перезапустить пайплайн анализа"
            >
              <RefreshIcon className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Аудит
            </button>
            <button onClick={onClose} className="btn btn-sm btn-ghost p-1.5 text-slate-400 hover:text-slate-800">
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 text-xs flex items-center gap-2">
            <WarnIcon className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-6 flex flex-col gap-6">

          {/* БЛОК 1: ВЕРДИКТ И AI-КЛАССИФИКАЦИЯ (В САМОМ ВЕРХУ) */}
          <div className={`rounded-xl border border-l-4 ${severityBorderClass(msg.threat?.category ?? msg.verdict)} bg-white shadow-sm overflow-hidden`}>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`w-3 h-3 rounded-full ${severityDotClass(msg.threat?.category ?? msg.verdict)}`} />
                <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Вердикт системы</span>
                <span className="text-sm font-extrabold text-slate-900">
                  {categoryLabel(msg.threat?.category ?? msg.verdict)}
                </span>
              </div>

              {/* Счётчик уверенности */}
              <div className="flex items-center gap-3">
                {msg.threat?.heuristicScore != null && (
                  <span className="text-xs font-mono text-slate-500">
                    Эвристика: <b className="text-slate-700">{msg.threat.heuristicScore.toFixed(2)}</b>
                  </span>
                )}
                {msg.threat?.confidence != null && (
                  <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-full">
                    <span className="text-[11px] font-medium text-slate-500">ML-скор:</span>
                    <span className="text-xs font-black font-mono text-slate-900">{confidencePct}%</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50/50 flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-slate-700">
                {msg.threat?.explanation || 'Аномалий безопасности в содержимом сообщения не выявлено.'}
              </p>

              {/* Сработавшие правила и триггеры */}
              {flags.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono uppercase text-slate-400 font-semibold mb-1.5">
                    Сработавшие сигнатуры и IoC ({flags.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {flags.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs bg-red-50 text-red-700 border border-red-200"
                      >
                        {flagLabel(f)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* БЛОК 2: ПАСПОРТ СООБЩЕНИЯ (МЕТАДАННЫЕ ПОЧТОВОГО КОНВЕРТА) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold mb-3">
              Параметры конверта (SMTP Envelope)
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-y-2 gap-x-3 items-baseline">
              <span className="text-slate-400 font-medium">Отправитель:</span>
              <span className="font-mono text-slate-800 select-all font-semibold">
                {msg.senderEmail}
              </span>

              <span className="text-slate-400 font-medium">Получатель:</span>
              <span className="font-mono text-slate-800 select-all">
                {msg.recipientEmail}
              </span>

              <span className="text-slate-400 font-medium">Таймштамп:</span>
              <span className="text-slate-600 font-mono">
                {formatDate(msg.createdAt)}
              </span>

              <span className="text-slate-400 font-medium">Вложения:</span>
              <span className="text-slate-600">
                {(msg.attachments ?? []).length > 0
                  ? `${(msg.attachments ?? []).length} шт. (${(msg.attachments ?? []).map((a) => a.filename).join(', ')})`
                  : 'Отсутствуют'}
              </span>
            </div>
          </div>

          {/* БЛОК 3: ПАЙПЛАЙН ДЕОБФУСКАЦИИ И СПЕЛЛЕРА (ГЛАВНАЯ КИЛЛЕР-ФИЧА) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                  Конвейер нормализации текста
                </div>
                <div className="text-xs font-semibold text-slate-700">
                  Сначала восстанавливаем слова — иначе маскировка прячет угрозу от алгоритмов
                </div>
              </div>

              {/* Переключатель Raw / Normalized */}
              <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setViewMode('normalized')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    viewMode === 'normalized'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Деобфусцированный
                </button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    viewMode === 'raw'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Исходный (RAW)
                </button>
              </div>
            </div>

            {/* Таблица спеллера (исправлений) */}
            {fixes.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 flex items-center justify-between border-b border-slate-200">
                  <span>Восстановленные обфусцированные токены ({fixes.length})</span>
                  <span className="text-[10px] font-mono text-slate-400">Spellcheck Pre-Processor</span>
                </div>
                <table className="table table-xs w-full">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th>Маскировка</th>
                      <th>Восстановлено</th>
                      <th>Метод детекции</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fixes.map((f, i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="font-mono text-red-600 bg-red-500/5 px-2 py-1.5 font-bold">
                          {f.original}
                        </td>
                        <td className="font-mono text-emerald-600 bg-emerald-500/5 px-2 py-1.5 font-bold">
                          {f.suggested}
                        </td>
                        <td className="text-xs text-slate-500 font-mono">
                          {spellerSourceLabel(f.source)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Текстовое полотно письма */}
            <div className="relative rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed max-h-48 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-slate-800">
                {viewMode === 'normalized' ? highlightedNorm : highlightedClean}
              </pre>
            </div>
          </div>

          {/* БЛОК 4: THREAT INTELLIGENCE ДЛЯ ССЫЛОК (IoC) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                Анализ URL и сетевых IoC ({msg.links.length})
              </div>
              <span className="text-[11px] font-mono text-slate-400">Reputation &amp; Heuristics</span>
            </div>

            {msg.links.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">Сетевых ссылок в теле письма не обнаружено.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {msg.links.map((l, i) => {
                  const score = l.reputationScore ?? 0;
                  const reasons = asReasons(l.details);
                  const isMalicious = l.status === 'MALICIOUS' || score >= 70;

                  return (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border flex flex-col gap-2 ${
                        isMalicious
                          ? 'border-red-200 bg-red-50/20'
                          : 'border-slate-200 bg-slate-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold truncate text-slate-900 select-all">
                          {l.url}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono tracking-wide uppercase shrink-0 ${
                          l.status === 'MALICIOUS'
                            ? 'bg-red-500 text-white'
                            : l.status === 'SUSPICIOUS'
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {linkStatusLabel(l.status)}
                        </span>
                      </div>

                      {/* Индикатор угрозы */}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500 font-medium">Индекс угрозы:</span>
                        <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              score >= 70 ? 'bg-red-500' : score >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.max(5, score)}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-slate-800">{score}%</span>
                      </div>

                      {/* Причины скоринга */}
                      {reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {reasons.map((r, j) => (
                            <span
                              key={j}
                              className="text-[11px] px-2 py-0.5 rounded bg-slate-200/60 text-slate-600"
                            >
                              • {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* БЛОК 5: ЖУРНАЛ МАРШРУТИЗАЦИИ (AUDIT & SOAR TIMELINE) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold mb-3">
              Аудит доставки и маршрутизация (SOAR Log)
            </div>

            {msg.deliveries.length === 0 ? (
              <span className="text-xs text-slate-400">Записей отправки пока нет.</span>
            ) : (
              <div className="relative pl-4 border-l-2 border-slate-200 flex flex-col gap-4">
                {msg.deliveries.map((d, i) => (
                  <div key={i} className="relative">
                    {/* Точка на таймлайне */}
                    <span
                      className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-white ${
                        d.success ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />
                    <div className="text-xs">
                      <div className="font-medium text-slate-900 flex items-center gap-2">
                        <span>{actionLabel(d.actionTaken)}</span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {d.attemptedAt ? formatDate(d.attemptedAt) : ''}
                        </span>
                      </div>
                      <div className="font-mono text-slate-500 text-[11px] mt-0.5">
                        Направлено: <b className="text-slate-700">{d.destinationRecipients.join(', ')}</b>
                      </div>
                      {d.smtpResponse && (
                        <div className="text-[11px] text-slate-400 mt-0.5 italic">
                          Статус: {routeLabel(d.smtpResponse)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* КНОПКИ РЕАГИРОВАНИЯ (SOAR ACTIONS) */}
          {actionable && (
            <div className="sticky bottom-0 bg-white/95 backdrop-blur p-4 -mx-6 -mb-6 border-t border-slate-200 flex flex-col gap-3">

              {!confirmRelease && !confirmForward && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmRelease(true)}
                    disabled={busy}
                    className="btn btn-sm btn-outline flex-1 text-xs"
                  >
                    Выпустить из карантина
                  </button>
                  {msg.status === 'REROUTED' && (
                    <button
                      onClick={() => setConfirmForward(true)}
                      disabled={busy}
                      className="btn btn-sm btn-primary flex-1 text-xs"
                    >
                      Передать на расследование ИБ
                    </button>
                  )}
                </div>
              )}

              {/* Подтверждение выпуска */}
              {confirmRelease && (
                <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 flex flex-col gap-2">
                  <div className="text-xs text-amber-900 font-medium">
                    Оригинал письма будет отправлен адресату <b className="font-mono">{msg.recipientEmail}</b>. Событие фиксируется в журнале аудита.
                  </div>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Обоснование решения (обязательно для аудита)"
                    maxLength={500}
                    className="input input-sm input-bordered w-full text-xs"
                  />
                  <div className="flex gap-2">
                    <button onClick={release} disabled={busy || !reason.trim()} className="btn btn-sm btn-warning text-xs flex-1">
                      {busy ? 'Выпуск…' : 'Подтвердить выпуск'}
                    </button>
                    <button onClick={() => { setConfirmRelease(false); setReason(''); }} className="btn btn-sm btn-ghost text-xs">
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Подтверждение отправки безопаснику */}
              {confirmForward && (
                <div className="p-3 rounded-xl border border-blue-300 bg-blue-50 flex flex-col gap-2">
                  <div className="text-xs text-blue-900 font-medium">
                    Инцидент будет передан дежурному офицеру безопасности. Письмо сменит статус на «Отправлено в ИБ» и уйдёт из карантина, отправка пишется в аудит. Повторно отправить нельзя.
                  </div>
                  <input
                    value={extraEmail}
                    onChange={(e) => setExtraEmail(e.target.value)}
                    placeholder="Дополнительный адрес офицера (необязательно)"
                    maxLength={200}
                    className="input input-sm input-bordered font-mono text-xs w-full"
                  />
                  <input
                    value={forwardReason}
                    onChange={(e) => setForwardReason(e.target.value)}
                    placeholder="Комментарий к инциденту (необязательно)"
                    maxLength={500}
                    className="input input-sm input-bordered text-xs w-full"
                  />
                  <div className="flex gap-2">
                    <button onClick={forward} disabled={busy} className="btn btn-sm btn-info text-xs flex-1">
                      {busy ? 'Передача…' : 'Передать инцидент'}
                    </button>
                    <button onClick={() => { setConfirmForward(false); setExtraEmail(''); setForwardReason(''); }} className="btn btn-sm btn-ghost text-xs">
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
