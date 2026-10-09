export function LogoMark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 176 161" className={className} fill="none" role="img" aria-label="СейфМейл">
      
    <path d="M98.6918 123.514L102 131H63.0003L77.0836 102.813C74.3753 95.7666 63.0003 72.999 83.5836 72.9998C90.0003 73 87.7377 74.1261 89.0003 74.5" stroke="black" stroke-width="9"/>
      <path d="M115 92C148 112 151.5 130.5 152 136C152.5 141.5 148.5 142 144 139.5C139.877 137.209 130.5 122.5 123.5 120C116.5 117.5 115.5 118 110 114.5" stroke="black" stroke-width="9"/>
      <path d="M134 80C158 94 160 101.333 161 107.5C160.834 109.667 155.1 110.5 153.5 108.5C148.7 102.5 137 94.5 127.5 94" stroke="black" stroke-width="9"/>
      <path d="M40.9042 51C40.9042 23.938 58.6099 2 86.5003 2C98.519 2 108.33 7.19787 117 14" stroke="black" stroke-width="9"/>
      <path d="M140 67C130.316 72.1448 135 86 124 96.5M112 115C106.634 120.205 103.263 121.249 87.2632 126.249C63.8609 130.53 73.5003 129 65.5003 131M73.0003 82C83.0166 78.8305 88.0003 76 93.0003 69.5M38.9083 88C37.9249 88 34.4083 88.5 31.4083 88C17.9083 88 14.9083 79.625 12.4083 71.5C8.40833 58.5 19.9082 42 19.9082 42C9.40833 45 -2.05124 65.3013 3.40837 83.5C6.40836 93.5 15.9083 102.996 21.9083 104C22.8754 105.888 24.9084 107 24.4084 110.5" stroke="black" stroke-width="9"/>
      <path d="M138.902 67.6835C184.402 38.6835 173.402 15.6836 170.402 15.6836C167.402 15.6836 153.243 26.1442 147.402 24.6836C145.402 24.1835 143.032 22.5072 141.902 19.6834C140.902 17.1836 127.902 9.18367 112.902 15.1837C97.9024 21.1837 86.9029 32.8757 86.9029 36.6836C86.9029 39.1838 76.4028 53.1836 67.4028 58.1836C63.7332 67.0009 85.9032 80.1836 103.403 63.1836" stroke="black" stroke-width="9"/>
      <path d="M127.908 122.026V142C127.908 146.418 124.327 150 119.908 150H40.9084V49L78.8763 49" stroke="black" stroke-width="9"/>
      <path d="M24.4084 110C21.4084 141 15.9084 143.5 14.4071 155C13.9494 158.506 23.0259 160.822 29.9073 155C34.5539 151.069 38.0505 146.435 40.6712 142.034" stroke="black" stroke-width="9"/>
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
