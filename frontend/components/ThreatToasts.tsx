'use client';

import { ShieldAlert, X } from 'lucide-react';
import { categoryLabel, severityBorderClass, severityDotClass } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import type { ThreatPing } from '@/lib/threatFeed';

export interface ToastItem extends ThreatPing {
  key: number;
  leaving?: boolean;
}

/** Стек живых уведомлений об угрозах (правый верхний угол, поверх всего).
 *  Стиль — то же стекло, что в /admin; severity — из lib/labels (как в шторке).
 *  Анимации — .toast-in/.toast-out/.severity-ping в globals.css. */
export default function ThreatToasts({
  items,
  onOpen,
  onDismiss,
}: {
  items: ToastItem[];
  onOpen: (id: string) => void;
  onDismiss: (key: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="fixed top-4 right-4 z-[100] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.key}
          className={`rounded-2xl border border-white/60 border-l-4 bg-white/70 backdrop-blur-2xl
                      shadow-[0_8px_32px_rgba(31,38,135,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]
                      ${severityBorderClass(t.category)} ${t.leaving ? 'toast-out' : 'toast-in'}`}
        >
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <span className="relative inline-flex shrink-0" aria-hidden>
              <span className={`inline-block w-2.5 h-2.5 rounded-full severity-ping ${severityDotClass(t.category)}`} />
            </span>
            <ShieldAlert className="w-4 h-4 shrink-0 text-slate-700" aria-hidden />
            <span className="text-sm font-semibold text-slate-900 truncate">
              {categoryLabel(t.category)}
            </span>
            <span className="shrink-0 text-xs font-bold text-slate-600">
              {Math.round((t.confidence ?? 0) * 100)}%
            </span>
            <button
              onClick={() => onDismiss(t.key)}
              aria-label="Закрыть уведомление"
              className="ml-auto rounded-full p-1 text-slate-500 hover:bg-white/80 hover:text-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-3 pb-1 pt-1 text-xs text-slate-600 truncate">
            {t.senderEmail} → {t.recipientEmail}
          </div>
          <div className="px-3 text-sm text-slate-800 truncate" title={t.subject || '(без темы)'}>
            {t.subject || '(без темы)'}
          </div>
          <div className="flex items-center gap-2 px-3 pb-2.5 pt-1.5">
            <button
              onClick={() => onOpen(t.messageId)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                         bg-white/70 border border-white/70 text-slate-700
                         hover:bg-white transition
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.05)]"
            >
              Открыть разбор
            </button>
            <span className="ml-auto text-[11px] text-slate-500">{formatDateTime(t.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
