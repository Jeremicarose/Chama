// ===========================================================================
// history/page.tsx - Receipt hsitory and audit trial viewer
// ==============================================================================
//
// PURPOSE:
//    Displays the full recipt chain for each circle the user belongs to.
//    Each on-chain action (join, contribute, payout, penalty) produces an IPFS
//    receipt linked to the previous one via CID. This page walks that chain
//    and renders it as a timeline, giving users a tamper-proof audit trial.
//
// DATA FLOW:
//    1. Fetch user's circle IDs from ChamaManager (same as Dashboard)
//    2. For each circle, get the state (which includes latestReceiptCID)
//    3. When user selects a circle, fetch the receipt chain from IPFS
//    4. Render receipts as a vertical timeline (newest first)
//
// WHY A SEPARATE PAGE (not a tab on Circle Detail)?
//  The receipt chain can be long (one receipt per action per cycle). Mixing
//  it into the Circle Details page would clutter the primary "contribute now"
//  workflow. A dedicated page lets users focus on auditing when they want to.
//
// IPFS FETCHING:
//  Receipts are fetched client-side from the Storacha gateway (w3s.link).
//  Each receipt JSON includes a previousReceiptCID field - we follow that
//  chain backward until we hit null (the genesis receipt).
//
// PERFORMANCE:
//  We limnit chain walking to 50 receipts per load to avoid blocking the UI
//  on circles with hundreds of cycles. A "Load More" button continues from
//  where we left off.
// ===================================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';

// =====================================================================================
// Cadence Scripts
// =======================================================================
//
// Reused from Dadhboard - these query the ChamaManager registry to find
// which circles a user belong to, then fetch each circle's state.

const GET_MEMBER_CIRCLES_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(member: Address ): [UInt64] {
    return ChamaManager.getMemberCircles(member: member)
}
`;

const GET_CIRCLE_HOST_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(circleId: UInt64): Address? {
    return ChamaManager.getCircleHost(circleId: circleId)
}
`;

const GET_CIRCLE_STATE_SCRIPT = `
import ChamaCircle from 0xChamaCircle

access(all) fun main(hostAddress: Address, circleId: UInt)
`