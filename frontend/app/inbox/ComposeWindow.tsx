'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { X, Minus, Square, Paperclip, Send, AlertTriangle, GripHorizontal } from 'lucide-react';
import { ApiError, sendMessage } from '@/lib/api';
import { MAX_ATTACHMENT_BYTES, formatSize } from '@/lib/format';

interface Props {
  from: string;
  token: string;
  onClose: () => void;
  onSent: (to: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const winRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  useLayoutEffect(() => {
    if (!winRef.current || pos !== null) return;
    const rect = winRef.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, window.innerWidth - rect.width - 24),
      y: Math.max(8, window.innerHeight - rect.height - 8),
    });
  }, [pos]);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    if ((e.target as HTMLElement).closest('button, input, a, label')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    setDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !winRef.current) return;
      const rect = winRef.current.getBoundingClientRect();
      let nx = dragRef.current.px + (e.clientX - dragRef.current.sx);
      let ny = dragRef.current.py + (e.clientY - dragRef.current.sy);
      nx = Math.max(8, Math.min(window.innerWidth - rect.width - 8, nx));
      ny = Math.max(8, Math.min(window.innerHeight - rect.height - 8, ny));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragging(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (!winRef.current || !pos) return;
      const rect = winRef.current.getBoundingClientRect();
      setPos((p) =>
        p
          ? {
              x: Math.max(8, Math.min(window.innerWidth - rect.width - 8, p.x)),
              y: Math.max(8, Math.min(window.innerHeight - rect.height - 8, p.y)),
            }
          : p,
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  useEffect(() => {
    if (dragging) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragging]);

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
      onSent(to.trim());
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg text-sm outline-none transition ' +
    'bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800 ' +
    'placeholder:text-slate-400 ' +
    'focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]';

  return (
    <div
      ref={winRef}
      style={pos ? { left: pos.x, top: pos.y } : { bottom: 0, right: 24 }}
      className={`fixed w-[520px] max-w-[calc(100vw-3rem)] flex flex-col z-50
                  rounded-2xl overflow-hidden
                  bg-white/60 backdrop-blur-2xl backdrop-saturate-150
                  border border-white/60
                  shadow-[0_20px_60px_rgba(15,23,42,0.25),inset_0_1px_0_rgba(255,255,255,0.9)]
                  ${pos ? '' : 'invisible'}`}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className={`flex items-center gap-2 px-4 py-2.5
                    bg-white/40 backdrop-blur-xl border-b border-white/50
                    text-sm text-slate-700
                    ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <GripHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
        <span className="font-bold select-none text-slate-800">Новое письмо</span>
        <span className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setMinimized((m) => !m)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white/70 transition"
            title={minimized ? 'Развернуть' : 'Свернуть'}
          >
            {minimized ? <Square className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50/80 transition"
            title="Закрыть"
            aria-label="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      {!minimized && (
        <div className="flex flex-col gap-3 p-4">
          <div className="font-mono text-xs text-slate-400">От: {from}</div>

          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Кому"
            className={inputCls}
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Тема"
            className={inputCls}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Текст письма…"
            rows={10}
            className={`${inputCls} resize-y font-sans`}
          />

          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span
                  key={i}
                  className="text-xs bg-white/60 backdrop-blur-sm border border-white/70
                             rounded-full px-2 py-1 flex items-center gap-1
                             text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                >
                  <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                  {f.name} <span className="font-mono text-slate-400">({formatSize(f.size)})</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-0.5 p-0.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50/60 transition"
                    aria-label="Убрать файл"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 text-sm border rounded-lg bg-rose-50/80 backdrop-blur-sm border-rose-200/60 text-rose-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={send}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium
                         bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition
                         shadow-[0_2px_8px_rgba(37,99,235,0.30)]"
            >
              <Send className="w-3.5 h-3.5" />
              {busy ? 'Отправка…' : 'Отправить'}
            </button>

            <label
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium
                         bg-white/60 backdrop-blur-sm border border-white/70 text-slate-700
                         hover:bg-white/90 cursor-pointer transition
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              title="Прикрепить файлы"
              aria-label="Прикрепить файлы"
            >
              <Paperclip className="w-3.5 h-3.5" />
              Прикрепить
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => pickFiles(e.target.files)}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}