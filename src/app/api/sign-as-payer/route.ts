// =============================================================================
// /api/sign-as-payer — Server-side gas fee sponsorship
// =============================================================================
//
// PURPOSE:
//   Signs Flow transactions as the "payer" role using an admin account.
//   This means users never pay gas fees — the admin account covers them.
//
// HOW FLOW TRANSACTION ROLES WORK:
//   Flow separates transaction signing into 3 roles:
//   - proposer: provides sequence number (prevents replay attacks)
//   - payer: pays the gas fee (computation cost)
//   - authorizations: signs the transaction logic (who's actually doing the action)
//
//   These can be DIFFERENT accounts. So the user's wallet handles proposer +
//   authorizations (they approve the action), while our admin account silently
//   pays the gas as payer. The user never sees a gas fee.
//
// SECURITY:
//   The admin private key stays server-side (never sent to browser).
//   This endpoint only signs as payer — it cannot authorize actions on
//   behalf of the user. The worst an attacker could do is drain the admin
//   account's FLOW tokens (gas budget), not steal user funds.
//
// FLOW SIGNING ALGORITHM:
//   Flow uses ECDSA_P256 with SHA3-256 hashing. The signing process:
//   1. Receive the transaction message (hex-encoded bytes)
//   2. Hash it with SHA3-256
//   3. Sign the hash with ECDSA_P256 using the admin private key
//   4. Return the DER-encoded signature as hex
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ec as EC } from 'elliptic';
import { SHA3 } from 'sha3';

// ─────────────────────────────────────────────────────────────────────────────
// Environment Variables
// ─────────────────────────────────────────────────────────────────────────────
//
// FLOW_ADMIN_ADDRESS: The Flow testnet address that pays gas (e.g. "0x1234abcd...")
// FLOW_ADMIN_PRIVATE_KEY: Hex-encoded private key for that account (no 0x prefix)
// FLOW_ADMIN_KEY_INDEX: Which key on the account to use (default "0")
//
// Fund the admin account via Flow Testnet Faucet:
//   https://testnet-faucet.onflow.org/
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ADDRESS = process.env.FLOW_ADMIN_ADDRESS || '';
const ADMIN_PRIVATE_KEY = process.env.FLOW_ADMIN_PRIVATE_KEY || '';
const ADMIN_KEY_INDEX = parseInt(process.env.FLOW_ADMIN_KEY_INDEX || '0', 10);

// Initialize the ECDSA curve once (reused across requests)
const p256 = new EC('p256');

/**
 * Signs a hex-encoded message using Flow's signing algorithm:
 * SHA3-256 hash → ECDSA_P256 signature → DER-encoded hex
 *
 * WHY SHA3-256 (not SHA-256)?
 *   Flow chose SHA3-256 as its hash algorithm for transaction signing.
 *   This is different from Ethereum's keccak256 (which is technically NOT
 *   standard SHA3, despite being called sha3 in Solidity). Flow uses the
 *   actual NIST SHA3-256 standard.
 *
 * WHY DER ENCODING?
 *   ECDSA produces two values (r, s). DER encoding packs them into a
 *   standard byte format that Flow's Access API can verify. We pad each
 *   to 32 bytes and concatenate them (r || s) as Flow expects.
 */
function signWithKey(messageHex: string): string {
  // Step 1: SHA3-256 hash of the raw message bytes
  const sha3Hash = new SHA3(256);
  sha3Hash.update(Buffer.from(messageHex, 'hex'));
  const digest = sha3Hash.digest();

  // Step 2: Load the admin private key and sign the hash
  const key = p256.keyFromPrivate(Buffer.from(ADMIN_PRIVATE_KEY, 'hex'));
  const sig = key.sign(digest);

  // Step 3: Pack r and s into 32-byte padded hex strings (Flow's format)
  // Flow expects exactly 64 hex chars for r + 64 hex chars for s = 128 total
  const r = sig.r.toString('hex').padStart(64, '0');
  const s = sig.s.toString('hex').padStart(64, '0');

  return r + s;
}

// =============================================================================
// POST Handler
// =============================================================================
//
// FCL calls this endpoint during transaction building. It sends the
// "signable" object which contains the message to sign and metadata
// about the transaction. We sign and return the composite signature.
//
// REQUEST BODY (from FCL's authorization function):
//   { message: "hex-encoded transaction envelope bytes" }
//
// RESPONSE:
//   {
//     addr: "0x...",          // admin account address
//     keyId: 0,               // which key on the account
//     signature: "hex..."     // the ECDSA_P256 + SHA3-256 signature
//   }
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // Validate that admin credentials are configured
    if (!ADMIN_ADDRESS || !ADMIN_PRIVATE_KEY) {
      return NextResponse.json(
        { error: 'Gas sponsorship not configured. Set FLOW_ADMIN_ADDRESS and FLOW_ADMIN_PRIVATE_KEY.' },
        { status: 503 },
      );
    }

    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "message" field.' },
        { status: 400 },
      );
    }

    // Sign the transaction message as the payer
    const signature = signWithKey(message);

    // Return the composite signature that FCL expects
    return NextResponse.json({
      addr: ADMIN_ADDRESS,
      keyId: ADMIN_KEY_INDEX,
      signature,
    });
  } catch (err: unknown) {
    console.error('sign-as-payer error:', err);
    const message = err instanceof Error ? err.message : 'Signing failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
