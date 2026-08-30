import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

/**
 * One family, self-hosted by next/font so there is no render-blocking request
 * to Google and no layout shift. Inter's tabular figures are the reason it is
 * here: this app is full of prices, times, and seat counts that have to line
 * up in a column and not jitter as they update.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Corridor — intercity rides across Ontario',
    template: '%s · Corridor',
  },
  description:
    'Search every operator running between Ontario cities, compare departure times and fares, and request a seat.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e3a5f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
