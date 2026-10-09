'use client';

import { useState } from 'react';

// --- ДАННЫЕ СЦЕНАРИЕВ ---
type BubbleType = 'info' | 'success' | 'warning' | 'error';

interface ScenarioStep {
  node: string;
  text: string;
  type: BubbleType;
}

const SCENARIO_CLEAN: ScenarioStep[] = [
  { node: 'IN', text: 'Письмо: "Отчет за Q3.pdf"', type: 'info' },
  { node: 'GATEWAY', text: 'SMTP: 250 OK (Принято)', type: 'info' },
  { node: 'QUEUE', text: 'В очереди (ID: 401)', type: 'info' },
  { node: 'PARSER', text: 'Извлечен текст (2 КБ)', type: 'info' },
  { node: 'ENRICH', text: 'Аномалий и маскировки нет', type: 'info' },
  { node: 'CLASSIFY', text: 'SLM: Норма (0.95)', type: 'success' },
  { node: 'VERDICT', text: 'Риск 0% (ЧИСТО)', type: 'success' },
  { node: 'OUT_CLEAN', text: 'Доставлено адресату', type: 'success' },
];

const SCENARIO_OBFUSCATED: ScenarioStep[] = [
  { node: 'IN', text: 'Письмо: "з.а.л.о.ж.и.л.и б0м6у"', type: 'error' },
  { node: 'GATEWAY', text: 'SMTP: 250 OK (Принято)', type: 'info' },
  { node: 'QUEUE', text: 'В очереди (ID: 402)', type: 'info' },
  { node: 'PARSER', text: 'Текст (21 байт)', type: 'info' },
  { node: 'ENRICH', text: 'Деобфускация: "заложили бомбу"', type: 'warning' },
  { node: 'CLASSIFY', text: 'Эвристика: TERRORISM', type: 'error' },
  { node: 'VERDICT', text: 'Риск 94% (УГРОЗА)', type: 'error' },
  { node: 'OUT_THREAT', text: 'Карантин + Алерт в ИБ', type: 'error' },
];

const SCENARIO_SEMANTIC: ScenarioStep[] = [
  { node: 'IN', text: 'Письмо: "переведи крипту иначе конец"', type: 'error' },
  { node: 'GATEWAY', text: 'SMTP: 250 OK (Принято)', type: 'info' },
  { node: 'QUEUE', text: 'В очереди (ID: 403)', type: 'info' },
  { node: 'PARSER', text: 'Текст (37 байт)', type: 'info' },
  { node: 'ENRICH', text: 'Маскировки нет', type: 'info' },
  { node: 'CLASSIFY', text: 'SLM: Шантаж (0.88)', type: 'error' },
  { node: 'VERDICT', text: 'Риск 88% (УГРОЗА)', type: 'error' },
  { node: 'OUT_THREAT', text: 'Карантин + Алерт в ИБ', type: 'error' },
];

// Координаты центров верхних граней нод (для позиционирования бабблов)
const NODE_COORDS: Record<string, { x: number; y: number }> = {
  IN: { x: 101, y: 190 },
  GATEWAY: { x: 323, y: 190 },
  QUEUE: { x: 553, y: 190 },
  PARSER: { x: 801, y: 50 },
  ENRICH: { x: 801, y: 190 },
  CLASSIFY: { x: 801, y: 330 },
  VERDICT: { x: 978, y: 204 }, // верх круга
  OUT_CLEAN: { x: 1221, y: 103 },
  OUT_THREAT: { x: 1221, y: 267 },
};

// --- КОМПОНЕНТ БАББЛА (СДЕЛАЛИ КРУПНЕЕ) ---
function Bubble({ x, y, text, type }: { x: number; y: number; text: string; type: BubbleType }) {
  const styles = {
    info: { bg: 'bg-blue-600', border: 'border-blue-400' },
    success: { bg: 'bg-emerald-600', border: 'border-emerald-400' },
    warning: { bg: 'bg-amber-500', border: 'border-amber-300' },
    error: { bg: 'bg-rose-600', border: 'border-rose-400' },
  };

  const s = styles[type];
  const w = 260; // Было 180, стало 260
  const h = 72;  // Было 54, стало 72
  const fx = x - w / 2;
  const fy = y - h - 18; // Чуть выше над блоком

  return (
    <foreignObject x={fx} y={fy} width={w} height={h + 15} className="overflow-visible animate-fadeIn">
      <div className={`relative flex items-center justify-center w-full h-[72px] px-4 py-2 rounded-2xl border-2 shadow-2xl ${s.bg} ${s.border}`}>
        <span className="text-[16px] font-black text-white text-center leading-tight drop-shadow-md tracking-wide">
          {text}
        </span>
        {/* Хвостик вниз (тоже чуть больше) */}
        <div className={`absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-r-2 border-b-2 ${s.bg} ${s.border}`}></div>
      </div>
    </foreignObject>
  );
}

