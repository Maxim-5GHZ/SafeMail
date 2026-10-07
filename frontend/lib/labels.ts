// Русские подписи для кодов бэка. Контракт API не меняется (коды остаются
// латиницей) — переводится только слой отображения.
import type { MessageStatus, ThreatCategory } from './types';

/** Порядок категорий в чипах/селектах. */
export const CATS: ThreatCategory[] = ['TERRORISM', 'MAN_MADE', 'ILLEGAL_ACTIONS', 'OTHER_THREAT'];

const CATEGORY_LABELS: Record<ThreatCategory, string> = {
  NONE: 'Чисто',
  TERRORISM: 'Терроризм',
  MAN_MADE: 'Техногенная угроза',
  ILLEGAL_ACTIONS: 'Противоправные действия',
  OTHER_THREAT: 'Прочая угроза',
};

export function categoryLabel(c: ThreatCategory | null | undefined): string {
  if (!c) return '—';
  return CATEGORY_LABELS[c] ?? c;
}

const STATUS_LABELS: Record<MessageStatus, string> = {
  PENDING: 'В очереди',
  IN_PROGRESS: 'Обрабатывается',
  PARSED: 'Разобрано',
  ENRICHED: 'Обогащено',
  ANALYZED: 'Проанализировано',
  DELIVERED: 'Доставлено',
  REROUTED: 'В карантине',
  FORWARDED: 'Отправлено в ИБ',
  FAILED: 'Ошибка',
};

export function statusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return (STATUS_LABELS as Record<string, string>)[s] ?? s;
}

const LINK_STATUS_LABELS: Record<string, string> = {
  SAFE: 'Безопасная',
  SUSPICIOUS: 'Подозрительная',
  MALICIOUS: 'Вредоносная',
  UNCHECKED: 'Не проверена',
};

export function linkStatusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return LINK_STATUS_LABELS[s] ?? s;
}

/** Коды действий из delivery_logs (свободный текст бэка не трогаем, маппим показ). */
const ACTION_LABELS: Record<string, string> = {
  FORWARDED_ORIGINAL: 'Доставлено получателю',
  REROUTED_TO_SECURITY: 'В карантин (ИБ)',
  RELEASED_BY_ADMIN: 'Выпущено админом',
  FORWARDED_TO_SECURITY: 'Отправлено в ИБ',
};

export function actionLabel(a: string | null | undefined): string {
  if (!a) return '—';
  return ACTION_LABELS[a] ?? a;
}

/** Префикс эвристических флагов classify (например stopword:обнал → стоп-слово: обнал). */
export function flagLabel(f: string): string {
  const m = /^stopword:(.*)$/.exec(f);
  if (m) return `стоп-слово: ${m[1]}`;
  return f;
}
