// frontend/lib/labels.ts
import type { MessageStatus, ThreatCategory } from './types';

export const CATS: ThreatCategory[] = ['TERRORISM', 'MAN_MADE', 'ILLEGAL_ACTIONS', 'OTHER_THREAT'];

const CATEGORY_LABELS: Record<ThreatCategory, string> = {
  NONE: 'Чисто',
  TERRORISM: 'Терроризм и экстремизм',
  MAN_MADE: 'Техногенная / физ. угроза',
  ILLEGAL_ACTIONS: 'Противоправные действия',
  OTHER_THREAT: 'Иные угрозы безопасности',
};

export function categoryLabel(c: ThreatCategory | null | undefined): string {
  if (!c) return 'Чисто';
  return CATEGORY_LABELS[c] ?? c;
}

const STATUS_LABELS: Record<MessageStatus, string> = {
  PENDING: 'В очереди анализа',
  IN_PROGRESS: 'Анализируется',
  PARSED: 'Разобрано',
  ENRICHED: 'Обогащено',
  ANALYZED: 'Проверено',
  DELIVERED: 'Доставлено адресату',
  REROUTED: 'Изолировано в карантине',
  FORWARDED: 'На расследовании в ИБ',
  FAILED: 'Сбой доставки',
};

export function statusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return (STATUS_LABELS as Record<string, string>)[s] ?? s;
}

/**
 * Подпись статуса письма с учётом папки: во Входящих «Доставлено адресату»
 * бессмысленно (читатель и есть адресат) — там нейтральное «Получено»,
 * в Отправленных — честный итог попытки доставки.
 */
export function folderStatusLabel(
  s: string | null | undefined,
  folder: 'inbox' | 'sent',
): string {
  if (!s) return '—';
  if (folder === 'inbox') {
    if (s === 'DELIVERED') return 'Получено';
    return statusLabel(s);
  }
  if (s === 'DELIVERED') return 'Доставлено получателю';
  if (s === 'FAILED') return 'Не доставлено — ошибка';
  if (s === 'REROUTED' || s === 'FORWARDED') return 'Заблокировано шлюзом';
  return 'На проверке шлюза';
}

const LINK_STATUS_LABELS: Record<string, string> = {
  SAFE: 'Безопасная',
  SUSPICIOUS: 'Подозрительная',
  MALICIOUS: 'Вредоносная',
  UNCHECKED: 'Не проверялась',
};

export function linkStatusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return LINK_STATUS_LABELS[s] ?? s;
}

export function spellerSourceLabel(s: string | null | undefined): string {
  if (!s) return '—';
  if (s === 'yandex') return 'Нейро-спеллер';
  if (s === 'mixed-alphabet') return 'Подмена алфавита (мимикрия)';
  if (s === 'layout') return 'Смена раскладки';
  return 'Эвристика';
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export function severityOf(c: ThreatCategory | null | undefined): Severity {
  if (c === 'TERRORISM') return 'critical';
  if (c === 'MAN_MADE') return 'high';
  if (c === 'ILLEGAL_ACTIONS') return 'medium';
  return 'low';
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
};

const SEVERITY_BORDER: Record<Severity, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-amber-500',
  low: 'border-l-slate-400',
};

export function severityDotClass(c: ThreatCategory | null | undefined): string {
  return SEVERITY_DOT[severityOf(c)];
}

export function severityBorderClass(c: ThreatCategory | null | undefined): string {
  return SEVERITY_BORDER[severityOf(c)];
}

export function flagLabel(f: string): string {
  const hidden = /^hidden-chars:(\d+)$/.exec(f);
  if (hidden) return `Скрытые невидимые символы (${hidden[1]} шт.)`;
  const att = /^attachment:(.+)$/i.exec(f);
  if (att) return `Опасное вложение: ${attachmentReasonLabel(att[1])}`;
  const m = /^(stopword|profanity|terrorism|man_made|illegal_actions|other_threat):(.*)$/i.exec(f);
  if (!m) return f;
  const head = m[1].toLowerCase();
  if (head === 'stopword') return `Стоп-слово: «${m[2]}»`;
  if (head === 'profanity') return `Ненормативная лексика: «${m[2]}»`;
  return `Паттерн угрозы: «${m[2]}»`;
}

