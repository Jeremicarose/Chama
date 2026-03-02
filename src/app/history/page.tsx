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
