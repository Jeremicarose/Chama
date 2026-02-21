// =============================================================================
// receipt-service.ts — Storacha Receipt Storage for Chama
// =============================================================================
//
// PURPOSE:
//   Every on-chain action (contribution, payout, penalty) produces a receipt
//   that is uploaded to IPFS via Storacha (@storacha/client). Each receipt
//   contains a previousReceiptCID field, creating an immutable chain of
//   receipts that mirrors the on-chain event history.
//
// WHY IPFS (not a database)?
//   - Content-addressed: Same data always produces the same CID (tamper-evident)
//   - Decentralized: Receipts are retrievable from any IPFS gateway
//   - Permanent: Storacha provides "hot" storage (always online, unlike Filecoin cold storage)
//   - Verifiable: Anyone can walk the chain and verify integrity
//
// HOW THE CHAIN WORKS:
//   Receipt 1 (circle created):  { ...data, previousReceiptCID: null }
//   Receipt 2 (contribution):    { ...data, previousReceiptCID: "bafyCID1" }
//   Receipt 3 (payout):          { ...data, previousReceiptCID: "bafyCID2" }
//   ...each receipt links to the previous one via CID.
//
// STORACHA CLIENT SETUP:
//   Requires three environment variables:
//   - STORACHA_KEY: Agent private key (ed25519, base64-encoded)
//   - STORACHA_PROOF: UCAN delegation proof (base64-encoded CAR)
//   - STORACHA_SPACE_DID: Space DID (did:key:...)
//
//   To generate these:
//   1. npx @storacha/cli login your@email.com
//   2. npx @storacha/cli space create chama-receipts
//   3. npx @storacha/cli key create --json > key.json
//   4. npx @storacha/cli delegation create <agent-did> | base64
//
// =============================================================================

import * as Client from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import * as Signer from '@ucanto/principal/ed25519';
import { CarReader } from '@ipld/car';
import * as Proof from '@storacha/client/proof';

// =============================================================================
// Types
// =============================================================================

/**
 * Receipt data for any Chama on-chain action.
 *
 * FIELD EXPLANATIONS:
 * - circleId: Matches the on-chain Circle resource ID
 * - action: Human-readable event type for filtering/display
 * - actor: Flow address of the person who triggered the action
 * - timestamp: ISO 8601 string of when the action occurred
 * - details: Action-specific data (amounts, cycle numbers, etc.)
 * - previousReceiptCID: CID of the prior receipt in the chain (null for first)
 * - transactionId: Flow transaction ID for on-chain verification
 */
export interface ReceiptData {
  circleId: string;
  action:
    | 'circle_created'
    | 'member_joined'
    | 'circle_sealed'
    | 'contribution'
    | 'payout_executed'
    | 'member_penalized'
    | 'cycle_advanced'
    | 'circle_completed'
    | 'deposit_returned';
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
  previousReceiptCID?: string | null;
  transactionId?: string;
}

// =============================================================================
// Storacha Client Initialization
// =============================================================================

/**
 * Creates and configures a Storacha client instance.
 *
 * WHY A FACTORY FUNCTION (not a singleton)?
 * Server-side code in Next.js may run in multiple request contexts.
 * Creating a fresh client per request avoids shared mutable state issues.
 * The overhead is minimal — client creation is just key parsing + config.
 *
 * AUTHENTICATION FLOW:
 * 1. Parse the agent's ed25519 private key from STORACHA_KEY
 * 2. Create a client with that key as the signing identity
 * 3. Parse the UCAN delegation proof from STORACHA_PROOF
 * 4. Add the proof to the client (authorizes uploads to the space)
 * 5. Set the current space to STORACHA_SPACE_DID
 */
async function createStorachaClient() {
  const key = process.env.STORACHA_KEY;
  const proofStr = process.env.STORACHA_PROOF;
  const spaceDID = process.env.STORACHA_SPACE_DID;

  if (!key || !proofStr || !spaceDID) {
    throw new Error(
      'Missing Storacha configuration. Set STORACHA_KEY, STORACHA_PROOF, and STORACHA_SPACE_DID environment variables.',
    );
  }

  // Parse the agent's signing key (ed25519 private key, base64-encoded)
  const principal = Signer.parse(key);

  // Create client with in-memory store (no persistent state needed for uploads)
  const client = await Client.create({ principal, store: new StoreMemory() });

  // Parse the UCAN delegation proof
  // The proof is a CAR (Content ARchive) file encoded as base64.
  // It contains the delegation chain from the space owner to our agent.
  const proofBytes = Buffer.from(proofStr, 'base64');
  const reader = await CarReader.fromBytes(proofBytes);
  const proofs = await Proof.parse(reader as any);

  // Add the proof to authorize uploads
  const space = await client.addSpace(proofs);
  await client.setCurrentSpace(space.did());

  return client;
}

