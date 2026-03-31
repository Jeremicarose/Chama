// =============================================================================
// useCurrentUser.ts — React hook for authentication (Magic.link + FCL)
// =============================================================================
//
// PURPOSE:
//   Provides a unified auth interface. When Magic.link is configured
//   (NEXT_PUBLIC_MAGIC_API_KEY is set), users sign in via email — no wallet
//   extension needed. When Magic isn't configured, falls back to FCL
//   Discovery (wallet picker: Blocto, Flow Wallet, etc.).
//
// WHY DUAL AUTH?
//   Magic.link provides the best "consumer DeFi" experience (email login,
//   no crypto knowledge required). But for hackathon judges who want to
//   test with their own wallets, FCL Discovery is the fallback.
//
// USAGE:
//   const { user, logIn, logOut, authMethod } = useCurrentUser();
//   if (user.loggedIn) { ... user.addr ... }
//   // authMethod is 'magic' | 'fcl' | null
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { fcl } from '@/lib/flow-config';
import {
  getMagic,
  magicLogin,
  magicLogout,
  isMagicLoggedIn,
  getMagicAuthorization,
} from '@/lib/magic-auth';

// =============================================================================
// Types
// =============================================================================

export interface FlowUser {
  addr?: string | null;
  loggedIn?: boolean;
  cid?: string | null;
}

const DEFAULT_USER: FlowUser = { addr: null, loggedIn: false, cid: null };

// Auth method tracks how the user signed in
type AuthMethod = 'magic' | 'fcl' | null;

// =============================================================================
// Hook
// =============================================================================

export function useCurrentUser() {
  const [user, setUser] = useState<FlowUser>(DEFAULT_USER);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(null);

  // Check if Magic.link is configured (has API key)
  const magicAvailable = typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_MAGIC_API_KEY;

  // ── FCL subscription (always active for FCL-based logins) ──
  useEffect(() => {
    const unsubscribe = fcl.currentUser.subscribe((snapshot: FlowUser) => {
      // Only update from FCL if we're not using Magic
      if (authMethod !== 'magic') {
        setUser(snapshot ?? DEFAULT_USER);
        if (snapshot?.loggedIn && !authMethod) {
          setAuthMethod('fcl');
        }
      }
    });
    return () => unsubscribe();
  }, [authMethod]);

  // ── Check for existing Magic session on mount ──
  useEffect(() => {
    if (!magicAvailable) return;

    (async () => {
      try {
        const loggedIn = await isMagicLoggedIn();
        if (loggedIn) {
          const magic = getMagic();
          if (magic) {
            const account = await (magic.extensions as any).flow.getAccount();
            if (account) {
              setUser({ addr: account, loggedIn: true });
              setAuthMethod('magic');
            }
          }
        }
      } catch {
        // Silent — no existing session
      }
    })();
  }, [magicAvailable]);

  // ── Login ──
  // If Magic is available, shows email prompt. Otherwise opens FCL Discovery.
  const logIn = useCallback(async (email?: string) => {
    if (magicAvailable && email) {
      // Magic.link email login
      const addr = await magicLogin(email);
      if (addr) {
        setUser({ addr, loggedIn: true });
        setAuthMethod('magic');
      }
    } else if (magicAvailable && !email) {
      // Magic is available but no email provided — caller should show email form
      // This signals the UI to show the email input
      return 'needs-email' as const;
    } else {
      // Fallback: FCL Discovery (wallet picker)
      await fcl.authenticate();
      setAuthMethod('fcl');
    }
  }, [magicAvailable]);

  // ── Logout ──
  const logOut = useCallback(async () => {
    if (authMethod === 'magic') {
      await magicLogout();
    }
    fcl.unauthenticate();
    setUser(DEFAULT_USER);
    setAuthMethod(null);
  }, [authMethod]);

  // ── Get authorization function for transactions ──
  // Returns the correct authorization function based on auth method
  const getAuthorization = useCallback(() => {
    if (authMethod === 'magic') {
      return getMagicAuthorization();
    }
    return fcl.currentUser;
  }, [authMethod]);

  return { user, logIn, logOut, authMethod, getAuthorization, magicAvailable };
}
