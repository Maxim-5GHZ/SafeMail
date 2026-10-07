'use client';

export type Folder = 'inbox' | 'sent';

interface Props {
  folder: Folder;
  onFolder: (f: Folder) => void;
  onCompose: () => void;
  email: string | null;
}

export default function Sidebar({ folder, onFolder, onCompose, email }: Props) {
  const item = (f: Folder, label: string) => (
    <button
      onClick={() => onFolder(f)}
      className={`w-full text-left px-4 py-2 rounded-r-full text-sm ${
        folder === f ? 'bg-blue-100 text-blue-800 font-semibold' : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col py-4 pr-3">
      <button
        onClick={onCompose}
        className="mx-4 mb-4 px-4 py-2.5 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-700 shadow"
      >
        + Написать
      </button>
      <nav className="flex flex-col gap-0.5">
        {item('inbox', 'Входящие')}
        {item('sent', 'Отправленные')}
      </nav>
      <div className="mt-auto px-4 pt-4 text-xs text-gray-400 break-all">{email}</div>
    </aside>
  );
}
