'use client';

import { useState } from 'react';
import { ApiError, sendMessage } from '@/lib/api';
import { MAX_ATTACHMENT_BYTES, formatSize } from '@/lib/format';
import { ClipIcon, CloseIcon } from '@/components/icons';

interface Props {
  from: string;
  token: string;
  onClose: () => void;
  onSent: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Текст из textarea — в безопасный HTML: бэк шлёт setText(body, html=true). */
function toSafeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

export default function ComposeWindow({ from, token, onClose, onSent }: Props) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setError(`Файл ${f.name} больше 20 МБ — шлюз такие режет`);
        continue;
      }
      ok.push(f);
    }
    setFiles((prev) => [...prev, ...ok]);
  };

  const send = async () => {
    setError(null);
    if (!EMAIL_RE.test(to.trim())) {
      setError('Укажите правильный адрес получателя');
      return;
    }
    if (!subject.trim() && !window.confirm('Отправить без темы?')) return;
    setBusy(true);
    try {
      await sendMessage(token, {
        from,
        to: to.trim(),
        subject: subject.trim(),
        body: toSafeHtml(body),
        files,
      });
      onSent();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-0 right-6 w-[520px] max-w-[calc(100vw-3rem)] bg-white rounded-t-xl shadow-2xl border border-gray-200 flex flex-col z-50">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-t-xl text-sm">
        <span className="font-medium">Новое письмо</span>
        <span className="ml-auto flex gap-1">
          <button onClick={() => setMinimized((m) => !m)} className="px-2 hover:bg-gray-700 rounded" title="Свернуть">
            {minimized ? '▢' : '–'}
          </button>
          <button onClick={onClose} className="px-2 hover:bg-gray-700 rounded inline-flex" title="Закрыть" aria-label="Закрыть">
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
      {!minimized && (
        <div className="flex flex-col gap-2 p-4">
          <div className="text-xs text-gray-400">От: {from}</div>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Кому"
            className="px-2 py-1.5 border-b outline-none focus:border-blue-400 text-sm"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Тема"
            className="px-2 py-1.5 border-b outline-none focus:border-blue-400 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Текст письма…"
            rows={10}
            className="px-2 py-1.5 outline-none resize-y text-sm"
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={i} className="text-xs bg-gray-100 rounded-full px-2 py-1 flex items-center gap-1">
                  <ClipIcon className="w-3.5 h-3.5" /> {f.name} ({formatSize(f.size)})
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-600 inline-flex"
                    aria-label="Убрать файл"
                  >
                    <CloseIcon className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={send}
              disabled={busy}
              className="px-6 py-2 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '…' : 'Отправить'}
            </button>
            <label className="text-sm text-gray-500 hover:text-gray-800 cursor-pointer inline-flex" title="Прикрепить файлы" aria-label="Прикрепить файлы">
              <ClipIcon className="w-5 h-5" />
              <input type="file" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
