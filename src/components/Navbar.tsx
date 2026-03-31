// =============================================================================
// Navbar.tsx — Top navigation bar with email-based sign-in
// =============================================================================
//
// AUTHENTICATION FLOW:
//   When Magic.link is configured (NEXT_PUBLIC_MAGIC_API_KEY):
//     1. User clicks "Get Started" → email input slides open
//     2. User enters email → Magic sends a verification link
//     3. User clicks link in email → signed in, address shown
//
//   When Magic is NOT configured (fallback):
//     1. User clicks "Get Started" → FCL Discovery opens
//     2. User picks a wallet (Blocto, Flow Wallet, etc.)
//     3. Wallet authenticates → signed in
// =============================================================================

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const NAV_LINKS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Create', href: '/create' },
  { label: 'Join', href: '/join' },
  { label: 'History', href: '/history' },
  { label: 'Badges', href: '/achievements' },
];

export default function Navbar() {
  const { user, logIn, logOut, magicAvailable } = useCurrentUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [email, setEmail] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [copied, setCopied] = useState(false);
  const pathname = usePathname();

  function copyAddress() {
    if (!user.addr) return;
    navigator.clipboard.writeText(user.addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleGetStarted() {
    if (magicAvailable) {
      // Show email input form
      setShowEmailInput(true);
    } else {
      // Fallback: FCL Discovery
      await logIn();
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSigningIn(true);
    try {
      await logIn(email.trim());
      setShowEmailInput(false);
      setEmail('');
    } catch (err) {
      console.error('Sign in failed:', err);
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <nav className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">

          {/* ── Logo ── */}
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-xs font-bold text-white shadow-lg shadow-emerald-500/20">
              C
            </div>
            <Link href="/" className="text-lg font-bold tracking-tight text-zinc-50">
              Chama
            </Link>
          </div>

          {/* ── Nav Links (desktop) ── */}
          <div className="hidden md:flex md:items-center md:gap-0.5">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-800/80 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* ── Auth Section ── */}
          <div className="flex items-center gap-2">
            {user.loggedIn ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={copyAddress}
                  title={user.addr || 'Copy address'}
                  className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 ring-1 ring-zinc-800 transition-colors hover:ring-emerald-500/50 cursor-pointer"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                  <span className="hidden sm:inline font-mono text-xs text-zinc-400">
                    {copied ? 'Copied!' : user.addr || 'Signed in'}
                  </span>
                </button>
                <button
                  onClick={logOut}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Sign Out
                </button>
              </div>
            ) : showEmailInput ? (
              /* ── Email sign-in form ── */
              <form onSubmit={handleEmailSubmit} className="flex items-center gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoFocus
                  disabled={signingIn}
                  className="w-48 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none focus:ring-emerald-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={signingIn || !email.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 disabled:opacity-50"
                >
                  {signingIn ? 'Signing in...' : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowEmailInput(false); setEmail(''); }}
                  className="rounded-lg px-2 py-2 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
              </form>
            ) : (
              /* ── Get Started button ── */
              <button
                onClick={handleGetStarted}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30"
              >
                Get Started
              </button>
            )}

            {/* ── Mobile hamburger ── */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="ml-1 inline-flex items-center justify-center rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 md:hidden"
              aria-label="Toggle navigation menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile dropdown ── */}
      {mobileMenuOpen && (
        <div className="border-t border-zinc-800/60 md:hidden">
          <div className="space-y-0.5 px-3 py-2">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-800/80 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