// --- ОСНОВНАЯ SVG СХЕМА ---
function DesktopScheme({ activeStep }: { activeStep: ScenarioStep | null }) {
  const tag = { fontSize: 13, fill: '#4F6590', fontFamily: 'monospace', fontWeight: 'bold' } as const;
  const name = { fontSize: 21, fill: '#101C4C', fontWeight: 'bold' } as const;
  const sub = { fontSize: 15, fill: '#4F6590' } as const;
  
  const activeNode = activeStep?.node;

  const getNodeStyle = (id: string, defaultStroke: string, activeGlow: string = '#60a5fa') => {
    const isActive = activeNode === id;
    return {
      fill: isActive ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
      stroke: isActive ? activeGlow : defaultStroke,
      strokeWidth: isActive ? 3 : 1.5,
      filter: isActive ? `drop-shadow(0 0 8px ${activeGlow})` : 'none',
      transition: 'all 1s ease',
    };
  };

  return (
    // Еще расширили viewBox сверху (-120), чтобы огромные бабблы точно влезли
    <svg viewBox="0 -120 1400 600" className="w-full h-auto max-h-[44vh]" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#475569" />
        </marker>
      </defs>

      {/* Трубы потока */}
      <g stroke="rgba(16,28,76,1)" strokeWidth="2" fill="none" markerEnd="url(#arr)">
        <path d="M 182 240 H 230" />
        <path d="M 414 240 H 460" />
        <path d="M 644 228 C 672 190, 672 130, 700 100" />
        <path d="M 644 240 H 698" />
        <path d="M 644 252 C 672 290, 672 340, 700 378" />
        <path d="M 902 100 C 932 135, 946 180, 956 215" />
        <path d="M 902 240 H 940" />
        <path d="M 902 378 C 932 345, 946 300, 956 265" />
        <path d="M 1008 220 C 1032 195, 1042 175, 1060 158" />
        <path d="M 1008 260 C 1032 285, 1042 305, 1060 322" />
      </g>

      {/* Узлы (Блоки) */}
      <g textAnchor="middle">
        <rect x="20" y="190" width="162" height="100" rx="14" {...getNodeStyle('IN', 'rgba(16,28,76,1)')} />
        <text x="101" y="218" style={tag}>ВХОД</text>
        <text x="101" y="244" style={name}>Письмо</text>
        <text x="101" y="266" style={sub}>внешний поток</text>

        <rect x="232" y="190" width="182" height="100" rx="14" {...getNodeStyle('GATEWAY', 'rgba(16,28,76,1)', '#c084fc')} />
        <text x="323" y="218" style={{ ...tag, fill: '#101C4C' }}>ПРИЁМ</text>
        <text x="323" y="244" style={name}>Mail Gateway</text>
        <text x="323" y="266" style={sub}>забирает за 1мс</text>

        <rect x="462" y="190" width="182" height="100" rx="14" {...getNodeStyle('QUEUE', 'rgba(16,28,76,1)', '#22d3ee')} />
        <text x="553" y="218" style={{ ...tag, fill: '#101C4C' }}>ОЧЕРЕДЬ</text>
        <text x="553" y="244" style={name}>Postgres Queue</text>
        <text x="553" y="266" style={sub}>ждёт в базе</text>

        {/* 3 ML потока */}
        <rect x="700" y="50" width="202" height="100" rx="14" {...getNodeStyle('PARSER', 'rgba(16,28,76,1)')} />
        <text x="801" y="78" style={{ ...tag, fill: '#101C4C' }}>ПОТОК 1</text>
        <text x="801" y="103" style={{ ...name, fontSize: 19 }}>ml-parser</text>
        <text x="801" y="125" style={sub}>извлечение текста</text>

        <rect x="700" y="190" width="202" height="100" rx="14" {...getNodeStyle('ENRICH', 'rgba(16,28,76,1)', '#fbbf24')} />
        <text x="801" y="218" style={{ ...tag, fill: '#101C4C' }}>ПОТОК 2</text>
        <text x="801" y="244" style={name}>ml-enrich</text>
        <text x="801" y="266" style={sub}>деобфускация</text>

        <rect x="700" y="330" width="202" height="100" rx="14" {...getNodeStyle('CLASSIFY', 'rgba(16,28,76,1)', '#34d399')} />
        <text x="801" y="358" style={{ ...tag, fill: '#101C4C' }}>ПОТОК 3</text>
        <text x="801" y="383" style={{ ...name, fontSize: 19 }}>ml-classify</text>
        <text x="801" y="405" style={sub}>SLM + Эвристика</text>

        <circle cx="978" cy="240" r="36" {...getNodeStyle('VERDICT', 'rgba(16,28,76,1)', 'rgba(16,28,76,1)')} />
        <text x="978" y="246" style={{ ...sub, fill: '#101C4C' }}>вердикт</text>

        {/* Итоги */}
        <rect x="1062" y="103" width="318" height="110" rx="14" {...getNodeStyle('OUT_CLEAN', 'rgba(16,28,76,1)', '#10b981')} fill="rgba(52,211,153,0.05)" />
        <text x="1221" y="135" style={{ ...tag, fill: '#101C4C' }}>ЧИСТО</text>
        <text x="1221" y="162" style={name}>Получателю</text>
        <text x="1221" y="186" style={sub}>без задержек и изменений</text>

        <rect x="1062" y="267" width="318" height="110" rx="14" {...getNodeStyle('OUT_THREAT', 'rgba(16,28,76,1)', '#ef4444')} fill="rgba(251,113,133,0.07)" />
        <text x="1221" y="299" style={{ ...tag, fill: '#101C4C' }}>УГРОЗА</text>
        <text x="1221" y="326" style={name}>В карантин</text>
        <text x="1221" y="350" style={sub}>щит + заключение для ИБ</text>
      </g>

      {/* Отрисовка активного баббла */}
      {activeStep && (
        <Bubble 
          x={NODE_COORDS[activeNode!].x} 
          y={NODE_COORDS[activeNode!].y} 
          text={activeStep.text} 
          type={activeStep.type} 
        />
      )}
    </svg>
  );
}

