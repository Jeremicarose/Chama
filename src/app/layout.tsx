// =============================================================================
// layout.tsx — Root layout for the Chama application
// =============================================================================
//
// PURPOSE:
//   The root layout wraps EVERY page in the app. It provides:
//   - HTML/body skeleton with fonts and dark mode support
//   - FlowProvider (initializes FCL configuration)
//   - Navbar (persistent across all pages)
//   - Main content area with consistent padding
//
// WHY A SERVER COMPONENT?
//   This file is a Server Component (no 'use client'). Server Components
//   are rendered on the server and sent as HTML — zero JavaScript shipped
//   for the layout skeleton itself. Only FlowProvider and Navbar (which
//   need hooks) are Client Components, automatically code-split by Next.js.
//
// FONT STRATEGY:
//   Geist Sans (body text) + Geist Mono (addresses, code).
//   next/font/google handles font loading optimally: self-hosted, no layout
//   shift, preloaded. The CSS variables let Tailwind reference them.
// =============================================================================

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import FlowProvider from '@/components/FlowProvider';
import Navbar from '@/components/Navbar';

// ── Font Configuration ──
// variable: creates a CSS custom property (--font-geist-sans) that Tailwind
// uses via font-sans / font-mono utility classes.
// subsets: ["latin"] limits the font to Latin characters (smaller download).
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// ── Metadata ──
// Next.js uses this to generate <title> and <meta> tags.
// Important for SEO and browser tab display.
export const metadata: Metadata = {
  title: 'Chama — Trustless Rotating Savings on Flow',
  description:
    'Create and join transparent savings circles powered by Flow blockchain scheduled transactions. No middleman, no trust required.',
};

// ── Root Layout ──
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* ----------------------------------------------------------------- */}
      {/* Body: applies font CSS variables + antialiased rendering.         */}
      {/* antialiased: uses subpixel rendering for smoother text on macOS.  */}
      {/* min-h-screen: ensures the body fills the viewport height.         */}
      {/* bg-zinc-50/dark:bg-zinc-950: light/dark background colors.        */}
      {/* ----------------------------------------------------------------- */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased min-h-screen bg-zinc-50 dark:bg-zinc-950`}
      >
        {/* FlowProvider initializes FCL config before any child uses it.  */}
        {/* It's a Client Component boundary — children inside can use hooks. */}
        <FlowProvider>
          {/* Navbar persists across all pages (dashboard, create, detail). */}
          <Navbar />

          {/* Main content area with consistent padding and max width. */}
          {/* pb-20: bottom padding for breathing room.                */}
          {/* The {children} slot is filled by page.tsx from each route. */}
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </main>
        </FlowProvider>
      </body>
    </html>
  );
}
