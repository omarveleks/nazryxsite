import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import NavProgress from '@/components/NavProgress';
import { cookieLang } from '@/lib/i18n-server';

export const metadata: Metadata = {
  title: { default: 'Nazryx Intelligence', template: '%s · Nazryx' },
  description: 'See competitors, market gaps and request sourcing.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#F7F6F2' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await cookieLang();
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body><Suspense fallback={null}><NavProgress /></Suspense>{children}</body>
    </html>
  );
}
