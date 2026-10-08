// Тонкий клиент gateway через same-origin прокси /backend/* (см. next.config.js).
// Токен — из localStorage (MVP), 401 → разлогин решает вызывающий код.
import type { AdminStats, MessageDto, MessageStatus, Page, RoutingRule, ThreatCategory, ThreatStopword } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Record<string, unknown>;

async function req<T>(
  path: string,
  token: string | null,
  init?: { method?: string; body?: Body; form?: FormData; signal?: AbortSignal },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload: string | FormData | undefined;
  if (init?.form) {
    payload = init.form;
  } else if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(init.body);
  }
  const res = await fetch(`/backend${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: payload,
    signal: init?.signal,
  });
  if (res.status === 204 || res.status === 202) {
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data as { message?: string; error?: string } | null)?.message ??
      (data as { error?: string } | null)?.error ??
      `Ошибка сети (код ${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface ListParams {
  status?: MessageStatus;
  category?: ThreatCategory;
  sender?: string;
  recipient?: string;
  query?: string;
  /** Папка: inbox тихо вырезает карантин (REROUTED/FORWARDED), sent — нет. */
  mailbox?: 'inbox' | 'sent';
  page?: number;
  size?: number;
}

export function listMessages(token: string, p: ListParams, signal?: AbortSignal): Promise<Page<MessageDto>> {
  const q = new URLSearchParams();
  if (p.status) q.set('status', p.status);
  if (p.category) q.set('category', p.category);
  if (p.sender) q.set('sender', p.sender);
  if (p.recipient) q.set('recipient', p.recipient);
  if (p.query) q.set('query', p.query);
  if (p.mailbox) q.set('mailbox', p.mailbox);
  q.set('page', String(p.page ?? 0));
  q.set('size', String(p.size ?? 20));
  q.set('sortBy', 'createdAt');
  q.set('direction', 'DESC');
  return req<Page<MessageDto>>(`/v1/messages?${q.toString()}`, token, signal ? { signal } : undefined);
}

export function getMessage(token: string, id: string, signal?: AbortSignal): Promise<MessageDto> {
  return req<MessageDto>(`/v1/messages/${id}`, token, signal ? { signal } : undefined);
}

export function reprocessMessage(token: string, id: string): Promise<void> {
  return req<void>(`/v1/messages/${id}/reprocess`, token, { method: 'POST' });
}

export function sendMessage(
  token: string,
  fields: { from: string; to: string; subject: string; body: string; files: File[] },
): Promise<void> {
  const form = new FormData();
  form.set('from', fields.from);
  form.set('to', fields.to);
  form.set('subject', fields.subject);
  form.set('body', fields.body);
  for (const f of fields.files) form.append('files', f, f.name);
  return req<void>('/v1/messages/send', token, { method: 'POST', form });
}

export async function downloadAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
  filename: string,
): Promise<void> {
  const res = await fetch(`/backend/v1/messages/${messageId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, `Не удалось скачать (код ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function login(email: string, password: string): Promise<{ token: string }> {
  return req<{ token: string }>('/v1/auth/login', null, {
    method: 'POST',
    body: { email, password },
  });
}

export function register(username: string, password: string): Promise<{ token: string }> {
  return req<{ token: string }>('/v1/auth/register', null, {
    method: 'POST',
    body: { username, password },
  });
}

export function listRules(token: string): Promise<RoutingRule[]> {
  return req<RoutingRule[]>('/v1/routing-rules', token);
}

export function getAdminStats(token: string, days = 14): Promise<AdminStats> {
  const q = new URLSearchParams({ days: String(days) });
  return req<AdminStats>(`/v1/admin/stats?${q.toString()}`, token);
}

export function releaseMessage(token: string, id: string, reason?: string): Promise<{ status: string }> {
  return req<{ status: string }>(`/v1/admin/messages/${id}/release`, token, {
    method: 'POST',
    body: reason ? { reason } : {},
  });
}

export function forwardMessage(
  token: string,
  id: string,
  opts?: { emails?: string[]; reason?: string },
): Promise<{ status: string; recipients: string[] }> {
  const body: Body = {};
  if (opts?.emails?.length) body.emails = opts.emails;
  if (opts?.reason) body.reason = opts.reason;
  return req<{ status: string; recipients: string[] }>(`/v1/admin/messages/${id}/forward`, token, {
    method: 'POST',
    body,
  });
}

export function updateRule(
  token: string,
  category: ThreatCategory,
  emails: string[],
): Promise<RoutingRule> {
  return req<RoutingRule>(`/v1/routing-rules/${category}`, token, {
    method: 'PUT',
    body: { destinationEmails: emails },
  });
}

export function listStopwords(token: string): Promise<ThreatStopword[]> {
  return req<ThreatStopword[]>('/v1/admin/stopwords', token);
}export function createStopword(token: string, pattern: string, category: ThreatCategory): Promise<ThreatStopword> {
  return req<ThreatStopword>('/v1/admin/stopwords', token, {
    method: 'POST',
    body: { pattern, category },
  });
}

export function updateStopword(
  token: string,
  id: number,
  patch: { category?: ThreatCategory; active?: boolean },
): Promise<ThreatStopword> {
  return req<ThreatStopword>(`/v1/admin/stopwords/${id}`, token, { method: 'PUT', body: patch });
}

export function deleteStopword(token: string, id: number): Promise<void> {
  return req<void>(`/v1/admin/stopwords/${id}`, token, { method: 'DELETE' });
}

export interface PublicConfig {
  primaryDomain: string;
  allowedDomains: string[];
}

/** Живой домен с бэкенда (без токена) — вместо запечённого NEXT_PUBLIC_MAIL_DOMAIN. */
export function getPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  return req<PublicConfig>('/v1/public/config', null, signal ? { signal } : undefined);
}

export interface SystemSettingsDto {
  primaryDomain: string;
  allowedDomains: string[];
  relayEnabled: boolean;
  relayHost?: string;
  relayPort?: number;
}

export function getSystemSettings(token: string): Promise<SystemSettingsDto> {
  return req<SystemSettingsDto>('/v1/admin/settings', token);
}

export function updateSystemSettings(token: string, data: SystemSettingsDto): Promise<SystemSettingsDto> {
  return req<SystemSettingsDto>('/v1/admin/settings', token, {
    method: 'PUT',
    body: data as unknown as Record<string, unknown>,
  });
}