/** Расшифровка причин скана вложений (parser risk_reasons) — только русский текст. */
export function attachmentReasonLabel(r: string): string {
  if (r.startsWith('executable-ext:')) return `исполняемый файл (.${r.slice(15)})`;
  if (r.startsWith('double-extension:')) return `двойное расширение (${r.slice(17)})`;
  if (r === 'macro-vba') return 'макрос VBA в документе';
  if (r === 'macro-extension') return 'макро-формат документа';
  if (r === 'pdf-javascript') return 'JavaScript внутри PDF';
  if (r === 'pdf-launch-or-embedded') return 'запуск/встроенный файл в PDF';
  if (r === 'html-script') return 'скрипт внутри HTML';
  if (r === 'archive-contains-executable') return 'исполняемый файл внутри архива';
  if (r === 'encrypted-archive') return 'шифрованный архив';
  if (r === 'mime-mismatch') return 'тип файла не совпадает с расширением';
  if (r === 'script-file') return 'файл скрипта';
  if (r === 'dangerous') return 'опасное содержимое';
  return r;
}

export function linkReasonLabel(r: string): string {
  if (r === 'ip-in-host') return 'Прямой IP вместо домена';
  if (r === 'obfuscated-host') return 'Маскировка доменного имени';
  if (r === 'suspicious-tld') return 'Подозрительная доменная зона';
  if (r === 'no-tls') return 'Отсутствует HTTPS/TLS';
  if (r === 'long-url') return 'Аномальная длина ссылки';
  const m = /^blacklist-hint:(.*)$/.exec(r);
  if (m) return `В черном списке: ${m[1]}`;
  return 'Подозрительный признак';
}

/** 
 * Человекочитаемая расшифровка шагов жизненного цикла письма в SOAR.
 * Превращает сырые SMTP логи в понятную последовательность событий.
 */
export interface ParsedAuditStep {
  title: string;
  badge: string;
  badgeColor: string;
  description: string;
  recipientsLabel: string;
  recipients: string[];
  comment?: string;
}

export function parseDeliveryStep(
  action: string,
  rawResponse: string | null,
  recipients: string[],
  targetRecipient: string
): ParsedAuditStep {
  const resp = rawResponse ?? '';

  // 1. Автоматический перехват в карантин
  if (action === 'REROUTED_TO_SECURITY') {
    return {
      title: 'Автоматическая изоляция шлюзом',
      badge: 'Карантин',
      badgeColor: 'bg-red-100 text-red-700 border-red-200',
      description: 'Письмо заблокировано политикой безопасности до вручения адресату. Доступ изолирован.',
      recipientsLabel: 'Копия направлена в архив инцидентов:',
      recipients,
    };
  }

  // 2. Ручная передача дежурному безопаснику
  if (action === 'FORWARDED_TO_SECURITY') {
    let comment: string | undefined;
    if (resp.includes('(reason:')) {
      const match = /\(reason:\s*(.*?)\)/.exec(resp);
      if (match) comment = match[1];
    }
    return {
      title: 'Эскалация офицеру безопасности',
      badge: 'В расследовании',
      badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
      description: 'Инцидент направлен специалисту SOC для проведения расследования.',
      recipientsLabel: 'Назначенные офицеры ИБ:',
      recipients,
      comment,
    };
  }

  // 3. Выпуск из карантина администратором
  if (action === 'RELEASED_BY_ADMIN') {
    let comment: string | undefined;
    if (resp.includes('(reason:')) {
      const match = /\(reason:\s*(.*?)\)/.exec(resp);
      if (match) comment = match[1];
    }
    return {
      title: 'Ручной выпуск из карантина',
      badge: 'Выпущено',
      badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      description: `Администратор признал письмо безопасным и разблокировал доставку адресату (${targetRecipient}).`,
      recipientsLabel: 'Фактический получатель:',
      recipients: [targetRecipient],
      comment,
    };
  }

  // 4. Штатная доставка
  if (action === 'FORWARDED_ORIGINAL') {
    return {
      title: 'Штатная доставка получателю',
      badge: 'Доставлено',
      badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      description: 'Угроз не обнаружено, письмо передано почтовому серверу адресата.',
      recipientsLabel: 'Доставлено на ящик:',
      recipients,
    };
  }

  // Fallback на случай нестандартных кодов
  return {
    title: action,
    badge: 'Событие',
    badgeColor: 'bg-slate-100 text-slate-700 border-slate-200',
    description: resp || 'Действие зафиксировано почтовым сервером.',
    recipientsLabel: 'Получатели:',
    recipients,
  };
}