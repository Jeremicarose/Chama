// =============================================================================
// receipt-client.ts — Client-side receipt recording (browser → API → IPFS)
// =============================================================================
//
// PURPOSE:
//   Provides a single function `recordReceiptClient()` that sends receipt data
//   to /api/receipts. The server uploads the receipt JSON to IPFS via Storacha
//   and returns the CID. No wallet interaction needed — this is fire-and-forget.
//
// WHY NO ON-CHAIN CID STORAGE?
//   Previously this module called `fcl.mutate(StoreReceiptCID)` after uploading,
//   which triggered an EXTRA wallet popup for every action. That's terrible UX —
//   users saw 2 wallet approvals per action (main tx + receipt tx). The IPFS
//   upload alone provides a tamper-proof audit trail. On-chain anchoring can be
//   added later as a background batch job if needed.
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
//   }).catch(console.warn);
//
// ERROR HANDLING:
//   Receipt recording is non-blocking. If it fails (Storacha down, etc.),
//   the main transaction already succeeded. We log the error but don't
//   surface it to the user.
// =============================================================================

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
 * Records a receipt by uploading to IPFS via the server-side API route.
 * No wallet interaction — completely silent, fire-and-forget.
 *
 * @param receipt - The receipt data to store
 * @returns The CID of the uploaded receipt, or null if it failed
 */
export async function recordReceiptClient(
  receipt: ReceiptInput,
): Promise<string | null> {
  try {
    const response = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...receipt,
        previousReceiptCID: receipt.previousReceiptCID || null,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn('Receipt upload failed:', errorData.error || response.statusText);
      return null;
    }

    const { cid } = await response.json();
    return cid || null;
  } catch (err) {
    console.warn('Receipt recording failed (non-critical):', err);
    return null;
  }
}
