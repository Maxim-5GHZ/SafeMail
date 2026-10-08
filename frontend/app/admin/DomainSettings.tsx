'use client';

import { useEffect, useState } from 'react';
import { ApiError, getSystemSettings, updateSystemSettings, type SystemSettingsDto } from '@/lib/api';

/** Домены приёма почты и режим релея: меняется из /admin без пересборки контейнеров. */
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
      setMsg({ text: 'Настройки почты сохранены и применены.', ok: true });
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Ошибка сети', ok: false });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded && !msg) {
    return <div className="bg-base-100 rounded-xl shadow px-4 py-3 text-sm opacity-60">Загрузка настроек…</div>;
  }

  return (
    <div className="bg-base-100 rounded-xl shadow px-4 py-3 mb-4">
      <h3 className="soc-panel-title mb-2">Почтовый домен и приём писем</h3>
      <p className="text-xs opacity-60 mb-3">
        Основной домен и алиасы, на которые шлюз принимает входящие (например, с Gmail).
        Письма на любой из доменов попадают в один ящик пользователя. Применяется сразу, без пересборки.
      </p>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-xs mb-3 ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={save} className="flex flex-col gap-3 max-w-xl text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-bold">Основной домен</span>
          <input
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            placeholder="mail.hotcodeband.ru"
            required
            className="input input-sm input-bordered w-full font-mono"
          />
          <span className="opacity-60">Новые ящики создаются на нём. MAIL_DOMAIN в .env — только сид при первом старте.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-bold">Алиасы через запятую</span>
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="hotcodeband.ru, mail.hotcodeband.ru"
            className="input input-sm input-bordered w-full font-mono"
          />
          <span className="opacity-60">Основной домен подставляется сам, дубли уберутся.</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer font-bold">
          <input
            type="checkbox"
            checked={relayEnabled}
            onChange={(e) => setRelayEnabled(e.target.checked)}
            className="checkbox checkbox-sm"
          />
          Исходящий SMTP-релей (пересылка чистых писем дальше)
        </label>
        <p className="-mt-2 opacity-60">
          Выключено (по умолчанию): SafeMail — конечный ящик, чистая почта сразу во «Входящих».
          Включай, только если дальше по цепочке стоит настоящий почтовый сервер.
        </p>

        {relayEnabled && (
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="opacity-60">Хост релея</span>
              <input
                value={relayHost}
                onChange={(e) => setRelayHost(e.target.value)}
                className="input input-xs input-bordered w-full font-mono"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="opacity-60">Порт</span>
              <input
                type="number"
                value={relayPort}
                onChange={(e) => setRelayPort(Number(e.target.value))}
                className="input input-xs input-bordered w-full font-mono"
              />
            </label>
          </div>
        )}

        <div>
          <button type="submit" disabled={saving || !primary.trim()} className="btn btn-sm btn-primary px-6">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}
