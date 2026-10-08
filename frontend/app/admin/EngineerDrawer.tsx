// frontend/app/admin/EngineerDrawer.tsx
'use client';

import { useState } from 'react';
import { ApiError, downloadAttachment, forwardMessage, getMessage, releaseMessage, reprocessMessage } from '@/lib/api';
import { formatDateTime, formatSize } from '@/lib/format';
import {
  attachmentReasonLabel,
  categoryLabel,
  linkReasonLabel,
  linkStatusLabel,
  parseDeliveryStep,
  severityBorderClass,
  severityDotClass,
  spellerSourceLabel,
  statusLabel,
} from '@/lib/labels';
import { CloseIcon, RefreshIcon, WarnIcon } from '@/components/icons';
import { useHighlighted, threatTerms } from '@/lib/highlight';
import type { MessageDto, SpellerFix } from '@/lib/types';

interface Props {
  msg: MessageDto;
  token: string;
  onClose: () => void;
  onReprocessed: (fresh: MessageDto) => void;
  /** release/forward: шторка закрывается, родитель следит за письмом без сброса фильтров. */
  onResolved: (status: string) => void;
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

function extractBody(raw: string | null): string | null {
  if (!raw) return null;
  const norm = raw.replace(/\r\n/g, '\n');
  const blank = norm.search(/\n\s*\n/);
  let body = blank >= 0 ? norm.slice(blank).trim() : norm.trim();
  if (blank < 0) {
    const lines = body.split('\n').filter(
      (ln) =>
        !/^(received|from|to|cc|date|subject|content-type|content-transfer-encoding|mime-version|message-id|return-path|dkim-.*):/i.test(
          ln.trim(),
        ),
    );
    body = lines.join('\n').trim();
  }
  return body || null;
}

function parseTriggerTag(flag: string): { type: string; value: string; badgeCls: string } {
  const hidden = /^hidden-chars:(\d+)$/.exec(flag);
  if (hidden) {
    return {
      type: 'СКРЫТЫЕ СИМВОЛЫ',
      value: `${hidden[1]} шт.`,
      badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
    };
  }
  const att = /^attachment:(.+)$/i.exec(flag);
  if (att) {
    return {
      type: 'ВЛОЖЕНИЕ',
      value: attachmentReasonLabel(att[1]),
      badgeCls: 'bg-red-100 text-red-800 border-red-300',
    };
  }
  const m = /^(stopword|profanity|terrorism|man_made|illegal_actions|other_threat):(.*)$/i.exec(flag);
  if (!m) {
    return {
      type: 'СИГНАТУРА',
      value: flag,
      badgeCls: 'bg-red-100 text-red-800 border-red-300',
    };
  }
  const head = m[1].toLowerCase();
  const val = m[2];
  if (head === 'profanity') {
    return {
      type: 'МАТ',
      value: `«${val}»`,
      badgeCls: 'bg-rose-100 text-rose-800 border-rose-300',
    };
  }
  if (head === 'stopword') {
    return {
      type: 'СТОП-СЛОВО',
      value: `«${val}»`,
      badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
    };
  }
  return {
    type: 'УГРОЗА',
    value: `«${val}»`,
    badgeCls: 'bg-red-100 text-red-800 border-red-300',
  };
}

function ScoreBar({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  const color = pct >= 70 ? 'bg-red-500' : pct >= 40 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-500 font-medium">{label}</span>
        <span className="font-mono font-bold text-slate-800">{pct}%</span>
      </div>
      <div className="bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

export default function EngineerDrawer({ msg, token, onClose, onReprocessed, onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmForward, setConfirmForward] = useState(false);
  const [extraEmail, setExtraEmail] = useState('');
  const [forwardReason, setForwardReason] = useState('');
  const [viewMode, setViewMode] = useState<'normalized' | 'raw'>('normalized');
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (attId: string, filename: string) => {
    setDownloading(attId);
    try {
      await downloadAttachment(token, msg.id, attId, filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка скачивания');
    } finally {
      setDownloading(null);
    }
  };

  const flags = msg.threat?.heuristicFlags ?? [];
  const fixes = asSpellerFixes(msg.threat?.spellerFixes);
  const terms = threatTerms(flags, fixes, msg.links ?? []);

  const originalBody = msg.cleanText ?? extractBody(msg.rawText ?? null);
  const highlightedNorm = useHighlighted(msg.normalizedText, terms);
  const highlightedRaw = useHighlighted(originalBody, terms);

  const confidencePct = Math.round((msg.threat?.confidence ?? 0) * 100);
  const heuristicPct =
    msg.threat?.heuristicScore != null ? Math.round(msg.threat.heuristicScore * 100) : null;
  // Бар модели — сырой скор SLM и только при её категории (иначе confidence вердикта врёт).
  const modelPct =
    msg.threat?.semanticCategory != null && msg.threat.semanticCategory !== 'NONE' && msg.threat.semanticScore != null
      ? Math.round(msg.threat.semanticScore * 100)
      : null;
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
      const fresh = await getMessage(token, msg.id);
      setConfirmRelease(false);
      setReason('');
      onResolved(fresh.status);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const forward = async () => {
    const extra = extraEmail.trim();
    if (extra && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra)) {
      setError('Проверьте адрес электронной почты');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await forwardMessage(token, msg.id, {
        ...(extra ? { emails: [extra] } : {}),
        ...(forwardReason.trim() ? { reason: forwardReason.trim() } : {}),
      });
      const fresh = await getMessage(token, msg.id);
      setConfirmForward(false);
      setExtraEmail('');
      setForwardReason('');
      onResolved(fresh.status);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

      <div className="relative w-[920px] max-w-full max-h-[95vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-800">
        {/* ШАПКА КАРТОЧКИ */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                КАРТОЧКА ИНЦИДЕНТА
              </span>
              <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded">
                #{msg.id.slice(0, 8)}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                  msg.status === 'REROUTED'
                    ? 'bg-red-100 text-red-700 border border-red-200'
                    : msg.status === 'FORWARDED'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                }`}
              >
                {statusLabel(msg.status)}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate mt-0.5">
              {msg.subject || '(Без темы)'}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={reprocess}
              disabled={busy}
              className="btn btn-sm btn-outline gap-1.5 text-xs font-medium bg-white"
              title="Перезапустить пайплайн анализа"
            >
              <RefreshIcon className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Перепроверить
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 shrink-0">
            <WarnIcon className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ОСНОВНОЙ КОНТЕНТ СО СКРОЛЛОМ */}
        <div className="p-6 overflow-y-auto flex flex-col gap-5">
          {/* БЛОК 1: ПАРАМЕТРЫ + ВЕРДИКТ БЕЗОПАСНОСТИ */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Параметры доставки */}
            <div className="md:col-span-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block mb-2.5">
                  Маршрут конверта
                </span>
                <div className="space-y-2">
                  <div>
                    <div className="text-slate-400 text-[11px]">Отправитель</div>
                    <div className="font-mono text-slate-900 font-semibold break-all select-all">
                      {msg.senderEmail}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Кому предназначалось</div>
                    <div className="font-mono text-slate-900 font-semibold break-all select-all">
                      {msg.recipientEmail}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Время поступления</div>
                    <div className="text-slate-700 font-medium">
                      {formatDateTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
              {(msg.attachments ?? []).length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-200 flex flex-col gap-1.5">
                  {(msg.attachments ?? []).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => download(a.id, a.filename)}
                        disabled={downloading === a.id}
                        className="text-xs px-2.5 py-1 border rounded-full hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1 text-slate-700"
                        title={a.contentType ?? ''}
                      >
                        {a.filename} ({formatSize(a.sizeBytes)}){downloading === a.id ? ' …' : ''}
                      </button>
                      {a.threat && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300">
                          Опасное вложение
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Вердикт безопасности */}
            <div
              className={`md:col-span-7 rounded-xl border border-l-4 ${severityBorderClass(
                msg.threat?.category ?? msg.verdict,
              )} bg-white p-4 shadow-sm flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${severityDotClass(msg.threat?.category ?? msg.verdict)}`} />
                    <span className="text-xs uppercase font-bold text-slate-400">Вердикт шлюза</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    Риск: {Math.max(confidencePct, heuristicPct ?? 0)}%
                  </span>
                </div>

                <div className="text-lg font-black text-slate-900 mb-1">
                  {categoryLabel(msg.threat?.category ?? msg.verdict)}
                </div>

                <p className="text-xs leading-relaxed text-slate-600 mb-3">
                  {msg.threat?.explanation || 'Аномалий или угроз в содержимом не выявлено.'}
                </p>

                {/* Комментарий SLM: итог нейросетевой модели одной строкой */}
                {msg.threat && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-3">
                    <div className="text-[10px] font-mono uppercase font-bold text-slate-400 mb-1">
                      Комментарий SLM
                      {msg.threat.semanticCategory && msg.threat.semanticCategory !== 'NONE' && (
                        <> · {categoryLabel(msg.threat.semanticCategory)}
                          {msg.threat.semanticScore != null && (
                            <> — {(msg.threat.semanticScore * 100).toFixed(0)}%</>
                          )}
                        </>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-700">
                      {msg.threat.semanticComment
                        || 'Комментарий отсутствует — письмо обработано до обновления.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Метрики скоринга: Сигнатурный анализ vs Нейросетевая модель */}
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                <ScoreBar pct={heuristicPct} label="Сигнатурный анализ" />
                <ScoreBar pct={modelPct} label="Нейросетевая модель" />
              </div>
            </div>
          </div>

          {/* БЛОК 2: ДОКАЗАТЕЛЬНАЯ БАЗА (СБАЛАНСИРОВАННАЯ 3-КОЛОНОЧНАЯ ПАНЕЛЬ) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider">
                Факторы риска и сработавшие проверки
              </span>
              <span className="text-[11px] text-slate-400">
                Триггеры: <b className="text-slate-700">{flags.length}</b> • Подмены: <b className="text-slate-700">{fixes.length}</b> • Ссылки: <b className="text-slate-700">{msg.links.length}</b>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Колонка 1: Сигнатуры и стоп-слова */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 flex flex-col justify-between min-h-[140px]">
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                    <span>Сигнатуры и маркеры</span>
                    <span className={`badge badge-sm font-bold ${flags.length > 0 ? 'badge-error text-white' : 'badge-ghost'}`}>
                      {flags.length}
                    </span>
                  </div>

                  {flags.length === 0 ? (
                    <div className="text-xs text-slate-400 py-4 text-center">Стоп-слов не зафиксировано</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                      {flags.map((f, i) => {
                        const parsed = parseTriggerTag(f);
                        return (
                          <div
                            key={i}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${parsed.badgeCls}`}
                          >
                            <span className="text-[9px] font-bold tracking-wider opacity-75">{parsed.type}</span>
                            <span className="font-mono font-bold">{parsed.value}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Колонка 2: Деобфускация (Спеллер) */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 flex flex-col justify-between min-h-[140px]">
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                    <span>Скрытая маскировка</span>
                    <span className={`badge badge-sm font-bold ${fixes.length > 0 ? 'badge-warning' : 'badge-ghost'}`}>
                      {fixes.length}
                    </span>
                  </div>

                  {fixes.length === 0 ? (
                    <div className="text-xs text-emerald-600 font-medium py-4 text-center flex flex-col items-center justify-center gap-1">
                      <span className="text-base">✓</span>
                      <span>Подмены символов нет</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-36 overflow-y-auto">
                      <table className="table table-xs w-full">
                        <thead>
                          <tr className="text-slate-400 text-[10px]">
                            <th>Скрыто</th>
                            <th>Распознано</th>
                            <th>Метод</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fixes.map((f, i) => (
                            <tr key={i}>
                              <td className="font-mono text-red-600 font-bold line-through">{f.original}</td>
                              <td className="font-mono text-emerald-600 font-bold">{f.suggested}</td>
                              <td className="text-[10px] text-slate-400">{spellerSourceLabel(f.source)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Колонка 3: Сетевые URL */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 flex flex-col justify-between min-h-[140px]">
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                    <span>Внешние ссылки (IoC)</span>
                    <span className={`badge badge-sm font-bold ${msg.links.length > 0 ? 'badge-info' : 'badge-ghost'}`}>
                      {msg.links.length}
                    </span>
                  </div>

                  {msg.links.length === 0 ? (
                    <div className="text-xs text-emerald-600 font-medium py-4 text-center flex flex-col items-center justify-center gap-1">
                      <span className="text-base">✓</span>
                      <span>Внешних ссылок нет</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {msg.links.map((l, i) => {
                        const score = l.reputationScore ?? 0;
                        const reasons = asReasons(l.details);
                        const isMal = l.status === 'MALICIOUS' || score >= 70;
                        return (
                          <div
                            key={i}
                            className={`p-1.5 rounded border text-[11px] flex flex-col gap-1 ${
                              isMal ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-mono font-bold text-slate-800 truncate select-all">
                                {l.url}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                                  isMal ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {linkStatusLabel(l.status)}
                              </span>
                            </div>
                            {reasons.length > 0 && (
                              <div className="text-[10px] text-slate-500 truncate">
                                {reasons.join(', ')}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* БЛОК 3: ТЕКСТ ПИСЬМА С МАРКИРОВКОЙ */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                  Содержимое письма
                </span>
                <span className="text-xs text-slate-500">
                  Подсвечены обнаруженные сигнатуры, стоп-слова и скрытые токены
                </span>
              </div>

              {/* Переключатель вида */}
              <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setViewMode('normalized')}
                  className={`px-3 py-1 rounded transition ${
                    viewMode === 'normalized'
                      ? 'bg-white text-slate-900 shadow-sm font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                  title="Текст после снятия маскировки (как его распознали фильтры)"
                >
                  Снятая маскировка (ИИ-вид)
                </button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-3 py-1 rounded transition ${
                    viewMode === 'raw'
                      ? 'bg-white text-slate-900 shadow-sm font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                  title="Оригинальный текст без обработки"
                >
                  Оригинальный вид
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-sm leading-relaxed max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-slate-800">
                {viewMode === 'normalized' ? highlightedNorm : highlightedRaw}
              </pre>
            </div>
          </div>

          {/* БЛОК 4: ХРОНИКА И АУДИТ ДЕЙСТВИЙ (SOAR) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block mb-3">
              Журнал действий шлюза (SOAR Audit Log)
            </span>

            {msg.deliveries.length === 0 ? (
              <div className="text-xs text-slate-400">Событий перемещения пока не зарегистрировано.</div>
            ) : (
              <div className="relative pl-6 border-l-2 border-slate-200 space-y-3.5 my-1">
                {msg.deliveries.map((d, i) => {
                  const step = parseDeliveryStep(
                    d.actionTaken,
                    d.smtpResponse,
                    d.destinationRecipients,
                    msg.recipientEmail,
                  );
                  return (
                    <div key={i} className="relative">
                      <span
                        className={`absolute -left-[31px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                          d.success ? 'bg-blue-600' : 'bg-red-600'
                        }`}
                      />

                      <div className="text-xs bg-slate-50/70 p-3 rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">{step.title}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${step.badgeColor}`}>
                              {step.badge}
                            </span>
                          </div>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {d.attemptedAt ? formatDateTime(d.attemptedAt) : ''}
                          </span>
                        </div>

                        <p className="text-slate-600 mb-1.5">{step.description}</p>

                        <div className="text-[11px] font-mono text-slate-500">
                          {step.recipientsLabel}{' '}
                          <b className="text-slate-800">{step.recipients.join(', ') || '—'}</b>
                        </div>

                        {step.comment && (
                          <div className="mt-1.5 text-[11px] bg-white p-1.5 rounded border border-slate-200 text-slate-700 italic">
                            Комментарий офицера: «{step.comment}»
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* НИЖНЯЯ ПАНЕЛЬ ДЕЙСТВИЙ */}
        {actionable && (
          <div className="bg-slate-50 border-t border-slate-200 p-4 shrink-0 flex flex-col gap-3">
            {!confirmRelease && !confirmForward && (
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmRelease(true)}
                  disabled={busy}
                  className="btn btn-sm btn-outline flex-1 text-xs"
                >
                  Разблокировать и доставить адресату
                </button>
                {msg.status === 'REROUTED' && (
                  <button
                    onClick={() => setConfirmForward(true)}
                    disabled={busy}
                    className="btn btn-sm btn-primary flex-1 text-xs"
                  >
                    Эскалировать офицеру ИБ на расследование
                  </button>
                )}
              </div>
            )}

            {/* Подтверждение выпуска */}
            {confirmRelease && (
              <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/70 flex flex-col gap-2">
                <div className="text-xs text-amber-900 font-medium">
                  Оригинал письма будет отправлен адресату <b className="font-mono">{msg.recipientEmail}</b>. Событие фиксируется в аудите.
                </div>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Обоснование решения (для журнала аудита)"
                  maxLength={500}
                  className="input input-sm input-bordered w-full text-xs bg-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={release}
                    disabled={busy || !reason.trim()}
                    className="btn btn-sm btn-warning text-xs flex-1"
                  >
                    {busy ? 'Выпуск…' : 'Подтвердить выпуск'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmRelease(false);
                      setReason('');
                    }}
                    className="btn btn-sm btn-ghost text-xs"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {/* Подтверждение эскалации */}
            {confirmForward && (
              <div className="p-3 rounded-xl border border-blue-300 bg-blue-50/70 flex flex-col gap-2">
                <div className="text-xs text-blue-900 font-medium">
                  Инцидент будет передан дежурному специалисту безопасности. Статус изменится на «На расследовании в ИБ».
                </div>
                <input
                  value={extraEmail}
                  onChange={(e) => setExtraEmail(e.target.value)}
                  placeholder="Дополнительный email безопасника (необязательно)"
                  maxLength={200}
                  className="input input-sm input-bordered font-mono text-xs w-full bg-white"
                />
                <input
                  value={forwardReason}
                  onChange={(e) => setForwardReason(e.target.value)}
                  placeholder="Примечание к инциденту (необязательно)"
                  maxLength={500}
                  className="input input-sm input-bordered text-xs w-full bg-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={forward}
                    disabled={busy}
                    className="btn btn-sm btn-info text-xs flex-1"
                  >
                    {busy ? 'Передача…' : 'Подтвердить эскалацию'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmForward(false);
                      setExtraEmail('');
                      setForwardReason('');
                    }}
                    className="btn btn-sm btn-ghost text-xs"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}