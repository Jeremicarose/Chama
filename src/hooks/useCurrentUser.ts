// =============================================================================
// useCurrentUser.ts — React hook for Flow wallet authentication state
// =============================================================================
//
// PURPOSE:
//   Wraps FCL's currentUser observable into a React hook. Any component that
//   needs to know "is the user logged in?" or "what's their address?" imports
//   this hook instead of dealing with FCL subscriptions directly.
//
// WHY A CUSTOM HOOK (not useContext)?
//   FCL already manages global auth state internally via its currentUser
//   observable. Wrapping it in React Context would add a redundant layer.
//   This hook subscribes directly to FCL's observable — simpler, fewer
//   re-renders, and no provider nesting needed.
//
// ALTERNATIVE CONSIDERED:
//   @onflow/fcl-react provides a <CurrentUserProvider> + useCurrentUser().
//   We roll our own because: (a) it's 15 lines of code, (b) we control the
//   TypeScript types, (c) we avoid an extra dependency. If the app grows,
//   switching to @onflow/fcl-react is trivial.
//
// HOW FCL AUTH WORKS:
//   1. User clicks "Connect Wallet" → we call fcl.authenticate()
//   2. FCL opens the Discovery UI (iframe/popup) showing available wallets
//   3. User selects a wallet (Lilico, Blocto, dev-wallet on emulator)
//   4. Wallet signs a proof-of-ownership message
//   5. FCL updates currentUser with { addr, loggedIn: true, cid }
//   6. Our subscription fires → React state updates → UI re-renders
//
// USAGE:
//   const { user, logIn, logOut } = useCurrentUser();
//   if (user.loggedIn) { ... user.addr ... }
// =============================================================================

'use client';
// ^^^^^^^^^^^
// Next.js App Router splits code into Server Components (default) and Client
// Components. Hooks (useState, useEffect) only work in Client Components.
// 'use client' tells Next.js to bundle this for the browser, not the server.

import { useState, useEffect } from 'react';
import { fcl } from '@/lib/flow-config';

// =============================================================================
// Types
// =============================================================================

/**
 * Shape of the user object from FCL's currentUser.subscribe().
 *
 * FIELDS:
 * - addr: The user's Flow address (e.g., "0x4648c731f1777d9d") or null
 * - loggedIn: Whether the user has authenticated with a wallet
 * - cid: Composite ID from the wallet service (internal FCL use)
 *
 * WHY NOT USE FCL's built-in types?
 *   @onflow/fcl's TypeScript types are incomplete/outdated. Defining our
 *   own interface gives us control and better IDE autocomplete.
 */
export interface FlowUser {
  addr?: string | null;
  loggedIn?: boolean;
  cid?: string | null;
}

// Default state before FCL reports anything. Using a constant avoids
// creating a new object on every render (referential stability).
const DEFAULT_USER: FlowUser = { addr: null, loggedIn: false, cid: null };

// =============================================================================
// Hook
// =============================================================================

export function useCurrentUser() {
  // -------------------------------------------------------------------------
  // State: holds the latest user snapshot from FCL
  // -------------------------------------------------------------------------
  const [user, setUser] = useState<FlowUser>(DEFAULT_USER);

  // -------------------------------------------------------------------------
  // Subscription: listen to FCL's currentUser observable
  // -------------------------------------------------------------------------
  //
  // useEffect runs after the first render (and never again, since deps=[]).
  // fcl.currentUser.subscribe() does two things:
  //   1. Immediately calls our callback with the current auth state
  //   2. Calls it again whenever the user logs in or out
  //
  // The returned function is the unsubscribe cleanup — React calls it
  // when the component unmounts, preventing memory leaks.
  //
  // WHY NOT useCallback for setUser?
  //   setUser from useState is already stable (React guarantees it).
  //   Wrapping it in useCallback would be redundant.
  useEffect(() => {
    const unsubscribe = fcl.currentUser.subscribe((snapshot: FlowUser) => {
      setUser(snapshot ?? DEFAULT_USER);
    });
    return () => unsubscribe();
  }, []);

  // -------------------------------------------------------------------------
  // Actions: thin wrappers around FCL's auth methods
  // -------------------------------------------------------------------------
  //
  // fcl.authenticate() opens the wallet discovery UI.
  // fcl.unauthenticate() clears the session (no wallet interaction needed).
  //
  // WHY ARROW FUNCTIONS (not binding)?
  //   Arrow functions are simpler and don't need `this` binding.
  //   They're re-created on each render, but since they're just calling
  //   FCL functions (no closures over changing state), this is fine.
  const logIn = () => fcl.authenticate();
  const logOut = () => fcl.unauthenticate();

  return { user, logIn, logOut };
}
