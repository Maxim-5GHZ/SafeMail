'use client';

import { useMemo } from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Термины угроз для красной подсветки: чистим технические флаги
 * (stopword:X → X, profanity:Y → Y, hidden-chars:N → пропуск),
 * плюс оригиналы спеллера и URL.
 */
export function threatTerms(
  flags: string[],
  fixes: { original: string }[] = [],
  links: { url: string }[] = [],
): string[] {
  const out: string[] = [];
  for (const f of flags ?? []) {
    const t = (f ?? '').trim();
    if (!t) continue;
    if (/^hidden-chars:\d+$/i.test(t)) continue;
    // Флаги вложений и семантики — не текстовые термины, в подсветке им не место.
    if (/^attachment:/i.test(t)) continue;
    if (/^semantic:/i.test(t)) continue;
    const colon = t.indexOf(':');
    const term = (colon >= 0 ? t.slice(colon + 1) : t).trim();
    if (term.length >= 2) out.push(term);
  }
  for (const fx of fixes ?? []) {
    const o = (fx?.original ?? '').trim();
    if (o.length >= 2) out.push(o);
  }
  for (const l of links ?? []) {
    const u = (l?.url ?? '').trim();
    if (u.length >= 4) out.push(u);
  }
  return Array.from(new Set(out));
}
export function useHighlighted(text: string | null, terms: string[]): React.ReactNode {
  return useMemo(() => {
    if (!text) return '—';
    const clean = terms.map((f) => f.trim()).filter((f) => f.length > 0);
    if (clean.length === 0) return text;
    const pattern = clean
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');
    const re = new RegExp(`(${pattern})`, 'gi');
    const parts = text.split(re);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="bg-red-300 text-red-900 px-0.5 rounded font-semibold">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }, [text, terms]);
}
