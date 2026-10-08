'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Paperclip, AlertTriangle } from 'lucide-react';
import FullPageLoader from '@/components/FullPageLoader';
import { ApiError, downloadAttachment, getMessage, reprocessMessage } from '@/lib/api';
import { formatDate, formatSize } from '@/lib/format';
import type { MessageDto } from '@/lib/types';
import { categoryLabel, folderStatusLabel, statusLabel } from '@/lib/labels';
import { TERMINAL_STATUSES } from '@/lib/types';

interface Props {
  id: string;
  token: string;
  folder: 'inbox' | 'sent';
  onBack: () => void;
  onChanged: () => void;
}

function StatusBadge({ status, folder }: { status: string; folder: 'inbox' | 'sent' }) {
  const cls =
    status === 'DELIVERED'
      ? folder === 'sent'
        ? 'bg-emerald-100/80 text-emerald-700 border-emerald-200/60'
        : 'bg-white/60 text-slate-600 border-white/60'
      : status === 'FORWARDED'
        ? 'bg-blue-100/80 text-blue-700 border-blue-200/60'
        : status === 'REROUTED' || status === 'FAILED'
          ? 'bg-rose-100/80 text-rose-700 border-rose-200/60'
          : 'bg-amber-100/80 text-amber-700 border-amber-200/60';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {folderStatusLabel(status, folder)}
    </span>
  );
}

export default function ReaderView({ id, token, folder, onBack, onChanged }: Props) {
  const [msg, setMsg] = useState<MessageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await getMessage(token, id);
        if (alive) {
          setMsg(d);
          setError(null);
        }
      } catch (e) {
        if (alive) {
          if (e instanceof ApiError && e.status === 404) {
            setError('Письмо недоступно');
            failedRef.current = true;
            setFailed(true);
          } else {
            setError(e instanceof ApiError ? e.message : 'Ошибка сети');
          }
        }
      }
    };
    load();
    const t = setInterval(async () => {
      if (failedRef.current) return;
      try {
        const d = await getMessage(token, id);
        if (alive) setMsg(d);
      } catch {
        /* следующий тик */
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, token]);

  const analyzing = msg !== null && !TERMINAL_STATUSES.includes(msg.status);

  const reprocess = async () => {
    setReprocessing(true);
    try {
      await reprocessMessage(token, id);
      const d = await getMessage(token, id);
      setMsg(d);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setReprocessing(false);
    }
  };

  const download = async (attId: string, filename: string) => {
    setDownloading(attId);
    try {
      await downloadAttachment(token, id, attId, filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка скачивания');
    } finally {
      setDownloading(null);
    }
  };

  const btnOutline =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ' +
    'bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700 ' +
    'hover:bg-white/90 disabled:opacity-50 transition ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]';

  return (
    <div className="relative flex flex-col flex-1 min-w-0 rounded-2xl overflow-hidden
                    bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                    border border-white/50
                    shadow-[0_8px_32px_rgba(31,38,135,0.10),inset_0_1px_0_rgba(255,255,255,0.85)]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/50">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/70 transition"
          title="Назад к списку"
          aria-label="Назад к списку"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {msg && <StatusBadge status={msg.status} folder={folder} />}

        <button
          onClick={reprocess}
          disabled={reprocessing || !msg}
          className={`ml-auto ${btnOutline}`}
          title="Вернуть письмо в очередь анализа"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${reprocessing ? 'animate-spin' : ''}`} />
          {reprocessing ? '…' : 'Перепроверить'}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 mx-4 mt-3 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
          {error}
        </div>
      )}

      {!msg ? (
        failed ? null : <FullPageLoader variant="inline" label="Открываем письмо…" />
      ) : (
        <div className="flex flex-col max-w-3xl gap-4 p-6 overflow-y-auto">
          <h2 className="text-xl font-bold text-slate-900">
            {msg.subject || '(без темы)'}
          </h2>

          <div className="rounded-xl p-3 text-sm
                          bg-white/50 backdrop-blur-sm border border-white/60
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="flex flex-col gap-1 text-slate-600">
              <div>
                От: <b className="font-mono text-slate-800">{msg.senderEmail}</b>
              </div>
              <div>
                Кому: <b className="font-mono text-slate-800">{msg.recipientEmail}</b>
              </div>
              <div className="font-mono text-xs text-slate-400">{formatDate(msg.createdAt)}</div>
            </div>
          </div>

          {analyzing && (
            <div className="px-3 py-2 text-sm border rounded-lg bg-amber-50/80 backdrop-blur-sm border-amber-200/60 text-amber-800">
              Анализ выполняется… статус: {statusLabel(msg.status)}
            </div>
          )}

          {msg.status === 'FAILED' && (
            <div className="px-3 py-2 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
              Не доставлено{msg.lastError ? `: ${msg.lastError}` : ''}. Проверьте адрес и relay шлюза.
            </div>
          )}

          {!analyzing && msg.verdict && msg.verdict !== 'NONE' && msg.status !== 'DELIVERED' && (
            <div className="flex items-start gap-2 px-3 py-2 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Вердикт фильтра: <b>{categoryLabel(msg.verdict)}</b>
                {msg.threat?.confidence != null && (
                  <> — уверенность {(msg.threat.confidence * 100).toFixed(0)}%</>
                )}
                {msg.status === 'REROUTED' && <> — письмо не доставлено, ушло в карантин</>}
                {msg.status === 'FORWARDED' && <> — получателю не доставлено, копия отправлена безопасникам</>}
              </span>
            </div>
          )}

          {msg.verdict && msg.verdict !== 'NONE' && msg.status === 'DELIVERED' && (
            <div className="px-3 py-2 text-sm border rounded-lg bg-white/60 backdrop-blur-sm border-white/60 text-slate-600">
              Проверено шлюзом
              {(msg.deliveries ?? []).some((d) => d.actionTaken === 'RELEASED_BY_ADMIN') && (
                <> — выпущено администратором</>
              )}.
            </div>
          )}

          <div className="rounded-xl p-4 text-sm leading-relaxed
                          bg-white/40 backdrop-blur-sm border border-white/60
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <pre className="font-sans whitespace-pre-wrap text-slate-800">
              {msg.cleanText?.trim()
                ? msg.cleanText
                : (msg.attachments ?? []).length > 0
                  ? `Текста нет — только ${(msg.attachments ?? []).map((a) => `${a.filename} (${formatSize(a.sizeBytes)})`).join(', ')}.`
                  : '(пустое письмо)'}
            </pre>
          </div>

          {(msg.attachments ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(msg.attachments ?? []).map((a) => (
                <button
                  key={a.id}
                  onClick={() => download(a.id, a.filename)}
                  disabled={downloading === a.id}
                  className={btnOutline}
                  title={a.contentType ?? ''}
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {a.filename} ({formatSize(a.sizeBytes)}){downloading === a.id ? ' …' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}