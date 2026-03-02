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
//    1. Fetch user's circle IDs from Chama