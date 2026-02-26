// =============================================================================
// Navbar.tsx — Top navigation bar with wallet connection
// =============================================================================
//
// PURPOSE:
//   Persistent top bar that appears on every page. Contains:
//   - App logo/title (links to dashboard)
//   - Navigation links (Dashboard, Create Circle, History)
//   - Wallet connect/disconnect button with address display
//
// WHY A CLIENT COMPONENT?
//   The navbar reads wallet auth state (useCurrentUser hook), which requires
//   browser-side JavaScript. Server Components can't use hooks.
//
// DESIGN DECISIONS:
//   - Truncated address display: "0x4648...7d9d" — full addresses are too long
//   - Green dot for connected state — universal "online" indicator
//   - Mobile-responsive: hamburger menu collapses on small screens
//
// ALTERNATIVE CONSIDERED:
//   Shadcn/UI NavigationMenu — great for complex menus, overkill here.
//   We use plain Tailwind for zero extra dependencies and full control.
// =============================================================================

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// =============================================================================
// Helper: Truncate Flow address for display
// =============================================================================
//
// Flow addresses are 18 chars (0x + 16 hex). Showing "0x4648...7d9d" is
// the standard pattern across blockchain UIs. Users recognize their address
// by the first and last 4 characters.
function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// =============================================================================
// Navigation Links Configuration
// =============================================================================
//
// Centralized array makes it easy to add/remove/reorder nav items.
// Each entry has a label (display text) and href (route path).
const NAV_LINKS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Create Circle', href: '/create' },
  { label: 'History', href: '/history' },
];

// =============================================================================
// Component
// =============================================================================

export default function Navbar() {
  // -------------------------------------------------------------------------
  // Auth state from FCL
  // -------------------------------------------------------------------------
  const { user, logIn, logOut } = useCurrentUser();

  // -------------------------------------------------------------------------
  // Mobile menu toggle
  // -------------------------------------------------------------------------
  // On screens < md (768px), the nav links collapse behind a hamburger icon.
  // This boolean controls whether the mobile dropdown is visible.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* ----------------------------------------------------------------- */}
      {/* Desktop layout: logo | nav links | wallet button                  */}
      {/* Uses max-w-7xl to constrain width on ultrawide monitors.          */}
      {/* px-4 sm:px-6 lg:px-8 provides responsive horizontal padding.     */}
      {/* ----------------------------------------------------------------- */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">

          {/* ── Left: Logo + App Name ── */}
          <div className="flex items-center gap-3">
            {/* Circle icon — represents the rotating savings concept */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold">
              C
            </div>
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Chama
            </Link>
          </div>

          {/* ── Center: Navigation Links (hidden on mobile) ── */}
          {/* md:flex means these only appear on screens >= 768px. */}
          {/* On mobile, they move into the dropdown menu below. */}
          <div className="hidden md:flex md:items-center md:gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* ── Right: Wallet Button ── */}
          <div className="flex items-center gap-3">
            {user.loggedIn ? (
              // ---------------------------------------------------------
              // CONNECTED STATE
              // Shows: green dot + truncated address + disconnect button
              //
              // WHY TWO ELEMENTS (not one button)?
              //   The address display is informational (not clickable).
              //   The disconnect action is separate — avoids accidental
              //   disconnects when users just want to copy their address.
              // ---------------------------------------------------------
              <div className="flex items-center gap-2">
                {/* Green dot = connected indicator */}
                <div className="h-2 w-2 rounded-full bg-emerald-500" />

                {/* Truncated address */}
                <span className="hidden sm:inline text-sm font-mono text-zinc-600 dark:text-zinc-400">
                  {user.addr ? truncateAddress(user.addr) : ''}
                </span>

                {/* Disconnect button */}
                <button
                  onClick={logOut}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              // ---------------------------------------------------------
              // DISCONNECTED STATE
              // Shows: "Connect Wallet" button with brand color
              //
              // WHY EMERALD (not blue)?
              //   Emerald/green signals "money" and "go" — appropriate for
              //   a financial app. Blue is overused. The green ties into
              //   the Chama brand identity throughout the UI.
              // ---------------------------------------------------------
              <button
                onClick={logIn}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              >
                Connect Wallet
              </button>
            )}

            {/* ── Mobile hamburger button (visible < md) ── */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="ml-2 inline-flex items-center justify-center rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Toggle navigation menu"
            >
              {/* Hamburger icon (3 horizontal lines) */}
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  // X icon when menu is open
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  // Hamburger icon when menu is closed
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile dropdown menu ── */}
      {/* Renders below the navbar when hamburger is toggled on small screens. */}
      {/* Uses conditional rendering (not CSS display) so links aren't in the */}
      {/* DOM when hidden — better for accessibility screen readers.          */}
      {mobileMenuOpen && (
        <div className="border-t border-zinc-200 md:hidden dark:border-zinc-800">
          <div className="space-y-1 px-4 py-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-base font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
