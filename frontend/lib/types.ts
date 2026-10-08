// Типы строго по MessageDto бэка (GET /messages, GET /messages/{id}).
export type ThreatCategory =
  | 'NONE'
  | 'TERRORISM'
  | 'MAN_MADE'
  | 'ILLEGAL_ACTIONS'
  | 'OTHER_THREAT';

export type MessageStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'PARSED'
  | 'ENRICHED'
  | 'ANALYZED'
  | 'DELIVERED'
  | 'REROUTED'
  | 'FORWARDED'
  | 'FAILED';

export interface LinkDto {
  url: string;
  status: string;
  reputationScore: number | null;
  /** Распарсенный JSONB enrich (reasons скоринга) либо сырая строка. */
  details: unknown;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  sizeBytes: number;
  contentType: string | null;
  /** Признак опасного вложения (exe/макрос/JS в PDF/скрипт) — из скана парсера. */
  threat: boolean;
}

export interface DeliveryDto {
  actionTaken: string;
  destinationRecipients: string[];
  smtpResponse: string | null;
  success: boolean;
  attemptedAt: string | null;
}

export interface SpellerFix {
  original: string;
  suggested: string;
  /** Источник правки enrich: yandex | mixed-alphabet | layout (старые записи — без него). */
  source?: string;
}

export interface ThreatReportDto {
  category: ThreatCategory;
  confidence: number | null;
  explanation: string | null;
  heuristicScore: number | null;
  heuristicFlags: string[];
  /** Распарсенный JSON speller_fixes либо сырая строка. */
  spellerFixes: unknown;
  /** Сырой вердикт SLM + её комментарий (только шторка /admin). */
  semanticCategory: ThreatCategory | null;
  semanticScore: number | null;
  semanticComment: string | null;
}

export interface MessageDto {
  id: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string | null;
  status: MessageStatus;
  verdict: ThreatCategory | null;
  createdAt: string;
  cleanText: string | null;
  normalizedText: string | null;
  /** Исходник EML из деталки (в списке null). */
  rawText: string | null;
  links: LinkDto[];
  attachments: AttachmentDto[];
  /** Лёгкий счётчик для списка (деталка несёт полный attachments). */
  attachmentCount: number;
  /** Последняя ошибка доставки/релея (для FAILED-строк в Отправленных). */
  lastError: string | null;
  deliveries: DeliveryDto[];
  threat: ThreatReportDto | null;
}

/** Spring Data Page. */
export interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export interface RoutingRule {
  category: ThreatCategory;
  destinationEmails: string[];
  active: boolean;
}

/** Управляемое стоп-слово: GET /admin/stopwords (только ADMIN). */
export interface ThreatStopword {
  id: number;
  pattern: string;
  category: ThreatCategory;
  active: boolean;
  createdAt: string;
}

/** GET /admin/stats — агрегаты дашборда (только ADMIN). */
export interface DayBucket {
  date: string;
  total: number;
  rerouted: number;
}

export interface AdminStats {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  /** Счётчики вердиктов только по карантину — совпадают со строками SOC-таблицы. */
  byCategoryRerouted: Record<string, number>;
  /** То же, но по письмам, отправленным безопасникам (вкладка «Отправлено в ИБ»). */
  byCategoryForwarded: Record<string, number>;
  perDay: DayBucket[];
  queue: { pending: number; inProgress: number };
}

export const TERMINAL_STATUSES: MessageStatus[] = ['DELIVERED', 'REROUTED', 'FORWARDED', 'FAILED'];
