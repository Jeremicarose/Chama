// =============================================================================
// magic-auth.ts — Magic.link email-based authentication for Flow
// =============================================================================
//
// PURPOSE:
//   Provides walletless onboarding via Magic.link. Users sign in with an
//   email address — Magic creates a Flow account behind the scenes,
//   manages keys, and signs transactions. No browser extension needed.
//
// HOW IT WORKS:
//   1. User enters their email in our custom login form
//   2. We call magic.auth.loginWithMagicLink({ email })
//   3. Magic sends a verification email with a one-click link
//   4. User clicks the link → Magic creates/unlocks their Flow account
//   5. We get the account address via magic.flow.getAccount()
//   6. For transactions, magic.flow.authorization replaces fcl.currentUser
//
// WHY MAGIC OVER BLOCTO?
//   Blocto's wallet service is experiencing SSL certificate issues (525/526
//   errors across all endpoints). Magic.link provides the same email-based
//   onboarding but with its own infrastructure. Both create custodial Flow
//   accounts — the user experience is identical.
//
// MULTIPLE TEST ACCOUNTS:
//   Each email address gets a unique Flow account. To test the chama with
//   multiple members, use different emails (e.g., test1@gmail.com,
//   test2@gmail.com, etc.). Each one gets its own testnet account with
//   a unique address.
//
// ENV VAR:
//   NEXT_PUBLIC_MAGIC_API_KEY — Get a free key at https://dashboard.magic.link
// =============================================================================

'use client';

import { Magic } from 'magic-sdk';
import { FlowExtension } from '@magic-ext/flow';

// ─────────────────────────────────────────────────────────────────────────────
// Network Configuration
// ─────────────────────────────────────────────────────────────────────────────

const FLOW_NETWORK = process.env.NEXT_PUBLIC_FLOW_NETWORK || 'emulator';

const RPC_MAP: Record<string, string> = {
  emulator: 'http://localhost:8888',
  testnet: 'https://rest-testnet.onflow.org',
  mainnet: 'https://rest-mainnet.onflow.org',
};

// ─────────────────────────────────────────────────────────────────────────────
// Magic Instance (singleton)
// ─────────────────────────────────────────────────────────────────────────────
//
// Magic SDK must be instantiated in the browser (uses window). We lazy-init
// it on first use and cache the instance. The FlowExtension tells Magic
// which Flow network to connect to.
//
// NOTE: First login for a new email may take ~30 seconds as Magic waits
// for the Flow blockchain to confirm the account creation transaction.
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let magicInstance: any = null;

export function getMagic(): any {
  const apiKey = process.env.NEXT_PUBLIC_MAGIC_API_KEY;
  if (!apiKey) {
    console.warn('Magic.link not configured — set NEXT_PUBLIC_MAGIC_API_KEY');
    return null;
  }

  if (typeof window === 'undefined') return null;

  if (!magicInstance) {
    magicInstance = new Magic(apiKey, {
      extensions: [
        new FlowExtension({
          rpcUrl: RPC_MAP[FLOW_NETWORK] || RPC_MAP.testnet,
          network: (FLOW_NETWORK === 'emulator' ? 'testnet' : FLOW_NETWORK) as any,
        }),
      ],
    });
  }

  return magicInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Login with email via Magic.link.
 * Returns the Flow account address on success, or null on failure.
 *
 * WHAT HAPPENS:
 *   1. Magic sends a "magic link" email to the user
 *   2. User clicks the link in their email
 *   3. Magic authenticates them and creates/unlocks their Flow account
 *   4. We get back the account address (e.g., "0x1234abcd...")
 *
 * FIRST LOGIN:
 *   Takes ~30s because Magic creates a new Flow account on-chain.
 *   Subsequent logins are instant.
 */
export async function magicLogin(email: string): Promise<string | null> {
  const magic = getMagic();
  if (!magic) return null;

  try {
    // Step 1: Authenticate via email magic link
    await magic.auth.loginWithMagicLink({ email });

    // Step 2: Get the Flow account address
    const account = await (magic.extensions as any).flow.getAccount();
    return account ?? null;
  } catch (err) {
    console.error('Magic login failed:', err);
    return null;
  }
}

/**
 * Logout from Magic.link session.
 */
export async function magicLogout(): Promise<void> {
  const magic = getMagic();
  if (!magic) return;

  try {
    await magic.user.logout();
  } catch (err) {
    console.error('Magic logout failed:', err);
  }
}

/**
 * Check if a user is currently logged in via Magic.
 */
export async function isMagicLoggedIn(): Promise<boolean> {
  const magic = getMagic();
  if (!magic) return false;

  try {
    return await magic.user.isLoggedIn();
  } catch {
    return false;
  }
}

/**
 * Get the Magic authorization function for FCL transactions.
 * This replaces fcl.currentUser in mutate() calls.
 *
 * USAGE:
 *   const authz = getMagicAuthorization();
 *   if (authz) {
 *     fcl.mutate({
 *       cadence: TX,
 *       proposer: authz,
 *       payer: authz,        // or server payer for sponsored gas
 *       authorizations: [authz],
 *     });
 *   }
 */
export function getMagicAuthorization(): any {
  const magic = getMagic();
  if (!magic) return null;
  return (magic.extensions as any).flow.authorization;
}
