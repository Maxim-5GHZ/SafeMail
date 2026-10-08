'use client';

import { useEffect, useState } from 'react';
import { Save, Server, Globe } from 'lucide-react';
import { ApiError, getSystemSettings, updateSystemSettings, type SystemSettingsDto } from '@/lib/api';

export default function DomainSettings({ token }: { token: string }) {
  const [loaded, setLoaded] = useState(false);
  const [primary, setPrimary] = useState('');
  const [aliases, setAliases] = useState('');
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relayHost, setRelayHost] = useState('localhost');
  const [relayPort, setRelayPort] = useState(1025);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    getSystemSettings(token)
      .then((s: SystemSettingsDto) => {
        setPrimary(s.primaryDomain);
        setAliases((s.allowedDomains || []).join(', '));
        setRelayEnabled(s.relayEnabled);
        setRelayHost(s.relayHost || 'localhost');
        setRelayPort(s.relayPort || 1025);
        setLoaded(true);
      })
      .catch((e) => setMsg({ text: e instanceof ApiError ? e.message : 'Ошибка сети', ok: false }));
  }, [token]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const allowedList = aliases
        .split(/[,;\s]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      const res = await updateSystemSettings(token, {
        primaryDomain: primary.trim().toLowerCase(),
        allowedDomains: allowedList,
        relayEnabled,
        relayHost,
        relayPort: Number(relayPort),
      });
      setPrimary(res.primaryDomain);
      setAliases((res.allowedDomains || []).join(', '));
      setRelayEnabled(res.relayEnabled);
      const moved: string[] = [];
      if ((res.rebasedRules ?? 0) > 0) moved.push(`адреса ИБ: ${res.rebasedRules}`);
      if ((res.rebasedUsers ?? 0) > 0) moved.push(`ящики: ${res.rebasedUsers}`);
      const skipped = res.skippedUsers ?? [];
      setMsg({
        text: 'Настройки почты сохранены и применены.'
          + (moved.length > 0 ? ` На новый домен пересажено — ${moved.join(', ')}.` : '')
          + (skipped.length > 0 ? ` Пропущены (такой ящик уже занят): ${skipped.join(', ')}.` : ''),
        ok: skipped.length === 0,
      });
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Ошибка сети', ok: false });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded && !msg) {
    return (
      <div className="rounded-2xl px-4 py-3 text-sm
                      bg-white/40 backdrop-blur-2xl border border-white/50
                      shadow-[0_8px_24px_rgba(31,38,135,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]">
        <div className="w-32 h-4 mb-2 rounded bg-slate-200/70 animate-pulse" />
        <div className="w-64 h-3 rounded bg-slate-200/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl px-5 py-4
                    bg-white/40 backdrop-blur-2xl backdrop-saturate-150
                    border border-white/50
                    shadow-[0_8px_24px_rgba(31,38,135,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-bold text-slate-800">Почтовый домен и приём писем</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Основной домен и алиасы, на которые шлюз принимает входящие (например, с Gmail).
        Письма на любой из доменов попадают в один ящик пользователя. Применяется сразу, без пересборки.
      </p>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-xs mb-3 border ${
          msg.ok
            ? 'bg-emerald-50/80 backdrop-blur-sm text-emerald-800 border-emerald-200/60'
            : 'bg-rose-50/80 backdrop-blur-sm text-rose-800 border-rose-200/60'
        }`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={save} className="flex flex-col max-w-xl gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-bold text-slate-700">Основной домен</span>
          <input
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            placeholder="mail.hotcodeband.ru"
            required
            className="w-full px-3 py-2 rounded-lg font-mono text-sm outline-none transition
                       bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800
                       placeholder:text-slate-400
                       focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          />
          <span className="text-slate-400">Новые ящики создаются на нём. MAIL_DOMAIN в .env — только сид при первом старте.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-bold text-slate-700">Алиасы через запятую</span>
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="hotcodeband.ru, mail.hotcodeband.ru"
            className="w-full px-3 py-2 rounded-lg font-mono text-sm outline-none transition
                       bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800
                       placeholder:text-slate-400
                       focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70 focus:border-white/90
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          />
          <span className="text-slate-400">Основной домен подставляется сам, дубли уберутся.</span>
        </label>

        <label className="flex items-center gap-2 font-bold cursor-pointer text-slate-700">
          <input
            type="checkbox"
            checked={relayEnabled}
            onChange={(e) => setRelayEnabled(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600"
          />
          <Server className="w-3.5 h-3.5 text-slate-500" />
          Исходящий SMTP-релей (пересылка чистых писем дальше)
        </label>
        <p className="-mt-2 text-slate-400">
          Выключено (по умолчанию): SafeMail — конечный ящик, чистая почта сразу во «Входящих».
          Включай, только если дальше по цепочке стоит настоящий почтовый сервер.
        </p>

        {relayEnabled && (
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col col-span-2 gap-1">
              <span className="text-slate-500">Хост релея</span>
              <input
                value={relayHost}
                onChange={(e) => setRelayHost(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg font-mono text-xs outline-none transition
                           bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800
                           focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Порт</span>
              <input
                type="number"
                value={relayPort}
                onChange={(e) => setRelayPort(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded-lg font-mono text-xs outline-none transition
                           bg-white/60 backdrop-blur-sm border border-white/70 text-slate-800
                           focus:bg-white/85 focus:ring-2 focus:ring-blue-300/70"
              />
            </label>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={saving || !primary.trim()}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-medium
                       bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition
                       shadow-[0_2px_8px_rgba(37,99,235,0.30)]"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}