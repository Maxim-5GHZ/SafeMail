// Прочитано/звёздочки — MVP в localStorage (см. AGENTS.md §6, план inbox).
// Один ящик на браузер; синхронизация между устройствами — вне MVP.
const READ_KEY = 'sm_read';
const STAR_KEY = 'sm_star';

function load(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* quota — молча */
  }
}

export function loadRead(): string[] {
  return load(READ_KEY);
}
export function loadStarred(): string[] {
  return load(STAR_KEY);
}
export function markRead(id: string): string[] {
  const ids = load(READ_KEY);
  if (!ids.includes(id)) {
    ids.push(id);
    save(READ_KEY, ids);
  }
  return ids;
}
export function toggleStarred(id: string): string[] {
  const ids = load(STAR_KEY);
  const i = ids.indexOf(id);
  if (i >= 0) ids.splice(i, 1);
  else ids.push(id);
  save(STAR_KEY, ids);
  return [...ids];
}
