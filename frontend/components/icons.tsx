// Крошечные SVG-значки вместо эмодзи (в интерфейсе нет эмодзи и латиницы).
export function CloseIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
    </svg>
  );
}

export function StarIcon({ filled = false, className = 'w-5 h-5' }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z" strokeLinejoin="round" />
    </svg>
  );
}

export function ClipIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M11.5 7.5l-4.8 4.8a2.1 2.1 0 01-3-3L9.4 3.6a3.4 3.4 0 014.8 4.8l-5.7 5.7a4.7 4.7 0 01-6.6-6.6l5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function WarnIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M8 1.5L15 14H1z" strokeLinejoin="round" />
      <path d="M8 6v3.5" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RefreshIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
