// =============================================================================
// receipt-client.ts — Client-side receipt recording (browser → API → IPFS → chain)
// =============================================================================
//
// PURPOSE:
//   Provides a single function `recordReceiptClient()` that:
//   1. Sends receipt data to /api/receipts (server uploads to IPFS)
//   2. Gets back the CID
//   3. Stores the CID on-chain via StoreReceiptCID transaction (user's wallet)
//
// WHY A SEPARATE CLIENT MODULE?
//   The existing receipt-flow-bridge.ts tries to do both server-side (Storacha)
//   and client-side (fcl.mutate) work in one function. That breaks in Next.js
//   because Storacha env vars aren't available in the browser. This module
//   cleanly splits the concerns:
//     - Server: /api/receipts handles Storacha upload
//     - Client: This module handles on-chain CID storage
//
// USAGE:
//   import { recordReceiptClient } from '@/lib/receipt-client';
//
//   // Fire-and-forget after a successful transaction:
//   recordReceiptClient({
//     circleId: '1',
//     action: 'contribution',
//     actor: '0xf8d6e0586b0a20c7',
//     timestamp: new Date().toISOString(),
//     details: { amount: '10.0', cycle: 1 },
//     transactionId: 'abc123...',
//   }, hostAddress, circleId, previousCID).catch(console.warn);
//
// ERROR HANDLING:
//   Receipt recording is non-blocking. If it fails (Storacha down, wallet
//   rejection, etc.), the main transaction already succeeded. We log the
//   error but don't surface it to the user — the on-chain action is what
//   matters, receipts are a nice-to-have audit trail.
// =============================================================================

import { fcl } from '@/lib/flow-config';

// =============================================================================
// StoreReceiptCID Transaction — anchors the IPFS CID on-chain
// =============================================================================
//
// This is the same Cadence code from receipt-flow-bridge.ts, duplicated here
// because this module needs to be fully client-side importable (no server deps).

const STORE_RECEIPT_CID_TX = `
import ChamaCircle from 0xChamaCircle

transaction(hostAddress: Address, circleId: UInt64, cid: String) {
    prepare(signer: auth(Storage) &Account) {
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")

        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle from host")

        circleRef.storeReceiptCID(cid: cid)
    }
}
`;

// =============================================================================
// Types
// =============================================================================

interface ReceiptInput {
  circleId: string;
  action: string;
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
  previousReceiptCID?: string | null;
  transactionId?: string;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Records a receipt: uploads to IPFS (via API route) then stores CID on-chain.
 *
 * This is designed to be called fire-and-forget after a successful transaction.
 * It won't throw — errors are caught and logged. The main transaction has already
 * succeeded by the time this runs, so receipt failure is non-critical.
 *
 * @param receipt - The receipt data to store
 * @param hostAddress - Flow address hosting the circle
 * @param circleId - Circle ID (string, will be passed as UInt64)
 * @param previousCID - Optional CID of the previous receipt in the chain
 * @returns The CID of the uploaded receipt, or null if it failed
 */
export async function recordReceiptClient(
  receipt: ReceiptInput,
  hostAddress: string,
  circleId: string,
  previousCID?: string | null,
): Promise<string | null> {
  try {
    // Step 1: Upload to IPFS via server-side API route
    const response = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...receipt,
        previousReceiptCID: previousCID || null,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn('Receipt upload failed:', errorData.error || response.statusText);
      return null;
    }

    const { cid } = await response.json();
    if (!cid) return null;

    // Step 2: Store CID on-chain (requires user's wallet signature)
    const txId = await fcl.mutate({
      cadence: STORE_RECEIPT_CID_TX,
      args: (arg: any, t: any) => [
        arg(hostAddress, t.Address),
        arg(circleId, t.UInt64),
        arg(cid, t.String),
      ],
      proposer: fcl.currentUser,
      payer: fcl.currentUser,
      authorizations: [fcl.currentUser],
      limit: 1000,
    });

    await fcl.tx(txId).onceSealed();

    return cid;
  } catch (err) {
    // Non-blocking — receipt failure doesn't affect the main transaction
    console.warn('Receipt recording failed (non-critical):', err);
    return null;
  }
}
