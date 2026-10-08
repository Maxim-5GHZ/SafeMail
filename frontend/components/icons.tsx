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

// Сегментные иконки для презентации (/): тот же штриховой стиль, без эмодзи.
export function GovIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M10 2.5L2.5 7h15z" strokeLinejoin="round" />
      <path d="M4.5 7v7M8 7v7M12 7v7M15.5 7v7" strokeLinecap="round" />
      <path d="M2.5 16.5h15" strokeLinecap="round" />
    </svg>
  );
}

export function BankIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
      <circle cx="10" cy="10" r="3" />
      <path d="M10 10l1.8-1.8" strokeLinecap="round" />
      <path d="M6 3.5v13M14 3.5v13" strokeLinecap="round" />
    </svg>
  );
}

export function FactoryIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M5 16.5v-8h10v8" strokeLinejoin="round" />
      <path d="M7 8.5V4.5h2.5V8" strokeLinejoin="round" />
      <path d="M7.5 11h1.5M11 11h1.5M7.5 13.8h1.5M11 13.8h1.5" strokeLinecap="round" />
      <path d="M2.5 16.5h15" strokeLinecap="round" />
    </svg>
  );
}

export function CorpIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <rect x="6" y="2.5" width="8" height="14" />
      <path d="M8.5 5.5h3M8.5 8h3M8.5 10.5h3M8.5 13h3" strokeLinecap="round" />
      <path d="M4 16.5h12" strokeLinecap="round" />
    </svg>
  );
}

// Иконки этапов атаки для презентации (/): тот же штриховой стиль, без эмодзи.
export function SearchIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.5 13.5L17.5 17.5" strokeLinecap="round" />
    </svg>
  );
}

export function MaskIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M3 5.5h14v5a7 7 0 01-14 0z" strokeLinejoin="round" />
      <path d="M6.5 9.5h.1M13.5 9.5h.1" strokeLinecap="round" strokeWidth="2" />
      <path d="M8 14.5c1 1 3 1 4 0" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M10 2l6.5 2.5v5c0 4.5-2.8 7-6.5 8.5-3.7-1.5-6.5-4-6.5-8.5v-5z" strokeLinejoin="round" />
      <path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UserIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M3.5 17a6.5 6.5 0 0113 0" strokeLinecap="round" />
    </svg>
  );
}

export function HackerIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M10 2.5l7 3v5c0 4-3 6.5-7 7.5-4-1-7-3.5-7-7.5v-5z" strokeLinejoin="round" />
      <path d="M7 9.5h.1M13 9.5h.1" strokeLinecap="round" strokeWidth="2" />
      <path d="M7.5 13h5" strokeLinecap="round" />
    </svg>
  );
}

export function LightningIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path d="M11 1.5L4 11h5l-1 7.5L15 9H9.5z" strokeLinejoin="round" />
    </svg>
  );
}
