// =============================================================================
// flow-transaction.ts — Sponsored transaction helper
// =============================================================================
//
// PURPOSE:
//   Provides `sponsoredMutate()`, a drop-in replacement for `fcl.mutate()`
//   that makes the server-side admin account pay gas fees. Users only sign
//   the authorization (the action itself) — they never see a gas fee.
//
// HOW IT WORKS:
//   FCL's mutate() accepts separate functions for `proposer`, `payer`, and
//   `authorizations`. By default all three are `fcl.currentUser` (the user
//   does everything). We override `payer` with a custom authorization
//   function that:
//     1. Gets the admin account info from FCL (address, key index)
//     2. Returns a signing function that POSTs to /api/sign-as-payer
//     3. The server signs with the admin private key and returns the signature
//
//   The user's wallet still handles proposer (sequence number) and
//   authorizations (signing the actual transaction logic). The split is:
//     - User wallet: "I approve this action" (1 popup)
//     - Admin server: "I'll pay the gas" (invisible, no popup)
//
// FALLBACK:
//   If the admin account isn't configured (env vars missing), the server
//   returns 503 and we fall back to `fcl.currentUser` as payer. This means
//   the user pays gas themselves — graceful degradation, not a crash.
//
// USAGE:
//   import { sponsoredMutate } from '@/lib/flow-transaction';
//
//   const txId = await sponsoredMutate({
//     cadence: MY_TRANSACTION,
//     args: (arg, t) => [arg("hello", t.String)],
//     limit: 9999,
//   });
// =============================================================================

import { fcl } from '@/lib/flow-config';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MutateOptions {
  cadence: string;
  args?: (arg: any, t: any) => any[];
  limit?: number;
}

// FCL's "signable" object — the data structure passed to authorization functions
// during transaction building. Contains the message bytes to sign.
interface Signable {
  message: string;
  addr?: string;
  keyId?: number;
  roles?: { payer?: boolean; proposer?: boolean; authorizer?: boolean };
  voucher?: any;
}

// The composite signature FCL expects back from a signing function
interface CompositeSignature {
  addr: string;
  keyId: number;
  signature: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Account Info
// ─────────────────────────────────────────────────────────────────────────────
//
// These are public values (address + key index) needed by FCL to build the
// transaction envelope. The private key stays server-side only.
//
// NEXT_PUBLIC_ prefix because FCL runs in the browser and needs to know
// which account is the payer when constructing the transaction.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_FLOW_ADMIN_ADDRESS || '';
const ADMIN_KEY_INDEX = parseInt(process.env.NEXT_PUBLIC_FLOW_ADMIN_KEY_INDEX || '0', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Server Payer Authorization Function
// ─────────────────────────────────────────────────────────────────────────────
//
// FCL's authorization functions are async functions that receive an "account"
// object and return a modified version with signing capabilities. This is
// FCL's plugin system for custom signers.
//
// The returned object tells FCL:
//   - addr: which Flow account is signing
//   - keyId: which key on that account
//   - signingFunction: async fn that receives the message and returns a signature
//
// For the payer role specifically, FCL calls this during the "envelope"
// signing phase (after the user has already signed the "payload" as authorizer).
// ─────────────────────────────────────────────────────────────────────────────

function serverPayerAuthz(account: any) {
  return {
    ...account,
    addr: ADMIN_ADDRESS,
    keyId: ADMIN_KEY_INDEX,
    tempId: `${ADMIN_ADDRESS}-${ADMIN_KEY_INDEX}`,
    signingFunction: async (signable: Signable): Promise<CompositeSignature> => {
      // POST the message to our server for signing
      const response = await fetch('/api/sign-as-payer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: signable.message }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Payer signing failed (${response.status})`);
      }

      const { addr, keyId, signature } = await response.json();
      return { addr, keyId, signature };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// sponsoredMutate — Drop-in replacement for fcl.mutate()
// ─────────────────────────────────────────────────────────────────────────────
//
// If the admin address is configured, uses server-side payer (user pays $0 gas).
// If not configured, falls back to standard fcl.mutate (user pays gas).
//
// This graceful fallback means:
//   - Development (no env vars): works like normal fcl.mutate
//   - Production (env vars set): admin pays gas, invisible to user
//   - If server is down: throws error (same as any network failure)
// ─────────────────────────────────────────────────────────────────────────────

export async function sponsoredMutate(options: MutateOptions): Promise<string> {
  const { cadence, args, limit = 9999 } = options;

  // If admin address is configured, sponsor gas via server
  if (ADMIN_ADDRESS) {
    return fcl.mutate({
      cadence,
      args,
      proposer: fcl.currentUser,
      payer: serverPayerAuthz,
      authorizations: [fcl.currentUser],
      limit,
    });
  }

  // Fallback: user pays gas (standard behavior)
  return fcl.mutate({
    cadence,
    args,
    proposer: fcl.currentUser,
    payer: fcl.currentUser,
    authorizations: [fcl.currentUser],
    limit,
  });
}
