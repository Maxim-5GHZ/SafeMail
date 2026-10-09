// Живая лента угроз (SSE): GET /backend/v1/admin/events?access_token=.
// EventSource не умеет ставить Authorization-заголовок — токен идёт query-параметром,
// бэк принимает его только на этом пути (см. JwtAuthFilter). Переподключение
// из коробки (бэк шлёт retry), heartbeat каждые 20с держит соединение живым.
import { useEffect, useRef, useState } from 'react';
import type { ThreatCategory } from './types';

export interface ThreatPing {
  messageId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  category: ThreatCategory;
  confidence: number;
  createdAt: string;
}

export function useThreatFeed(token: string | null, onThreat: (t: ThreatPing) => void): boolean {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onThreat);
  cbRef.current = onThreat;

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }
    const es = new EventSource(
      `/backend/v1/admin/events?access_token=${encodeURIComponent(token)}`,
    );
    const onMsg = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Partial<ThreatPing>;
        if (data && typeof data.messageId === 'string' && typeof data.category === 'string') {
          cbRef.current(data as ThreatPing);
        }
      } catch {
        /* битый фрейм — игнор, следующий придёт */
      }
    };
    es.addEventListener('threat', onMsg as EventListener);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => {
      es.close();
      setConnected(false);
    };
  }, [token]);

  return connected;
}
