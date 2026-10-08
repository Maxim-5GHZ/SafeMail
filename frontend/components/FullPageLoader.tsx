import { LogoFull } from '@/components/Logo';

type Props = {
    label?: string;
    variant?: 'full' | 'inline';
};

export default function FullPageLoader({
    label = 'Загрузка…',
    variant = 'full',
    }: Props) {
    return (
        <div
        style={{
            position: variant === 'full' ? 'fixed' : 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            overflow: 'hidden',
            background:
            'linear-gradient(135deg, #f8fafc 0%, #ffffff 50%, #f0f9ff 100%)',
            zIndex: 50,
        }}
        >
        <div
            aria-hidden
            style={{
            position: 'absolute',
            top: '-8rem',
            left: '-8rem',
            width: '40rem',
            height: '40rem',
            borderRadius: '9999px',
            background: 'rgba(103, 232, 249, 0.30)',
            filter: 'blur(80px)',
            pointerEvents: 'none',
            }}
        />
        <div
            aria-hidden
            style={{
            position: 'absolute',
            bottom: '-10rem',
            right: '-8rem',
            width: '42rem',
            height: '42rem',
            borderRadius: '9999px',
            background: 'rgba(96, 165, 250, 0.25)',
            filter: 'blur(80px)',
            pointerEvents: 'none',
            }}
        />
        <div
            aria-hidden
            style={{
            position: 'absolute',
            top: '33%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '28rem',
            height: '28rem',
            borderRadius: '9999px',
            background: 'rgba(186, 230, 253, 0.40)',
            filter: 'blur(80px)',
            pointerEvents: 'none',
            }}
        />

        <div
            style={{
            position: 'relative',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem',
            padding: '2rem 2.5rem',
            borderRadius: '1rem',
            background: 'rgba(255, 255, 255, 0.40)',
            border: '1px solid rgba(255, 255, 255, 0.55)',
            boxShadow:
                '0 8px 32px rgba(31, 38, 135, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(40px) saturate(150%)',
            WebkitBackdropFilter: 'blur(40px) saturate(150%)',
            }}
        >
            <LogoFull />

            <div style={{ position: 'relative', width: '56px', height: '56px' }}>
            <svg
                viewBox="0 0 56 56"
                width="56"
                height="56"
                fill="none"
                style={{
                position: 'absolute',
                inset: 0,
                animation: 'flp-spin 2.4s linear infinite',
                }}
            >
                <defs>
                <linearGradient id="flp-grad1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#00e5ff" />
                    <stop offset="100%" stopColor="#5b8cff" />
                </linearGradient>
                </defs>
                <circle
                cx="28"
                cy="28"
                r="24"
                stroke="url(#flp-grad1)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="40 120"
                />
            </svg>

            <svg
                viewBox="0 0 56 56"
                width="56"
                height="56"
                fill="none"
                style={{
                position: 'absolute',
                inset: 0,
                animation: 'flp-spin 1.6s linear infinite reverse',
                }}
            >
                <defs>
                <linearGradient id="flp-grad2" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#6bc4ff" />
                    <stop offset="100%" stopColor="#25b1e8" />
                </linearGradient>
                </defs>
                <circle
                cx="28"
                cy="28"
                r="17"
                stroke="url(#flp-grad2)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="25 90"
                />
            </svg>

            <svg
                viewBox="0 0 56 56"
                width="56"
                height="56"
                fill="none"
                style={{
                position: 'absolute',
                inset: 0,
                animation: 'flp-spin 1.1s linear infinite',
                }}
            >
                <defs>
                <linearGradient id="flp-grad3" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#5b8cff" />
                    <stop offset="100%" stopColor="#0e77e8" />
                </linearGradient>
                </defs>
                <circle
                cx="28"
                cy="28"
                r="10"
                stroke="url(#flp-grad3)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="12 50"
                />
            </svg>

            <span
                aria-hidden
                style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: '8px',
                height: '8px',
                borderRadius: '9999px',
                background: '#2563eb',
                transform: 'translate(-50%, -50%)',
                animation: 'flp-pulse 1.5s ease-in-out infinite',
                }}
            />
            </div>

            <div
            style={{
                fontSize: '14px',
                color: '#4b5563',
                animation: 'flp-pulse 1.8s ease-in-out infinite',
            }}
            >
            {label}
            </div>
        </div>

        <style>{`
            @keyframes flp-spin { to { transform: rotate(360deg); } }
            @keyframes flp-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        `}</style>
        </div>
    );
}