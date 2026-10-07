'use client';

interface Props {
  query: string;
  onQuery: (q: string) => void;
  email: string | null;
  role: string | null;
  onLogout: () => void;
}

export default function TopBar({ query, onQuery, email, role, onLogout }: Props) {
  return (
    <header className="h-14 flex items-center gap-4 px-4 bg-white border-b border-gray-200 shrink-0">
      <div className="font-bold text-lg text-blue-700 whitespace-nowrap">SafeMail</div>
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Поиск: тема, текст, отправитель…"
        className="flex-1 max-w-2xl px-4 py-2 bg-gray-100 rounded-full outline-none focus:bg-white focus:ring-2 focus:ring-blue-300"
      />
      <div className="ml-auto flex items-center gap-3">
        {role === 'ADMIN' && (
          <a href="/admin" className="text-sm px-3 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200">
            Пульт ИБ
          </a>
        )}
        <span className="text-sm text-gray-600 hidden sm:inline" title={email ?? ''}>
          {email}
        </span>
        <button onClick={onLogout} className="text-sm text-gray-500 hover:text-gray-800" title="Выйти">
          Выйти
        </button>
      </div>
    </header>
  );
}
