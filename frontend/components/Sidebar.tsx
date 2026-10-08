'use client';

import { Inbox, Send, PenSquare } from 'lucide-react';

export type Folder = 'inbox' | 'sent';

interface Props {
  folder: Folder;
  onFolder: (f: Folder) => void;
  onCompose: () => void;
  email: string | null;
}

const FOLDERS: { id: Folder; label: string; icon: React.ReactNode }[] = [
  { id: 'inbox', label: 'Входящие', icon: <Inbox className="w-4 h-4" /> },
  { id: 'sent', label: 'Отправленные', icon: <Send className="w-4 h-4" /> },
];

export default function Sidebar({ folder, onFolder, onCompose, email }: Props) {
  return (
    <aside
      className="w-60 shrink-0 flex flex-col overflow-hidden
                 rounded-2xl
                 bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                 border border-white/50
                 shadow-[0_8px_32px_rgba(31,38,135,0.10),inset_0_1px_0_rgba(255,255,255,0.85)]"
    >
      <div className="flex flex-col gap-2 p-3">
        <button
          onClick={onCompose}
          className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl
                     text-sm font-medium
                     bg-blue-600 text-white hover:bg-blue-700 transition
                     shadow-[0_2px_8px_rgba(37,99,235,0.30)]"
        >
          <PenSquare className="w-4 h-4" />
          Написать
        </button>

        <nav className="flex flex-col gap-0.5 mt-1">
          {FOLDERS.map((f) => {
            const active = folder === f.id;
            return (
              <button
                key={f.id}
                onClick={() => onFolder(f.id)}
                className={`inline-flex items-center gap-2.5 w-full px-3 py-2 rounded-lg
                            text-sm text-left transition-all duration-200 ${
                              active
                                ? 'bg-white/90 text-slate-900 font-medium shadow-[0_1px_4px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                            }`}
              >
                <span className={active ? 'text-blue-600' : 'text-slate-400'}>
                  {f.icon}
                </span>
                {f.label}
              </button>
            );
          })}
        </nav>
      </div>

      {email && (
        <div className="p-3 mt-auto border-t border-white/40">
          <div
            className="text-[11px] font-mono leading-snug text-slate-400 break-all"
            title={email}
          >
            {email}
          </div>
        </div>
      )}
    </aside>
  );
}