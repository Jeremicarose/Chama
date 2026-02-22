// =============================================================================
// GetLatestReceiptCID.cdc — Query the latest receipt CID from a Circle
// =============================================================================
//
// Returns the latest Storacha CID stored on-chain, or nil if none yet.
// Use this to find the head of the receipt chain before walking backward
// through IPFS to verify the full audit trail.
// =============================================================================

import ChamaCircle from "ChamaCircle"

access(all) fun main(hostAddress: Address, circleId: UInt64): String? {
    let host = getAccount(hostAddress)
    let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
        ?? panic("Could not construct public path")

    let circleRef = host.capabilities
        .borrow<&ChamaCircle.Circle>(publicPath)
        ?? panic("Could not borrow Circle from host")

    let state = circleRef.getState()
    return state.latestReceiptCID
}
