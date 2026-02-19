// ============================================================================
// GetCircleState.cdc — Query the full state of a savings circle
// ============================================================================
//
// This is a SCRIPT (read-only, no gas cost, no signing required).
// The frontend's useCircle() hook calls this via @onflow/fcl's query().
//
// Returns a CircleState struct containing everything the UI needs:
//   - config (name, contribution amount, cycle duration, etc.)
//   - status (FORMING, ACTIVE, COMPLETED, CANCELLED)
//   - currentCycle, nextDeadline, poolBalance
//   - members array with contribution status
//   - nextRecipient address
//   - latestReceiptCID (Storacha link)
//
// PARAMETERS:
//   hostAddress: The account that stores the Circle resource
//   circleId: The circle's unique ID
// ============================================================================

import ChamaCircle from "ChamaCircle"

access(all) fun main(hostAddress: Address, circleId: UInt64): ChamaCircle.CircleState? {
    // Construct the public path from the circle ID.
    // This matches the path created in CreateCircle.cdc.
    let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
        ?? panic("Could not construct public path")

    // Borrow via public capability — no auth needed for read access
    let circleRef = getAccount(hostAddress)
        .capabilities.get<&ChamaCircle.Circle>(publicPath)
        .borrow()

    if let circle = circleRef {
        return circle.getState()
    }

    // Return nil if the circle doesn't exist at this path
    return nil
}
