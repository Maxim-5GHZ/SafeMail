'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, homeForRole, roleOf } from '@/lib/auth';

export default function Home() {
  const { ready, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(token ? homeForRole(roleOf(token)) : '/login');
  }, [ready, token, router]);

  return <div className="p-8 text-gray-500">SafeMail…</div>;
}
