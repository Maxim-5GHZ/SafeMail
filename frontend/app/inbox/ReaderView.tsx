'use client';

import { useEffect, useState } from 'react';
import { ApiError, downloadAttachment, getMessage, reprocessMessage } from '@/lib/api';
import { formatDate, formatSize } from '@/lib/format';
import type { MessageDto } from '@/lib/types';
import { categoryLabel, folderStatusLabel, statusLabel } from '@/lib/labels';
import { ClipIcon, WarnIcon } from '@/components/icons';
import { TERMINAL_STATUSES } from '@/lib/types';

interface Props {
  id: string;
  token: string;
  folder: 'inbox' | 'sent';
  onBack: () => void;
  onChanged: () => void;
}

function StatusBadge({ status, folder }: { status: string; folder: 'inbox' | 'sent' }) {
  const color =
    status === 'DELIVERED'
      ? folder === 'sent'
        ? 'bg-green-100 text-green-700'
        : 'bg-gray-100 text-gray-500'
      : status === 'FORWARDED'
        ? 'bg-blue-100 text-blue-700'
        : status === 'REROUTED' || status === 'FAILED'
          ? 'bg-red-100 text-red-700'
          : 'bg-amber-100 text-amber-700';
  return <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{folderStatusLabel(status, folder)}</span>;
}

export default function ReaderView({ id, token, folder, onBack, onChanged }: Props) {
  const [msg, setMsg] = useState<MessageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        // Карантин получателю не виден: бэк отдаёт 404 — показываем заглушку без намёка на блокировку.
        if (alive) setError(e instanceof ApiError && e.status === 404 ? 'Письмо недоступно' : e instanceof ApiError ? e.message : 'Ошибка сети');
      }
    };
    load();
    // Пока анализ идёт — подпитываем деталку; терминальный статус дальше не трогаем.
    const t = setInterval(async () => {
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

  return (
    <div className="flex-1 bg-white flex flex-col min-w-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200">
        <button onClick={onBack} className="text-gray-600 hover:text-black text-lg" title="Назад к списку">
          ←
        </button>
        {msg && <StatusBadge status={msg.status} folder={folder} />}
        <button
          onClick={reprocess}
          disabled={reprocessing || !msg}
          className="ml-auto text-xs px-3 py-1 border rounded-full hover:bg-gray-50 disabled:opacity-50"
          title="Вернуть письмо в очередь анализа"
        >
          {reprocessing ? '…' : '⟳ Перепроверить'}
        </button>
      </div>
      {error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      {!msg ? (
        <div className="p-8 text-gray-400">Загрузка…</div>
      ) : (
        <div className="p-6 max-w-3xl flex flex-col gap-4 overflow-y-auto">
          <h2 className="text-xl font-semibold">{msg.subject || '(без темы)'}</h2>
          <div className="text-sm text-gray-600">
            <div>
              От: <b className="text-gray-800">{msg.senderEmail}</b>
            </div>
            <div>
              Кому: <b className="text-gray-800">{msg.recipientEmail}</b>
            </div>
            <div>{formatDate(msg.createdAt)}</div>
          </div>
          {analyzing && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Анализ выполняется… статус: {statusLabel(msg.status)}
            </div>
          )}
          {msg.status === 'FAILED' && (
            <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              Не доставлено{msg.lastError ? `: ${msg.lastError}` : ''}. Проверьте адрес и relay шлюза.
            </div>
          )}
          {msg.verdict && msg.verdict !== 'NONE' && msg.status !== 'DELIVERED' && (
            <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-2">
              <WarnIcon className="w-4 h-4 shrink-0" />
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
            <div className="text-sm text-gray-600 bg-gray-100 rounded-lg px-3 py-2">
              Проверено шлюзом
              {(msg.deliveries ?? []).some((d) => d.actionTaken === 'RELEASED_BY_ADMIN') && (
                <> — выпущено администратором</>
              )}.
            </div>
          )}
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
            {msg.cleanText?.trim()
              ? msg.cleanText
              : (msg.attachments ?? []).length > 0
                ? `Текста нет — только ${(msg.attachments ?? []).map((a) => `${a.filename} (${formatSize(a.sizeBytes)})`).join(', ')}.`
                : '(пустое письмо)'}
          </pre>
          {(msg.attachments ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(msg.attachments ?? []).map((a) => (
                <button
                  key={a.id}
                  onClick={() => download(a.id, a.filename)}
                  disabled={downloading === a.id}
                  className="text-xs px-3 py-1.5 border rounded-full hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
                  title={a.contentType ?? ''}
                >
                  <ClipIcon className="w-3.5 h-3.5" /> {a.filename} ({formatSize(a.sizeBytes)}){downloading === a.id ? ' …' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
