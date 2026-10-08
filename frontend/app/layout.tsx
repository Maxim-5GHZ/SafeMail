import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import './globals.css';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';

const sans = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'СейфМейл',
  description: 'Почтовый шлюз с ИИ-фильтром',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={cn('font-sans', sans.variable)}>
      <body className="text-gray-900 bg-gray-100">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}