import type { Metadata, Viewport } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import NavProgress from '@/components/NavProgress';
import { cookieLang } from '@/lib/i18n-server';

// the two site fonts, served from our own origin with the page: no third-party request before the first paint
const inter = Inter({ subsets: ['latin', 'latin-ext', 'cyrillic'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-inter' });
const interTight = Inter_Tight({ subsets: ['latin', 'latin-ext', 'cyrillic'], weight: ['500', '600', '700'], display: 'swap', variable: '--font-inter-tight' });

export const metadata: Metadata = {
  title: { default: 'Nazryx Intelligence', template: '%s · Nazryx' },
  description: 'See competitors, market gaps and request sourcing.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#F7F6F2' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await cookieLang();
  return (
    <html lang={lang} className={`${inter.variable} ${interTight.variable}`}>
      <body><Suspense fallback={null}><NavProgress /></Suspense>{children}</body>
    </html>
  );
}
