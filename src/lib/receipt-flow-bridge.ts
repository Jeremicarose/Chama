// =============================================================================
// receipt-flow-bridge.ts — Bridge between Flow events and Storacha receipts
// =============================================================================
//
// PURPOSE:
//   After each on-chain action (contribution, payout, penalty), this module:
//   1. Uploads a receipt to IPFS via Storacha (using receipt-service.ts)
//   2. Stores the returned CID on-chain via the StoreReceiptCID transaction
//   3. Returns the CID for UI display / local caching
//
// This is the glue layer between the blockchain and the receipt storage.
//
// USAGE:
//   import { recordReceipt } from '@/lib/receipt-flow-bridge';
//
//   const cid = await recordReceipt({
//     circleId: '1',
//     action: 'contribution',
//     actor: '0xf8d6e0586b0a20c7',
//     timestamp: new Date().toISOString(),
//     details: { amount: '10.0', cycle: 1 },
//     transactionId: 'abc123...',
//   }, hostAddress, circleId, previousCID);
// =============================================================================

import { fcl } from './flow-config';
import { uploadReceipt, getReceiptUrl, type ReceiptData } from './receipt-service';

// =============================================================================
// StoreReceiptCID Transaction (Cadence code as template)
// =============================================================================
//
// FCL uses Cadence code as template strings. The 0xChamaCircle placeholder
// is replaced at runtime by FCL's config (set in flow-config.ts).
// =============================================================================

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
// GetLatestReceiptCID Script
// =============================================================================

const GET_LATEST_RECEIPT_CID_SCRIPT = `
import ChamaCircle from 0xChamaCircle

access(all) fun main(hostAddress: Address, circleId: UInt64): String? {
    let host = getAccount(hostAddress)
    let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
        ?? panic("Could not construct public path")

    let circleRef = host.capabilities
        .borrow<&ChamaCircle.Circle>(publicPath)
        ?? panic("Could not borrow Circle")

    let state = circleRef.getState()
    return state.latestReceiptCID
}
`;

// =============================================================================
// Record Receipt (Upload + Store CID)
// =============================================================================

/**
 * Uploads a receipt to IPFS and stores the CID on-chain.
 *
 * FLOW:
 * 1. Fetch the previous CID from on-chain (or use provided one)
 * 2. Upload receipt JSON to Storacha with chain linkage
 * 3. Send StoreReceiptCID transaction to anchor CID on-chain
 * 4. Return the CID for UI display
 *
 * @param receiptData - The receipt details to store
 * @param hostAddress - Flow address of the circle host
 * @param circleId - Circle ID (numeric, will be converted to UInt64)
 * @param previousCID - Optional previous CID (fetched from chain if not provided)
 * @returns The CID of the uploaded receipt
 */
export async function recordReceipt(
  receiptData: ReceiptData,
  hostAddress: string,
  circleId: number,
  previousCID?: string | null,
): Promise<{ cid: string; url: string; transactionId: string }> {
  // Step 1: Get previous CID if not provided
  let prevCID = previousCID;
  if (prevCID === undefined) {
    prevCID = await getLatestReceiptCID(hostAddress, circleId);
  }

  // Step 2: Upload to Storacha
  const cid = await uploadReceipt(receiptData, prevCID);

  // Step 3: Store CID on-chain
  const transactionId = await fcl.mutate({
    cadence: STORE_RECEIPT_CID_TX,
    args: (arg: any, t: any) => [
      arg(hostAddress, t.Address),
      arg(String(circleId), t.UInt64),
      arg(cid, t.String),
    ],
    proposer: fcl.currentUser,
    payer: fcl.currentUser,
    authorizations: [fcl.currentUser],
    limit: 1000,
  });

  // Wait for transaction to be sealed
  await fcl.tx(transactionId).onceSealed();

  return {
    cid,
    url: getReceiptUrl(cid),
    transactionId,
  };
}

// =============================================================================
// Get Latest Receipt CID from Chain
// =============================================================================

/**
 * Queries the on-chain Circle for the latest stored receipt CID.
 *
 * @param hostAddress - Flow address of the circle host
 * @param circleId - Circle ID
 * @returns The latest CID or null if none stored yet
 */
export async function getLatestReceiptCID(
  hostAddress: string,
  circleId: number,
): Promise<string | null> {
  const result = await fcl.query({
    cadence: GET_LATEST_RECEIPT_CID_SCRIPT,
    args: (arg: any, t: any) => [
      arg(hostAddress, t.Address),
      arg(String(circleId), t.UInt64),
    ],
  });

  return result ?? null;
}