// --- ГЛАВНЫЙ КОМПОНЕНТ ---
export default function PipelineDiagram() {
  const [activeScenarioName, setActiveScenarioName] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState<number>(-1);
  const [isRunning, setIsRunning] = useState(false);

  let currentSteps: ScenarioStep[] = [];
  if (activeScenarioName === 'clean') currentSteps = SCENARIO_CLEAN;
  if (activeScenarioName === 'obf') currentSteps = SCENARIO_OBFUSCATED;
  if (activeScenarioName === 'semantic') currentSteps = SCENARIO_SEMANTIC;

  const activeStep = stepIdx >= 0 && stepIdx < currentSteps.length ? currentSteps[stepIdx] : null;

  const playScenario = (name: string) => {
    if (isRunning) return;
    setIsRunning(true);
    setActiveScenarioName(name);
    setStepIdx(0);

    let current = 0;
    const stepsLen = name === 'clean' ? SCENARIO_CLEAN.length : SCENARIO_OBFUSCATED.length;

    // Шаг каждые 1.2 секунды
    const timer = setInterval(() => {
      current++;
      if (current >= stepsLen) {
        clearInterval(timer);
        // Оставляем финальный статус гореть еще секунду, потом отпускаем флаг
        setTimeout(() => setIsRunning(false), 1000);
      } else {
        setStepIdx(current);
      }
    }, 1200);
  };

  return (
    <div className="w-full max-w-6xl flex flex-col items-center">
      
      {/* Кнопки управления симуляцией */}
      <div className="flex flex-wrap justify-center gap-3 mb-4 relative z-10">
        <span className="flex items-center text-xs font-mono uppercase mr-2 tracking-widest">
          Симуляция:
        </span>
        <button 
          onClick={() => playScenario('clean')}
          disabled={isRunning}
          className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all border ${
            activeScenarioName === 'clean' && isRunning 
              ? 'bg-[#101C4C] text-[#ECF3FB]' 
              : 'bg-[#ECF3FB] border-[#101C4C] text-[#101C4C] hover:bg-[#ECF3FB]/80'
          }`}
        >
          Легитимное письмо
        </button>
        <button 
          onClick={() => playScenario('obf')}
          disabled={isRunning}
          className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all border ${
            activeScenarioName === 'obf' && isRunning 
              ? 'bg-[#101C4C] text-[#ECF3FB]' 
              : 'bg-[#ECF3FB] border-[#101C4C] text-[#101C4C] hover:bg-[#ECF3FB]/80'
          } `}
        >
          Скрытая угроза
        </button>
        <button 
          onClick={() => playScenario('semantic')}
          disabled={isRunning}
          className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all border ${
            activeScenarioName === 'semantic' && isRunning 
              ? 'bg-[#101C4C] text-[#ECF3FB]' 
              : 'bg-[#ECF3FB] border-[#101C4C] text-[#101C4C] hover:bg-[#ECF3FB]/80'
          } `}
        >
          Zero-Day
        </button>
      </div>

      {/* Сама схема */}
      <div className="w-full">
        <DesktopScheme activeStep={activeStep} />
      </div>
    </div>
  );
}