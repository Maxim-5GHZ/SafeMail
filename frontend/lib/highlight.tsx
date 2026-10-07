'use client';

import { useMemo } from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Подсветка триггерных фраз (heuristic_flags) через <mark>.
 * Флаги сортируем по длине — длинные совпадения раньше коротких.
 */
export function useHighlighted(text: string | null, flags: string[]): React.ReactNode {
  return useMemo(() => {
    if (!text) return '—';
    const clean = flags.map((f) => f.trim()).filter((f) => f.length > 0);
    if (clean.length === 0) return text;
    const pattern = clean
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');
    const re = new RegExp(`(${pattern})`, 'gi');
    const parts = text.split(re);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="bg-red-200 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }, [text, flags]);
}
