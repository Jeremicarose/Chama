// =============================================================================
// /api/receipts — Server-side receipt upload to IPFS via Storacha
// =============================================================================
//
// PURPOSE:
//   Bridge between the client (browser) and Storacha (IPFS storage).
//   The Storacha client requires server-side environment variables
//   (STORACHA_KEY, STORACHA_PROOF, STORACHA_SPACE_DID) that can't be
//   exposed to the browser. This API route:
//
//   1. Receives receipt data from the client (POST body)
//   2. Uploads the receipt JSON to IPFS via Storacha
//   3. Returns the CID to the client
//
//   The CLIENT then stores the CID on-chain via StoreReceiptCID transaction
//   (which requires the user's wallet signature — can only happen client-side).
//
// WHY NOT DO EVERYTHING SERVER-SIDE?
//   Storing the CID on-chain requires fcl.mutate with fcl.currentUser,
//   which is the user's browser wallet. The server can't sign transactions
//   on behalf of the user. So we split: server uploads, client anchors.
//
// SECURITY:
//   No authentication on this endpoint for the hackathon. In production,
//   you'd verify the caller is a circle member via signed message or session.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { uploadReceipt, type ReceiptData } from '@/lib/receipt-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const { circleId, action, actor, timestamp, details, previousReceiptCID, transactionId } = body;

    if (!circleId || !action || !actor || !timestamp) {
      return NextResponse.json(
        { error: 'Missing required fields: circleId, action, actor, timestamp' },
        { status: 400 },
      );
    }

    // Construct the receipt data
    const receiptData: ReceiptData = {
      circleId,
      action,
      actor,
      timestamp,
      details: details || {},
      previousReceiptCID: previousReceiptCID || null,
      transactionId: transactionId || undefined,
    };

    // Upload to IPFS via Storacha (server-side — requires env vars)
    const cid = await uploadReceipt(receiptData, previousReceiptCID);

    return NextResponse.json({ cid, url: `https://${cid}.ipfs.w3s.link` });
  } catch (err: unknown) {
    console.error('Receipt upload failed:', err);

    // If Storacha isn't configured, return a graceful degradation response
    // The app still works — just without IPFS receipts
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('Missing Storacha configuration')) {
      return NextResponse.json(
        { error: 'Receipt storage not configured', cid: null },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to upload receipt' },
      { status: 500 },
    );
  }
}
