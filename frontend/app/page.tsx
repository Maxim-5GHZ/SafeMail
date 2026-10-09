// frontend/app/page.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useAuth, homeForRole, roleOf } from '@/lib/auth';
import { LogoMark } from '@/components/Logo';
import PipelineDiagram from '@/components/PipelineDiagram';
import { GovIcon, BankIcon, FactoryIcon, CorpIcon, WarnIcon, SearchIcon, MaskIcon, ShieldIcon, UserIcon, HackerIcon, LightningIcon, CloudIcon, CheckIcon } from '@/components/icons';

interface Slide {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  content: ReactNode;
}

// --- ИНТЕРАКТИВ 1: СИМУЛЯТОР ФИЛЬТРА (Слайд 2) ---
function FilterSimulator() {
  const [activeCase, setActiveCase] = useState(0);
  
  const cases = [
    {
      title: 'Ложное срабатывание',
      text: 'Заказ: 15 кг хлора для бассейна. Срочно.',
      dumb: { status: 'БЛОКИРОВКА', reason: 'Найдено стоп-слово "хлор". Письмо не дошло до отдела закупок.', color: 'text-[#E74040]', bg: 'bg-[#E74040]/10' },
      smart: { status: 'ПРОПУЩЕНО', reason: 'ИИ понял контекст: это бытовая закупка, а не химическая угроза.', color: 'text-[#31A275]', bg: 'bg-[#31A275]/10' },
    },
    {
      title: 'Маскировка',
      text: 'н4 п3р3гоне сх0д ц1ст3рн с хл0р0м',
      dumb: { status: 'ПРОПУЩЕНО', reason: 'Слова не найдены в словаре. Угроза в ящике сотрудника.', color: 'text-[#E74040]', bg: 'bg-[#E74040]/10' },
      smart: { status: 'БЛОКИРОВКА', reason: 'Деобфускатор снял маскировку -> ИИ распознал техногенную угрозу.', color: 'text-[#31A275]', bg: 'bg-[#31A275]/10' },
    },
    {
      title: 'Смысловой парафраз',
      text: 'Переведи монеты на кошелек, иначе твоей семье конец',
      dumb: { status: 'ПРОПУЩЕНО', reason: 'Нет явных стоп-слов. Письмо доставлено.', color: 'text-[#E74040]', bg: 'bg-[#E74040]/10' },
      smart: { status: 'БЛОКИРОВКА', reason: 'SLM понял смысл: Шантаж/Вымогательство. Письмо отправлено в ИБ.', color: 'text-[#31A275]', bg: 'bg-[#31A275]/10' },
    }
  ];

  return (
    <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 gap-6 bg-[#ECF3FB] p-6 rounded-3xl border border-white/10 backdrop-blur-md">
      <div className="md:col-span-4 flex flex-col gap-2">
        <div className="text-xs font-mono uppercase text-[#101C4C] mb-2">Выберите сценарий атаки:</div>
        {cases.map((c, i) => (
          <button
            key={i}
            onClick={() => setActiveCase(i)}
            className={`text-left px-4 py-3 rounded-xl text-base transition-all border ${
              activeCase === i 
              ? 'bg-[#101C4C] text-[#ECF3FB]' 
              : 'bg-white/5 border-transparent text-[#101C4C] hover:bg-white/10'
            }`}
          >
            <div className="font-bold mb-1 leading-tight">{c.title}</div>
            <div className="text-sm opacity-70 truncate mt-1">{c.text}</div>
          </button>
        ))}
      </div>

      <div className="md:col-span-8 flex flex-col gap-4">
        <div className="bg-[#ECF3FB] rounded-xl p-4 border border-slate-800 font-mono text-base text-[#4F6590]">
          <span className="text-[#101C4C]">Входящее письмо:</span> <br/>
          &gt; {cases[activeCase].text}
        </div>

        <div className="grid grid-cols-2 gap-4 h-full">
          <div className={`rounded-xl p-5 border border-[#E74040] flex flex-col justify-between transition-colors ${cases[activeCase].dumb.bg}`}>
            <div>
              <div className="text-xs font-bold uppercase text-[#101C4C] mb-4">Устаревший фильтр</div>
              <div className={`text-2xl font-black tracking-wider ${cases[activeCase].dumb.color}`}>
                {cases[activeCase].dumb.status}
              </div>
            </div>
            <div className="text-sm text-[#101C4C] mt-4 border-t border-[#E74040] pt-2 leading-relaxed">
              Итог: {cases[activeCase].dumb.reason}
            </div>
          </div>

          <div className={`rounded-xl p-5 border border-slate-700/50 flex flex-col justify-between transition-colors relative overflow-hidden ${cases[activeCase].smart.bg}`}>
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 rounded-full blur-xl" />
            <div className="relative z-10">
              <div className="text-xs font-bold uppercase text-[#101C4C] mb-4 flex items-center gap-2">
                СейфМейл
              </div>
              <div className={`text-2xl font-black tracking-wider ${cases[activeCase].smart.color}`}>
                {cases[activeCase].smart.status}
              </div>
            </div>
            <div className="text-sm text-[#4F6590] mt-4 border-t border-slate-700/50 pt-2 leading-relaxed relative z-10">
              Итог: {cases[activeCase].smart.reason}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- ИНТЕРАКТИВ 2: ПОЛЬЗОВАТЕЛЬСКИЙ ПУТЬ (ЛЕСЕНКА) (Слайд 4) ---
function UserJourneyStaircase() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      title: "Разведка",
      desc: "Хакер находит email сотрудника.",
      icon: <SearchIcon className="w-7 h-7" />,
      danger: "Письмо формируется под конкретного человека (социальная инженерия).",
      safe: "Мы не отсвечиваем наружу. Хакер не знает, какая защита его ждёт."
    },
    {
      title: "Маскировка угрозы",
      desc: "Создание обфусцированного текста или хитрого PDF.",
      icon: <MaskIcon className="w-7 h-7" />,
      danger: "Обычный антиспам легко обмануть опечатками или макросом в архиве.",
      safe: "Наш пайплайн вскрывает архивы и смывает любую маскировку текста."
    },
    {
      title: "Периметр (Шлюз)",
      desc: "Письмо стучится на почтовый сервер.",
      icon: <ShieldIcon className="w-7 h-7" />,
      danger: "Без защиты письмо летит прямо в ящик сотруднику за 1 секунду.",
      safe: "СейфМейл перехватывает письмо. Нейросеть анализирует его смысл."
    },
    {
      title: "Ящик сотрудника",
      desc: "Сотрудник видит письмо и готов кликнуть.",
      icon: <UserIcon className="w-7 h-7" />,
      danger: "Человеческий фактор: клик по фишинговой ссылке шифрует всю сеть.",
      safe: "Угрозы НЕТ в ящике. Она в карантине, а ИБ-офицер уже получил алерт."
    }
  ];

  // Отступы лесенки — чистый CSS (без window.innerWidth: SSR/зум стабильны,
  // последний шаг 36% + ширина карточки не вылезают за контейнер).
  const indents = ['md:ml-0', 'md:ml-[12%]', 'md:ml-[24%]', 'md:ml-[36%]'];

  return (
    <div className="w-full max-w-5xl flex flex-col md:flex-row gap-8 items-center bg-[#ECF3FB] p-6 rounded-3xl border border-white/5 backdrop-blur-md">
      <div className="flex-1 flex flex-col w-full relative min-w-0">
        {steps.map((step, idx) => (
          <div 
            key={idx} 
            className={`relative flex items-center gap-5 p-4 cursor-pointer transition-all duration-500 rounded-2xl min-w-0 ${indents[idx]} ${
              activeStep === idx ? 'bg-white/10 shadow-xl z-10 border border-white/10' : 'hover:bg-white/5 opacity-50 hover:opacity-80'
            }`}
            onClick={() => setActiveStep(idx)}
            onMouseEnter={() => setActiveStep(idx)}
          >
            <div className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center border-2 transition-colors ${
              activeStep === idx 
                ? 'bg-[#101C4C] text-[#ECF3FB] border-[#101C4C]'   // светлая иконка на тёмном фоне
                : 'bg-[#ECF3FB] text-[#4F6590] border-[#4F6590]'  
            }`}>
              {step.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[#101C4C] text-base tracking-wide">{step.title}</div>
              <div className="text-sm text-[#101C4C] mt-1 max-w-[240px] leading-relaxed">{step.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 w-full bg-[#ECF3FB] rounded-2xl border border-slate-800 p-6 shadow-2xl flex flex-col gap-6 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-blue-600/10 blur-[50px] rounded-full pointer-events-none" />
        <h3 className="text-xl font-black text-[#101C4C] border-b border-slate-800 pb-4 flex items-center gap-3">
          <span className="text-[#101C4C] [&>svg]:w-7 [&>svg]:h-7">{steps[activeStep].icon}</span>
          Этап: {steps[activeStep].title}
        </h3>
        <div className="flex flex-col gap-4 relative z-10">
          <div className="bg-[#E74040]/10 border border-[#E74040]/20 rounded-xl p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-[#E74040] mb-2">Без нашей защиты</div>
            <div className="text-base text-[#4F6590] leading-relaxed">{steps[activeStep].danger}</div>
          </div>
          <div className="bg-[#31A275]/10 border border-[#31A275]/20 rounded-xl p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-[#31A275] mb-2 flex items-center gap-2">
              СейфМейл
            </div>
            <div className="text-base text-[#4F6590] leading-relaxed">{steps[activeStep].safe}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- ИНТЕРАКТИВ 3: ЦЕЛЕВАЯ АУДИТОРИЯ И БИЗНЕС-МОДЕЛЬ (Слайд 5) ---
function TargetAudienceSimulator() {
  const [activeTab, setActiveTab] = useState(0);

  const tabs = [
    { 
      title: 'Госсектор', 
      icon: <GovIcon />, 
      desc: 'Срыв работы учреждений обходится слишком дорого.',
      threats: {
        title: 'Специфика угроз',
        text: 'Анонимные письма о минировании парализуют работу ведомств. Регулярные попытки кражи данных (ДСП) через социальную инженерию.'
      },
      solution: {
        title: 'Ценность СейфМейл',
        text: 'Точное распознавание категории «Терроризм» при любой маскировке текста. Полностью изолированная установка в закрытом контуре (152-ФЗ).'
      }
    },
    { 
      title: 'Заводы / ТЭК', 
      icon: <FactoryIcon />, 
      desc: 'Фишинг на инженера может остановить производство.',
      threats: {
        title: 'Специфика угроз',
        text: 'Шифровальщики сетей АСУ ТП, замаскированные под рабочие чертежи (PDF/CAD) или акты сверок для бухгалтерии.'
      },
      solution: {
        title: 'Ценность СейфМейл',
        text: 'Глубокий разбор вложений. Распаковка вложенных архивов и блокировка скриптов (JS/Launch) внутри легитимных на вид PDF-документов.'
      }
    },
    { 
      title: 'Банки', 
      icon: <BankIcon />, 
      desc: 'Защита клиентских баз от целевых атак (APT).',
      threats: {
        title: 'Специфика угроз',
        text: 'Сложный целевой фишинг на топ-менеджмент. Использование подмены алфавита (мимикрия) для обхода стандартных DLP-систем.'
      },
      solution: {
        title: 'Ценность СейфМейл',
        text: 'Нейро-спеллер сглаживает любую маскировку текста до того, как SLM начнет анализ. Zero-Latency архитектура не задерживает чистую почту.'
      }
    },
    { 
      title: 'Корпорации', 
      icon: <CorpIcon />, 
      desc: 'Предотвращение шантажа и компрометации (BEC).',
      threats: {
        title: 'Специфика угроз',
        text: 'Компрометация корпоративной почты (BEC), угрозы расправы, шантаж руководителей. Письма пишутся без стоп-слов, чтобы обойти антиспам.'
      },
      solution: {
        title: 'Ценность СейфМейл',
        text: 'Нейросеть (SLM) понимает контекст и скрытый смысл парафраз. Блокирует угрозу по сути, даже если слова выглядят безобидно.'
      }
    },
  ];

  return (
    <div className="w-full max-w-5xl flex flex-col gap-6">
      
      {/* 1. СТАТИЧНЫЙ БЛОК: Формат поставки (Сверху) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#ECF3FB] border border-[#101C4C]/30 rounded-2xl p-5 relative overflow-hidden group">
          <h3 className="text-xl font-black text-[#101C4C] mb-2 flex items-center gap-2">
            <span className="text-[#101C4C] [&>svg]:w-6 [&>svg]:h-6"><CloudIcon /></span> Облако (SaaS / API)
          </h3>
          <p className="text-base text-[#101C4C] mb-4 leading-relaxed">
            Быстрый старт по подписке (B2B). Вы просто прописываете нас как MX-запись или отправляете текст по API.
          </p>
          <ul className="text-sm text-[#4F6590] space-y-2">
            <li className="flex items-center gap-2"><CheckIcon className="w-4 h-4 text-[#31A275] shrink-0" /> Интеграция за 10 минут</li>
            <li className="flex items-center gap-2"><CheckIcon className="w-4 h-4 text-[#31A275] shrink-0" /> Оплата за объем писем или пользователей</li>
          </ul>
        </div>

        <div className="bg-[#ECF3FB] border border-[#101C4C]/30 rounded-2xl p-5 relative overflow-hidden group">
          <h3 className="text-xl font-black text-[#101C4C] mb-2 flex items-center gap-2">
            <span className="text-[#101C4C] [&>svg]:w-6 [&>svg]:h-6"><CorpIcon /></span> On-Premise (В контуре)
          </h3>
          <p className="text-base text-[#101C4C] mb-4 leading-relaxed">
            Установка на ваши серверы. Никакие данные не покидают закрытый контур компании (Enterprise).
          </p>
          <ul className="text-sm text-[#4F6590] space-y-2">
            <li className="flex items-center gap-2"><CheckIcon className="w-4 h-4 text-[#31A275] shrink-0" /> Полная изоляция данных (152-ФЗ)</li>
            <li className="flex items-center gap-2"><CheckIcon className="w-4 h-4 text-[#31A275] shrink-0" /> Работает на обычных CPU серверах</li>
          </ul>
        </div>
      </div>

      {/* 2. ТАБЫ: Выбор аудитории (Посередине) */}
      <div className="bg-[#ECF3FB] rounded-2xl border border-white/10 p-1.5 flex flex-col md:flex-row gap-1.5 backdrop-blur-md">
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl transition-all duration-300 ${
              activeTab === i ? 'bg-[#101C4C] shadow-[0_0_20px_rgba(59,130,246,0.15)]' : 'hover:bg-[#4F6590]/5 border border-transparent'
            }`}
          >
            <div className={`${activeTab === i ? 'text-[#ECF3FB]' : 'text-[#101C4C]'} mb-2 [&>svg]:w-8 [&>svg]:h-8 transition-colors duration-300`}>{tab.icon}</div>
            <div className={`font-bold text-base ${activeTab === i ? 'text-[#ECF3FB]' : 'text-[#101C4C]'}`}>{tab.title}</div>
            {activeTab === i && <div className="text-m text-[#4F6590] text-center mt-2 animate-fadeIn duration-300">{tab.desc}</div>}
          </button>
        ))}
      </div>

      {/* 3. ДИНАМИЧЕСКИЙ БЛОК: Угрозы и Решения (Снизу) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn" key={activeTab}>
        <div className="bg-[#E74040]/10 border border-[#E74040] rounded-xl p-5 flex flex-col gap-2">
           <h4 className="text-[#E74040] font-bold text-sm uppercase tracking-wider mb-1 flex items-center gap-2">
             <WarnIcon className="w-4 h-4" /> {tabs[activeTab].threats.title}
           </h4>
           <p className="text-[#4F6590] text-base leading-relaxed">
             {tabs[activeTab].threats.text}
           </p>
        </div>
        <div className="bg-[#31A275]/10 border border-[#31A275] rounded-xl p-5 flex flex-col gap-2">
           <h4 className="text-[#101C4C] font-bold text-sm uppercase tracking-wider mb-1 flex items-center gap-2">
             <ShieldIcon className="w-4 h-4" /> {tabs[activeTab].solution.title}
           </h4>
           <p className="text-[#4F6590] text-base leading-relaxed">
             {tabs[activeTab].solution.text}
           </p>
        </div>
      </div>

    </div>
  );
}

// --- ИНТЕРАКТИВ 4: ОКУПАЕМОСТЬ (ШИФРОВАЛЬЩИК VS ЗАЩИТА) (Слайд 6) ---
function RoiSimulator() {
  const [protectedMode, setProtectedMode] = useState(false);
  const [animKey, setAnimKey] = useState(0);

  const toggleMode = (val: boolean) => {
    setProtectedMode(val);
    setAnimKey(prev => prev + 1);
  };

  return (
    <div className="w-full max-w-5xl flex flex-col items-center gap-6">
      <div className="bg-[#ECF3FB] p-1.5 rounded-full border border-[#101C4C] flex gap-1 backdrop-blur-sm relative z-20">
        <button 
          onClick={() => toggleMode(false)}
          className={`px-6 py-2.5 rounded-full text-base font-bold transition-all ${!protectedMode ? 'bg-[#E74040] text-[#ECF3FB]' : 'text-[#101C4C] hover:text-[#101C4C]'}`}
        >
          Без СейфМейл
        </button>
        <button 
          onClick={() => toggleMode(true)}
          className={`px-6 py-2.5 rounded-full text-base font-bold transition-all flex items-center gap-2 ${protectedMode ? 'bg-[#101C4C] text-[#ECF3FB]' : 'text-[#101C4C] hover:text-[#101C4C]'}`}
        >
          С защитой
        </button>
      </div>

      <div key={animKey} className="w-full bg-[#ECF3FB] rounded-3xl border border-slate-800 p-8 shadow-2xl overflow-hidden relative min-h-[440px] flex items-center justify-center">
        {!protectedMode ? (
          <div className="flex flex-col items-center gap-6 w-full max-w-3xl animate-fadeIn">
            <h3 className="text-3xl font-black text-[#101C4C] text-center">Сколько стоит один клик сотрудника?</h3>
            
            <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
              <div className="bg-[#E74040]/10 border border-[#E74040]/50 rounded-xl p-5 flex flex-col items-center text-center">
                <div className="text-sm text-[#101C4C] uppercase tracking-wider mb-2">Выкуп хакерам</div>
                <div className="text-3xl font-mono font-bold text-[#E74040]">~ 20 млн ₽</div>
                <div className="text-[11px] text-slate-600 mt-1">Без гарантии восстановления</div>

              </div>
              <div className="bg-[#E74040]/10 border border-[#E74040]/50 rounded-xl p-5 flex flex-col items-center text-center">
                <div className="text-sm text-[#101C4C] uppercase tracking-wider mb-2">Простой бизнеса</div>
                <div className="text-3xl font-mono font-black text-[#E74040]">~ 45 млн ₽</div>
                <div className="text-[11px] text-slate-600 mt-1">За 1 день паралича сети</div>
              </div>
              <div className="bg-[#E74040]/10 border border-[#E74040]/50 rounded-xl p-5 flex flex-col items-center text-center">
                <div className="text-sm text-[#101C4C] uppercase tracking-wider mb-2">Восстановление</div>
                <div className="text-3xl font-mono font-bold text-[#E74040]">~ 10 млн ₽</div>
                <div className="text-[11px] text-slate-600 mt-1">Аудит, переустановка, штрафы</div>
              </div>
            </div>
            
            <p className="text-base text-[#101C4C] text-center max-w-2xl mt-2 leading-relaxed">
              Устаревшие фильтры не видят контекст угроз. Одно фишинговое письмо с трояном, пропущенное в ящик бухгалтеру, обходится компании в десятки миллионов рублей.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 w-full max-w-3xl animate-fadeIn">
            <h3 className="text-3xl font-black text-[#101C4C] text-center">Окупаемость = 1 заблокированный инцидент</h3>
            
            <div className="w-full flex items-center justify-between gap-4 mt-6">
              <div className="flex-1 bg-[#4F6590]/40 p-6 rounded-xl border border-[#4F6590] opacity-50 flex flex-col items-center text-center">
                <HackerIcon className="w-12 h-12 text-[#101C4C] mb-4" />
                <div className="text-xs font-mono text-[#101C4C] uppercase">Атакующий</div>
                <div className="text-base text-[#101C4C] mt-3 leading-relaxed">«Письма не доходят. Смысла атаковать эту компанию нет.»</div>
              </div>

              <div className="shrink-0 flex flex-col items-center px-4">
                <div className="w-24 h-24 rounded-full bg-[#31A275]/20 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                  <span className='text-[#101C4C]'><LogoMark className="w-12 h-12 text-[#31A275]" /></span>
                </div>
              </div>

              <div className="flex-1 bg-[#ECF3FB] p-6 rounded-xl border border-[#101C4C] flex flex-col items-center text-center shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                <CorpIcon className="w-12 h-12 text-[#101C4C] mb-4" />
                <div className="text-xs font-mono text-[#101C4C] uppercase">Ваш Бизнес</div>
                <div className="text-base text-[#101C4C] mt-3 font-medium leading-relaxed">Работа идет штатно <br/> Убытки: 0 ₽</div>
              </div>
            </div>
            
            <div className="text-center mt-6">
              <p className="text-base text-[#4F6590] max-w-2xl mx-auto leading-relaxed">
                Стоимость лицензии <b className="text-[#101C4C]">СейфМейл</b> несопоставимо мала по сравнению с одним днем простоя компании. Вы платите один раз и навсегда исключаете человеческий фактор.
              </p>
              <div className="mt-8 flex justify-center gap-4">
                <Link
                  href="/admin"
                  className="inline-block px-8 py-3.5 rounded-full bg-[#101C4C] text-white font-bold text-base tracking-wide hover:bg-[#1c2c6e] border border-[#101C4C] shadow-md transition-all duration-300"
                >
                  Защитить свой бизнес
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// --- ОСНОВНОЙ КОМПОНЕНТ ПРЕЗЕНТАЦИИ ---
export default function PresentationPage() {
  const { token } = useAuth();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const containerRef = useRef<HTMLElement>(null);
  const touchStartY = useRef<number>(0);
  const lastScrollTime = useRef<number>(0);

  const homeUrl = token ? homeForRole(roleOf(token)) : '/login';

  const slides: Slide[] = [
    // СЛАЙД 1: ХУК
    {
      id: 'hero',
      badge: 'B2B Решение / SaaS & On-Premise',
      title: 'Интеллектуальный фильтр для защиты корпоративной почты',
      subtitle:
        'СейфМейл блокирует 100% угроз, обманывающих обычные антиспам-системы. Мы понимаем смысл писем и полностью исключаем фактор человеческой ошибки.',
      content: (
        <div className="flex flex-col items-center gap-8 mt-4">
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/admin"
              className="px-8 py-3.5 rounded-full bg-[#101C4C] text-white font-bold text-base tracking-wide hover:bg-[#1c2c6e] border border-[#101C4C] shadow-md transition-all duration-300"
            >
              Смотреть Консоль ИБ (SOC)
            </Link>
            <Link
              href="/inbox"
              className="px-8 py-3.5 rounded-full border border-[#101C4C] text-[#101C4C] bg-white/60 hover:bg-white font-bold text-base tracking-wide shadow-sm transition-all duration-300"
            >
              Ящик сотрудника
            </Link>
          </div>
          <div className="text-xs font-mono text-[#101C4C] flex items-center gap-2 animate-pulse mt-4">
            Листайте вниз для питча ↓
          </div>
        </div>
      ),
    },

    // СЛАЙД 2: ПРОБЛЕМА (ПОЧЕМУ МЫ НУЖНЫ)
    {
      id: 'problem',
      badge: 'Проблема рынка',
      title: 'Устаревшие фильтры пропускают угрозы',
      subtitle:
        'Обычные системы ищут совпадения по словарю, используя регулярные выражения. Хакеры легко обходят их маскировкой. СейфМейл использует нейросеть, чтобы понимать суть текста.',
      content: (
        <FilterSimulator />
      ),
    },

    // СЛАЙД 3: АРХИТЕКТУРА И ЭФФЕКТИВНОСТЬ
    {
      id: 'architecture',
      badge: 'Как это работает (Экономика технологии)',
      title: 'Живой конвейер без космических затрат',
      subtitle:
        'Наша архитектура создана для бизнеса: никаких скрытых плат за облачные токены или закупку дорогих видеокарт.',
      content: (
        <div className="flex flex-col gap-4 w-full items-center">
          <PipelineDiagram />
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-5xl">
            <div className="bg-[#ECF3FB] border border-[#101C4C] rounded-xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 shrink-0 rounded-xl bg-[#4F6590]/20 flex items-center justify-center text-[#4F6590] font-mono font-black text-xl">CPU</div>
              <div>
                <h3 className="text-[#101C4C] font-bold text-base">Обычные серверы (Без GPU)</h3>
                <p className="text-[#101C4C] text-sm mt-1 leading-relaxed">Модель оптимизирована (SLM). Запускается на типовом железе предприятия без покупки мощных видеокарт.</p>
              </div>
            </div>
            <div className="bg-[#ECF3FB] border border-[#101C4C] rounded-xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 shrink-0 rounded-xl bg-[#4F6590]/20 flex items-center justify-center text-[#4F6590] font-mono font-black text-2xl">0₽</div>
              <div>
                <h3 className="text-[#101C4C] font-bold text-base">Без дорогих подписок</h3>
                <p className="text-[#101C4C] text-sm mt-1 leading-relaxed">Локальный инференс. Вам не нужно платить за каждый токен сторонним API (как ChatGPT).</p>
              </div>
            </div>
            <div className="bg-[#ECF3FB] border border-[#101C4C] rounded-xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 shrink-0 rounded-xl bg-[#4F6590]/20 flex items-center justify-center text-[#4F6590]"><LightningIcon className="w-8 h-8" /></div>
              <div>
                <h3 className="text-[#101C4C] font-bold text-base">Zero-Latency</h3>
                <p className="text-[#101C4C] text-sm mt-1 leading-relaxed">Тяжелый ИИ-анализ идёт асинхронно в фоне. Чистая почта пролетает шлюз без задержек.</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    // СЛАЙД 4: ПОЛЬЗОВАТЕЛЬСКИЙ ПУТЬ
    {
      id: 'journey',
      badge: 'Жизненный цикл атаки',
      title: 'Как мы ломаем Kill Chain',
      subtitle: 'Проследите путь целевого фишинга от хакера до почтового ящика. Выберите этап слева.',
      content: (
        <UserJourneyStaircase />
      )
    },

    // СЛАЙД 5: ЦЕЛЕВАЯ АУДИТОРИЯ И БИЗНЕС-МОДЕЛЬ
    {
      id: 'audience',
      badge: 'Для кого мы созданы',
      title: 'Наш рынок и формат поставки',
      subtitle: 'СейфМейл решает критические задачи для крупного бизнеса и госсектора в двух удобных форматах.',
      content: (
        <TargetAudienceSimulator />
      )
    },

    // СЛАЙД 6: ОКУПАЕМОСТЬ
    {
      id: 'roi',
      badge: 'Финансовая выгода',
      title: 'Окупаемость в один клик',
      subtitle: 'Почему внедрение СейфМейл обходится дешевле одного дня простоя?',
      content: (
        <RoiSimulator />
      ),
    },
  ];

  const totalSlides = slides.length;

  const goToSlide = useCallback((index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    const target = Math.max(0, Math.min(index, totalSlides - 1));
    setCurrentSlide(target);
    setTimeout(() => {
      setIsTransitioning(false);
    }, 600);
  }, [isTransitioning, totalSlides]);

  const nextSlide = useCallback(() => {
    if (currentSlide < totalSlides - 1) goToSlide(currentSlide + 1);
  }, [currentSlide, totalSlides, goToSlide]);

  const prevSlide = useCallback(() => {
    if (currentSlide > 0) goToSlide(currentSlide - 1);
  }, [currentSlide, goToSlide]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Если контент слайда выше вьюпорта (зум), сначала даём домотать его
      // нативным скроллом — и только на краю переключаем слайд.
      const el = containerRef.current;
      if (el) {
        const canDown = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
        const canUp = el.scrollTop > 4;
        if ((e.deltaY > 0 && canDown) || (e.deltaY < 0 && canUp)) return;
      }
      e.preventDefault();
      const now = Date.now();
      if (now - lastScrollTime.current < 700) return;
      lastScrollTime.current = now;

      if (e.deltaY > 25) {
        nextSlide();
      } else if (e.deltaY < -25) {
        prevSlide();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const onControl = !!t?.closest?.('button, a');
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !onControl)) {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevSlide();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndY = e.changedTouches[0].clientY;
      const diff = touchStartY.current - touchEndY;
      if (Math.abs(diff) > 50) {
        if (diff > 0) nextSlide();
        else prevSlide();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [nextSlide, prevSlide]);

  const current = slides[currentSlide];

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-[#ECF3FB] text-[#101C4C] select-none font-sans"
    >
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-6 sm:px-10 h-16">
        <div className="flex items-center gap-3">
          <LogoMark className="w-8 h-8" />
          <span className="font-extrabold text-xl tracking-tight bg-[#101C4C] bg-clip-text text-transparent">
            СейфМейл
          </span>
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden lg:flex items-center gap-2">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => goToSlide(idx)}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                idx === currentSlide
                  ? 'w-8 bg-[#101C4C]'
                  : 'w-2 bg-[#101C4C]'
              }`}
              title={`Слайд ${idx + 1}: ${s.title}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={homeUrl}
            className="px-4 py-1.5 rounded-full text-sm font-semibold bg-[#101C4C] hover:bg-[#1c2c6e] border border-[#101C4C] shadow-md transition-all duration-300 flex items-center gap-2 text-white"
          >
            <span>{token ? 'В интерфейс' : 'Войти'}</span>

          </Link>
        </div>
      </header>

      {/* Безопасное центрирование: без justify-center (иначе верх переполненного
          слайда уходит за шапку и недоступен), центрит m-auto на контенте. */}
      <main ref={containerRef} className="relative z-10 w-full h-full flex flex-col items-center px-6 sm:px-12 pt-20 pb-16 max-w-7xl mx-auto overflow-y-auto no-scrollbar">
        <div
          key={current.id}
          className="w-full m-auto flex flex-col items-center transition-all duration-700 ease-out transform animate-fadeIn"
        >
          {/*
          <div className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/15 text-xs font-mono uppercase tracking-wider text-blue-400 mb-3 shadow-sm backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            <span>{current.badge}</span>
          </div>
           */}
          

          <h1 className="shrink-0 text-2xl sm:text-4xl lg:text-[40px] font-black text-center text-[#101C4C] tracking-tight max-w-4xl leading-[1.15] mb-3 text-balance">
            {current.title}
          </h1>

          <p className="shrink-0 text-sm sm:text-base text-[#101C4C] text-center max-w-3xl leading-relaxed mb-6 text-balance">
            {current.subtitle}
          </p>

          <div className="shrink-0 w-full flex justify-center">{current.content}</div>
        </div>
      </main>

      <footer className="absolute bottom-0 inset-x-0 z-30 h-14 px-6 sm:px-10 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 text-sm font-mono text-[#101C4C]">
          <span className="text-[#101C4C] font-bold">{String(currentSlide + 1).padStart(2, '0')}</span>
          <span>/</span>
          <span>{String(totalSlides).padStart(2, '0')}</span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={prevSlide}
            disabled={currentSlide === 0}
            className="w-10 h-10 rounded-full bg-[#101C4C] border border-[#101C4C] shadow-md flex items-center justify-center hover:bg-[#1c2c6e] disabled:opacity-40 disabled:pointer-events-none transition-all text-white text-base"
            title="Предыдущий слайд"
          >
            ↑
          </button>
          <button
            onClick={nextSlide}
            disabled={currentSlide === totalSlides - 1}
            className="w-10 h-10 rounded-full bg-[#101C4C] border border-[#101C4C] shadow-md flex items-center justify-center hover:bg-[#1c2c6e] disabled:opacity-40 disabled:pointer-events-none transition-all text-white text-base"
            title="Следующий слайд"
          >
            ↓
          </button>
        </div>
      </footer>
    </div>
  );
}