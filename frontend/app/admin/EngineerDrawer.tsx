'use client';

import { useState } from 'react';
import { X, RefreshCw, AlertTriangle, Shield, Send, Unlock, CheckCircle2 } from 'lucide-react';
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
import { useHighlighted, threatTerms } from '@/lib/highlight';
import type { MessageDto, SpellerFix } from '@/lib/types';

interface Props {
  msg: MessageDto;
  token: string;
  onClose: () => void;
  onReprocessed: (fresh: MessageDto) => void;
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


function parseTriggerTag(flag: string): {
  type: string;
  value: string;
  severity: 'high' | 'medium' | 'low';
} {
  const hidden = /^hidden-chars:(\d+)$/.exec(flag);
  if (hidden) return { type: 'Скрытые символы', value: `${hidden[1]} шт.`, severity: 'medium' };

  const att = /^attachment:(.+)$/i.exec(flag);
  if (att) return { type: 'Вложение', value: attachmentReasonLabel(att[1]), severity: 'high' };
  const m = /^(stopword|profanity|terrorism|man_made|illegal_actions|other_threat):(.*)$/i.exec(flag);
  if (!m) return { type: 'Сигнатура', value: flag, severity: 'high' };

  const head = m[1].toLowerCase();
  const val = m[2];
  if (head === 'profanity') return { type: 'Мат', value: `«${val}»`, severity: 'medium' };
  if (head === 'stopword') return { type: 'Стоп-слово', value: `«${val}»`, severity: 'medium' };
  return { type: 'Угроза', value: `«${val}»`, severity: 'high' };
}

function severityDot(sev: 'high' | 'medium' | 'low'): string {
  if (sev === 'high') return 'bg-rose-500';
  if (sev === 'medium') return 'bg-amber-500';
  return 'bg-slate-400';
}

function ScoreBar({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  const color = pct >= 70 ? 'bg-rose-500' : pct >= 40 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="font-mono font-bold text-slate-800">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden border rounded-full bg-white/60 border-white/70">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

function Chip({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs
                  bg-white/60 backdrop-blur-sm border border-white/60 text-slate-700
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${className}`}
    >
      {children}
    </span>
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

  const btnNeutral =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ' +
    'bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700 ' +
    'hover:bg-white/90 disabled:opacity-50 transition ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]';

  const inputCls =
    'px-3 py-2 rounded-lg text-xs outline-none transition w-full ' +
    'bg-white/70 backdrop-blur-sm border border-white/70 text-slate-800 ' +
    'placeholder:text-slate-400 ' +
    'focus:bg-white/90 focus:ring-2 focus:ring-blue-300/70';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 overflow-hidden sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-3/4 max-w-full h-6/7 max-h-[95vh] flex flex-col overflow-hidden
                      rounded-2xl
                      bg-white/60 backdrop-blur-2xl backdrop-saturate-150
                      border border-white/60
                      shadow-[0_20px_60px_rgba(15,23,42,0.35),inset_0_1px_0_rgba(255,255,255,0.9)]
                      text-slate-800">
        <div className="bg-white/40 backdrop-blur-xl border-b border-white/50 px-6 py-3.5 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                КАРТОЧКА ИНЦИДЕНТА
              </span>
              <span className="font-mono text-xs font-medium text-slate-500
                               bg-white/60 border border-white/60 px-2 py-0.5 rounded">
                #{msg.id.slice(0, 8)}
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                · {statusLabel(msg.status)}
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
              className={btnNeutral}
              title="Перезапустить пайплайн анализа"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Перепроверить
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-white/70 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 mx-6 mt-4 text-xs border rounded-lg shrink-0 bg-rose-50/70 backdrop-blur-sm border-rose-200/60 text-rose-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-5 p-6 overflow-y-auto">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-5 rounded-xl p-4 text-xs flex flex-col justify-between
                            bg-white/50 backdrop-blur-sm border border-white/60
                            shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <div>
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block mb-2.5">
                  Маршрут конверта
                </span>
                <div className="space-y-2.5">
                  <div>
                    <div className="text-slate-400 text-[11px]">Отправитель</div>
                    <div className="font-mono font-semibold break-all select-all text-slate-900">
                      {msg.senderEmail}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Кому предназначалось</div>
                    <div className="font-mono font-semibold break-all select-all text-slate-900">
                      {msg.recipientEmail}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Время поступления</div>
                    <div className="font-medium text-slate-700">
                      {formatDateTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
              {(msg.attachments ?? []).length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/50 flex flex-col gap-1.5">
                  {(msg.attachments ?? []).map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => download(a.id, a.filename)}
                        disabled={downloading === a.id}
                        className={btnNeutral}
                        title={a.contentType ?? ''}
                      >
                        {a.filename} ({formatSize(a.sizeBytes)}){downloading === a.id ? ' …' : ''}
                      </button>
                      {a.threat && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600">
                          <AlertTriangle className="w-3 h-3" />
                          Опасное вложение
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              className={`md:col-span-7 rounded-xl border border-l-4 ${severityBorderClass(
                msg.threat?.category ?? msg.verdict,
              )} bg-white/60 backdrop-blur-sm p-4 flex flex-col justify-between
              shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${severityDotClass(msg.threat?.category ?? msg.verdict)}`} />
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Вердикт шлюза
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-slate-600
                                   bg-white/70 border border-white/60 px-2 py-0.5 rounded">
                    Риск: {Math.max(confidencePct, heuristicPct ?? 0)}%
                  </span>
                </div>

                <div className="mb-1 text-lg font-black text-slate-900">
                  {categoryLabel(msg.threat?.category ?? msg.verdict)}
                </div>

                <p className="mb-3 text-xs leading-relaxed text-slate-600">
                  {msg.threat?.explanation || 'Аномалий или угроз в содержимом не выявлено.'}
                </p>

                {msg.threat && (
                  <div className="px-3 py-2 mb-3 border rounded-lg bg-white/40 backdrop-blur-sm border-white/60">
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

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/50">
                <ScoreBar pct={heuristicPct} label="Сигнатурный анализ" />
                <ScoreBar pct={modelPct} label="Нейросетевая модель" />
              </div>
            </div>
          </div>

          <div className="rounded-xl p-4 bg-white/50 backdrop-blur-sm border border-white/60
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider">
                Факторы риска и сработавшие проверки
              </span>
              <span className="text-[11px] text-slate-500">
                Триггеры <b className="text-slate-700">{flags.length}</b>
                <span className="mx-1.5 text-slate-300">·</span>
                Подмены <b className="text-slate-700">{fixes.length}</b>
                <span className="mx-1.5 text-slate-300">·</span>
                Ссылки <b className="text-slate-700">{msg.links.length}</b>
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/60 bg-white/40 p-3 flex flex-col min-h-[140px]">
                <div className="flex items-center justify-between mb-2 text-xs font-bold text-slate-700">
                  <span>Сигнатуры и маркеры</span>
                  <span className="text-[11px] font-mono text-slate-500">{flags.length}</span>
                </div>

                {flags.length === 0 ? (
                  <div className="py-6 text-xs text-center text-slate-400">Не зафиксировано</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                    {flags.map((f, i) => {
                      const p = parseTriggerTag(f);
                      return (
                        <Chip key={i}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${severityDot(p.severity)}`} />
                          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                            {p.type}
                          </span>
                          <span className="font-mono font-semibold text-slate-700">{p.value}</span>
                        </Chip>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/60 bg-white/40 p-3 flex flex-col min-h-[140px]">
                <div className="flex items-center justify-between mb-2 text-xs font-bold text-slate-700">
                  <span>Скрытая маскировка</span>
                  <span className="text-[11px] font-mono text-slate-500">{fixes.length}</span>
                </div>

                {fixes.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-6 text-xs text-center text-slate-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Подмены символов нет</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto overflow-y-auto max-h-40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
                          <th className="py-1 font-bold text-left">Скрыто</th>
                          <th className="py-1 font-bold text-left">Распознано</th>
                          <th className="py-1 font-bold text-left">Метод</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fixes.map((f, i) => (
                          <tr key={i} className="border-t border-white/40">
                            <td className="py-1 font-mono line-through text-slate-500">{f.original}</td>
                            <td className="py-1 font-mono font-semibold text-slate-800">{f.suggested}</td>
                            <td className="py-1 text-[10px] text-slate-400">{spellerSourceLabel(f.source)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/60 bg-white/40 p-3 flex flex-col min-h-[140px]">
                <div className="flex items-center justify-between mb-2 text-xs font-bold text-slate-700">
                  <span>Внешние ссылки (IoC)</span>
                  <span className="text-[11px] font-mono text-slate-500">{msg.links.length}</span>
                </div>

                {msg.links.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-6 text-xs text-center text-slate-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Внешних ссылок нет</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {msg.links.map((l, i) => {
                      const score = l.reputationScore ?? 0;
                      const reasons = asReasons(l.details);
                      const isMal = l.status === 'MALICIOUS' || score >= 70;
                      return (
                        <div
                          key={i}
                          className={`p-2 rounded-md border text-[11px] flex flex-col gap-1 ${
                            isMal
                              ? 'bg-rose-50/60 border-rose-200/60'
                              : 'bg-white/60 border-white/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-mono font-semibold truncate select-all text-slate-800">
                              {l.url}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                                isMal
                                  ? 'bg-rose-500 text-white'
                                  : 'bg-slate-200 text-slate-600'
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

          <div className="rounded-xl p-4 bg-white/50 backdrop-blur-sm border border-white/60 flex flex-col gap-3
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                  Содержимое письма
                </span>
                <span className="text-xs text-slate-500">
                  Подсвечены обнаруженные сигнатуры, стоп-слова и скрытые токены
                </span>
              </div>

              <div className="relative inline-grid p-0.5 rounded-full
                              bg-white/60 backdrop-blur-sm border border-white/60
                              shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                   style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <span
                  aria-hidden
                  className="absolute top-0.5 bottom-0.5 left-0.5 rounded-full
                             bg-white/95 shadow-[0_1px_4px_rgba(0,0,0,0.10)]
                             transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
                  style={{
                    width: 'calc((100% - 0.25rem) / 2)',
                    transform: `translateX(${viewMode === 'normalized' ? 0 : 100}%)`,
                  }}
                />
                <button
                  onClick={() => setViewMode('normalized')}
                  className={`relative z-10 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap
                              transition-colors duration-500 ${
                                viewMode === 'normalized' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
                              }`}
                  title="Текст после снятия маскировки"
                >
                  Снятая маскировка
                </button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`relative z-10 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap
                              transition-colors duration-500 ${
                                viewMode === 'raw' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
                              }`}
                  title="Оригинальный текст без обработки"
                >
                  Оригинальный вид
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto text-sm leading-relaxed border rounded-lg border-white/60 bg-white/40 backdrop-blur-sm max-h-64">
              <pre className="font-sans whitespace-pre-wrap text-slate-800">
                {viewMode === 'normalized' ? highlightedNorm : highlightedRaw}
              </pre>
            </div>
          </div>

          <div className="rounded-xl p-4 bg-white/50 backdrop-blur-sm border border-white/60
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block mb-3">
              Журнал действий шлюза (SOAR Audit Log)
            </span>

            {msg.deliveries.length === 0 ? (
              <div className="text-xs text-slate-400">Событий перемещения пока не зарегистрировано.</div>
            ) : (
              <div className="relative pl-6 border-l-2 border-white/60 space-y-3.5 my-1">
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
                          d.success ? 'bg-slate-700' : 'bg-rose-500'
                        }`}
                      />

                      <div className="p-3 text-xs border rounded-lg bg-white/50 backdrop-blur-sm border-white/60">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{step.title}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
                          <div className="mt-1.5 text-[11px] bg-white/70 p-1.5 rounded border border-white/60 text-slate-600 italic">
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

        {actionable && (
          <div className="flex flex-col gap-3 p-4 border-t bg-white/40 backdrop-blur-xl border-white/50 shrink-0">
            {!confirmRelease && !confirmForward && (
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmRelease(true)}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                             bg-white/70 backdrop-blur-sm border border-white/70 text-slate-700
                             hover:bg-white/95 disabled:opacity-50 transition
                             shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Разблокировать и доставить адресату
                </button>
                {msg.status === 'REROUTED' && (
                  <button
                    onClick={() => setConfirmForward(true)}
                    disabled={busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                               bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition
                               shadow-[0_2px_8px_rgba(15,23,42,0.25)]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Эскалировать офицеру ИБ на расследование
                  </button>
                )}
              </div>
            )}

            {confirmRelease && (
              <div className="flex flex-col gap-2 p-3 border rounded-xl border-white/60 bg-white/50 backdrop-blur-sm">
                <div className="flex items-start gap-2 text-xs font-medium text-slate-700">
                  <Unlock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    Оригинал письма будет отправлен адресату{' '}
                    <b className="font-mono text-slate-900">{msg.recipientEmail}</b>. Событие фиксируется в аудите.
                  </span>
                </div>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Обоснование решения (для журнала аудита)"
                  maxLength={500}
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    onClick={release}
                    disabled={busy || !reason.trim()}
                    className="flex-1 px-3 py-2 text-xs font-medium text-white transition rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50"
                  >
                    {busy ? 'Выпуск…' : 'Подтвердить выпуск'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmRelease(false);
                      setReason('');
                    }}
                    className="px-3 py-2 text-xs font-medium transition rounded-lg text-slate-600 hover:bg-white/70"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {confirmForward && (
              <div className="flex flex-col gap-2 p-3 border rounded-xl border-white/60 bg-white/50 backdrop-blur-sm">
                <div className="flex items-start gap-2 text-xs font-medium text-slate-700">
                  <Send className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    Инцидент будет передан дежурному специалисту безопасности.
                    Статус изменится на «На расследовании в ИБ».
                  </span>
                </div>
                <input
                  value={extraEmail}
                  onChange={(e) => setExtraEmail(e.target.value)}
                  placeholder="Дополнительный email безопасника (необязательно)"
                  maxLength={200}
                  className={`${inputCls} font-mono`}
                />
                <input
                  value={forwardReason}
                  onChange={(e) => setForwardReason(e.target.value)}
                  placeholder="Примечание к инциденту (необязательно)"
                  maxLength={500}
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    onClick={forward}
                    disabled={busy}
                    className="flex-1 px-3 py-2 text-xs font-medium text-white transition rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50"
                  >
                    {busy ? 'Передача…' : 'Подтвердить эскалацию'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmForward(false);
                      setExtraEmail('');
                      setForwardReason('');
                    }}
                    className="px-3 py-2 text-xs font-medium transition rounded-lg text-slate-600 hover:bg-white/70"
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