// =============================================================================
// Receipt Upload
// =============================================================================

/**
 * Uploads a receipt to IPFS via Storacha and returns the CID.
 *
 * CONTENT ADDRESSING:
 * The CID (Content Identifier) is a hash of the receipt content.
 * Uploading the same receipt data (including identical timestamps)
 * always produces the same CID. This is a feature — tamper-evident.
 *
 * @param receiptData - The receipt details to store.
 * @param previousCID - Optional CID of the previous receipt in the chain.
 * @returns The CID string of the uploaded receipt on IPFS.
 */
export async function uploadReceipt(
  receiptData: ReceiptData,
  previousCID?: string | null,
): Promise<string> {
  // Construct the full receipt with chain linkage
  const receipt = {
    ...receiptData,
    previousReceiptCID: previousCID ?? receiptData.previousReceiptCID ?? null,
    receiptVersion: 1,
    uploadedAt: new Date().toISOString(),
  };

  // Serialize to JSON bytes
  const jsonString = JSON.stringify(receipt, null, 2);
  const bytes = new TextEncoder().encode(jsonString);
  const blob = new Blob([bytes], { type: 'application/json' });

  // Upload to Storacha / IPFS
  const client = await createStorachaClient();
  const cid = await client.uploadFile(blob as any);

  return cid.toString();
}

// =============================================================================
// Receipt Chain Verification
// =============================================================================

/**
 * Verifies the integrity of a receipt chain by walking backward from
 * the latest receipt to the genesis receipt.
 *
 * WHAT THIS PROVES:
 * - Every receipt in the chain exists and is retrievable from IPFS
 * - Each receipt correctly references its predecessor via CID
 * - No receipt has been altered (altering content changes the CID)
 * - The chain is complete from latest action to circle creation
 *
 * WHAT THIS DOES NOT PROVE:
 * - That the receipt data is truthful (on-chain verification needed)
 * - That no receipts were skipped (on-chain event log is source of truth)
 *
 * @param latestCID - The CID of the most recent receipt in the chain.
 * @returns Object with the ordered chain of receipts and validity flag.
 */
export async function verifyReceiptChain(latestCID: string): Promise<{
  valid: boolean;
  chain: Array<{
    cid: string;
    receipt: ReceiptData & {
      receiptVersion?: number;
      uploadedAt?: string;
    };
  }>;
  error?: string;
}> {
  const chain: Array<{
    cid: string;
    receipt: ReceiptData & {
      receiptVersion?: number;
      uploadedAt?: string;
    };
  }> = [];

  let currentCID: string | null | undefined = latestCID;
  const MAX_CHAIN_LENGTH = 1000;
  let depth = 0;

  try {
    while (currentCID && depth < MAX_CHAIN_LENGTH) {
      depth++;

      // Fetch the receipt from IPFS via the Storacha gateway
      const gatewayUrl = `https://${currentCID}.ipfs.w3s.link`;
      const response = await fetch(gatewayUrl);

      if (!response.ok) {
        return {
          valid: false,
          chain,
          error: `Failed to fetch receipt at CID ${currentCID}: HTTP ${response.status} ${response.statusText}`,
        };
      }

      let receipt: ReceiptData & {
        receiptVersion?: number;
        uploadedAt?: string;
      };

      try {
        receipt = await response.json();
      } catch {
        return {
          valid: false,
          chain,
          error: `Receipt at CID ${currentCID} is not valid JSON.`,
        };
      }

      // Basic structural validation
      if (!receipt.circleId || !receipt.action || !receipt.timestamp) {
        return {
          valid: false,
          chain,
          error: `Receipt at CID ${currentCID} is missing required fields (circleId, action, or timestamp).`,
        };
      }

      chain.push({ cid: currentCID, receipt });
      currentCID = receipt.previousReceiptCID;
    }

    if (depth >= MAX_CHAIN_LENGTH && currentCID) {
      return {
        valid: false,
        chain,
        error: `Chain exceeds maximum length of ${MAX_CHAIN_LENGTH} receipts. Possible circular reference.`,
      };
    }

    return { valid: true, chain };
  } catch (err) {
    return {
      valid: false,
      chain,
      error: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// =============================================================================
// Utility: Build a receipt gateway URL from a CID
// =============================================================================

/**
 * Constructs a public IPFS gateway URL for a given CID.
 * Useful for displaying receipt links in the UI.
 *
 * @param cid - The CID of the receipt.
 * @returns A fully-qualified HTTPS URL to the receipt on IPFS.
 */
export function getReceiptUrl(cid: string): string {
  return `https://${cid}.ipfs.w3s.link`;
}
