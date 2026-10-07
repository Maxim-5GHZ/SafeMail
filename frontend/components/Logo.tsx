// Векторный логотип СейфМейл: щит + замок + конверт. Перерисован с растра,
// поэтому края нигде не обрезаны. Два варианта: LogoMark (только знак)
// и LogoFull (знак + «СЕЙФМЕЙЛ / БЕЗОПАСНАЯ ПОЧТА»).
export function LogoMark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="СейфМейл">
      <defs>
        <linearGradient id="sm-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f6ff0" />
          <stop offset="1" stopColor="#0a44bd" />
        </linearGradient>
      </defs>
      <path
        d="M60 8 L100 22 V60 C100 88 80 102 60 112 C40 102 20 88 20 60 V22 Z"
        fill="url(#sm-shield)"
      />
      <path
        d="M60 8 L100 22 V60 C100 88 80 102 60 112 Z"
        fill="#ffffff"
        opacity="0.10"
      />
      <path
        d="M46 47 V36 a14 14 0 0 1 28 0 V47"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="40" y="46" width="40" height="30" rx="3" fill="#ffffff" />
      <path
        d="M40 49 L60 64 L80 49 M40 76 L55 61 M80 76 L65 61"
        fill="none"
        stroke="#0b46b8"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoFull({ className = 'w-56' }: { className?: string }) {
  return (
    <svg viewBox="0 0 340 120" className={className} role="img" aria-label="СейфМейл — безопасная почта">
      <g>
        <path
          d="M56 8 L92 21 V56 C92 81 74 94 56 103 C38 94 20 81 20 56 V21 Z"
          fill="#0e4fd0"
        />
        <path d="M56 8 L92 21 V56 C92 81 74 94 56 103 Z" fill="#ffffff" opacity="0.10" />
        <path
          d="M43 44 V35 a13 13 0 0 1 26 0 V44"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6.5"
          strokeLinecap="round"
        />
        <rect x="38" y="43" width="36" height="27" rx="3" fill="#ffffff" />
        <path
          d="M38 46 L56 60 L74 46 M38 70 L51 57 M74 70 L61 57"
          fill="none"
          stroke="#0e4fd0"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <text
        x="106"
        y="62"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="34"
        fontWeight="800"
        letterSpacing="1"
        fill="#0a2a63"
      >
        СЕЙФМЕЙЛ
      </text>
      <text
        x="108"
        y="86"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="13.5"
        fontWeight="600"
        letterSpacing="4.2"
        fill="#3d7dd8"
      >
        БЕЗОПАСНАЯ ПОЧТА
      </text>
    </svg>
  );
}
