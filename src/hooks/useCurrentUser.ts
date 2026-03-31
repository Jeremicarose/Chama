// =============================================================================
// useCurrentUser.ts — React hook for authentication (Magic.link + FCL)
// =============================================================================
//
// DUAL AUTH STRATEGY:
//   1. Magic.link configured (NEXT_PUBLIC_MAGIC_API_KEY) → email login
//   2. Magic not configured → FCL Discovery (wallet picker)
//
// STATE MANAGEMENT:
//   We use a ref (authMethodRef) alongside state to prevent the FCL
//   subscription from overwriting Magic's auth state. The FCL subscription
//   fires asynchronously and can race with Magic's login flow. The ref
//   gives us synchronous access to the current auth method inside the
//   subscription callback, while the state triggers re-renders.
// =============================================================================

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

type AuthMethod = 'magic' | 'fcl' | null;

// =============================================================================
// Hook
// =============================================================================

export function useCurrentUser() {
  const [user, setUser] = useState<FlowUser>(DEFAULT_USER);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(null);

  // Ref tracks auth method synchronously — prevents FCL subscription from
  // overwriting Magic state during the async gap between state updates.
  const authMethodRef = useRef<AuthMethod>(null);

  const magicAvailable = typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_MAGIC_API_KEY;

  // Helper to update both state and ref together
  const setAuth = useCallback((method: AuthMethod) => {
    authMethodRef.current = method;
    setAuthMethod(method);
  }, []);

  // ── FCL subscription ──
  // Only update user state from FCL when NOT using Magic.
  // Uses the ref (not state) to avoid stale closure issues.
  useEffect(() => {
    const unsubscribe = fcl.currentUser.subscribe((snapshot: FlowUser) => {
      if (authMethodRef.current !== 'magic') {
        setUser(snapshot ?? DEFAULT_USER);
        if (snapshot?.loggedIn && authMethodRef.current !== 'fcl') {
          setAuth('fcl');
        }
      }
    });
    return () => unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore existing Magic session on mount ──
  useEffect(() => {
    if (!magicAvailable) return;

    let cancelled = false;

    (async () => {
      try {
        const loggedIn = await isMagicLoggedIn();
        if (cancelled) return;

        if (loggedIn) {
          const magic = getMagic();
          if (magic) {
            const account = await magic.flow.getAccount();
            if (!cancelled && account) {
              setUser({ addr: account, loggedIn: true });
              setAuth('magic');
            }
          }
        }
      } catch {
        // No existing session — that's fine
      }
    })();

    return () => { cancelled = true; };
  }, [magicAvailable, setAuth]);

  // ── Login ──
  const logIn = useCallback(async (email?: string) => {
    if (magicAvailable && email) {
      const addr = await magicLogin(email);
      if (addr) {
        setUser({ addr, loggedIn: true });
        setAuth('magic');
      }
      return;
    }

    if (magicAvailable && !email) {
      // Signal that the UI should show the email input
      return 'needs-email' as const;
    }

    // Fallback: FCL Discovery
    await fcl.authenticate();
    // FCL subscription will handle setting user state
  }, [magicAvailable, setAuth]);

  // ── Logout ──
  const logOut = useCallback(async () => {
    if (authMethodRef.current === 'magic') {
      await magicLogout();
    }
    fcl.unauthenticate();
    setUser(DEFAULT_USER);
    setAuth(null);
  }, [setAuth]);

  // ── Authorization function for transactions ──
  const getAuthorization = useCallback(() => {
    if (authMethodRef.current === 'magic') {
      return getMagicAuthorization();
    }
    return fcl.currentUser;
  }, []);

  return { user, logIn, logOut, authMethod, getAuthorization, magicAvailable };
}
