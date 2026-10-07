'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, homeForRole, roleOf } from '@/lib/auth';
import { LogoMark } from '@/components/Logo';

export default function Home() {
  const { ready, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(token ? homeForRole(roleOf(token)) : '/login');
  }, [ready, token, router]);

  return (
    <div className="p-8 text-gray-500 flex items-center gap-2">
      <LogoMark className="w-8 h-8" />
      СейфМейл…
    </div>
  );
}
