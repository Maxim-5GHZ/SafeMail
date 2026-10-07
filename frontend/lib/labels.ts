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

/** Источник правки спеллера enrich → русский показ (старые записи — без источника). */
export function spellerSourceLabel(s: string | null | undefined): string {
  if (!s) return '—';
  if (s === 'yandex') return 'Яндекс';
  if (s === 'mixed-alphabet') return 'смешанный алфавит';
  if (s === 'layout') return 'раскладка';
  return '—';
}

/** Префиксы эвристических флагов classify: категория/стоп-слово/мат → русский показ. */
const FLAG_CATS: Record<string, ThreatCategory> = {
  terrorism: 'TERRORISM',
  man_made: 'MAN_MADE',
  illegal_actions: 'ILLEGAL_ACTIONS',
  other_threat: 'OTHER_THREAT',
};

export function flagLabel(f: string): string {
  const hidden = /^hidden-chars:(\d+)$/.exec(f);
  if (hidden) return `скрытые символы: ${hidden[1]}`;
  const m = /^(stopword|profanity|terrorism|man_made|illegal_actions|other_threat):(.*)$/i.exec(f);
  if (!m) return 'маркер';
  const head = m[1].toLowerCase();
  if (head === 'stopword') return `стоп-слово: ${m[2]}`;
  if (head === 'profanity') return `мат: ${m[2]}`;
  return `${categoryLabel(FLAG_CATS[head])}: ${m[2]}`;
}

/** Причины enrich-скоринга ссылок (сырые ключи) → русский показ. */
export function linkReasonLabel(r: string): string {
  if (r === 'ip-in-host') return 'адрес вместо имени';
  if (r === 'obfuscated-host') return 'маскировка имени';
  if (r === 'suspicious-tld') return 'подозрительная зона';
  if (r === 'no-tls') return 'без шифрования';
  if (r === 'long-url') return 'слишком длинная';
  const m = /^blacklist-hint:(.*)$/.exec(r);
  if (m) return `чёрный список: ${m[1]}`;
  return 'прочий признак';
}

/** Свободный текст smtp_response из delivery_logs → русский показ (детали — в логах шлюза). */
export function routeLabel(resp: string | null | undefined): string {
  if (!resp) return '';
  const failed = resp.includes('| failed:');
  const main = failed ? resp.split('| failed:')[0].trim() : resp;
  let label: string | null = null;
  if (main === 'relayed') label = 'доставлено получателю';
  else if (main.startsWith('rerouted:')) label = `в карантин: ${categoryLabel(main.slice('rerouted:'.length).trim().toUpperCase() as ThreatCategory)}`;
  else if (main.startsWith('forwarded by ')) label = `отправил в ИБ: ${main.slice('forwarded by '.length)}`;
  else if (main.startsWith('released by ')) label = `выпустил: ${main.slice('released by '.length)}`;
  if (!label) return failed ? 'ошибка' : 'запись';
  return failed ? `${label} · ошибка` : label;
}
