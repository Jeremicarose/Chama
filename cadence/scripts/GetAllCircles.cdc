// ============================================================================
// GetAllCircles.cdc — Query all registered circle IDs and their hosts
// ============================================================================
//
// Returns a dictionary of circleId → hostAddress for all registered circles.
// The frontend uses this for the "Browse Circles" page.
//
// For the hackathon (< 20 circles), returning everything is fine.
// In production, you'd add pagination.
// ============================================================================

import ChamaManager from "ChamaManager"

access(all) fun main(): {UInt64: Address} {
    let circleIds = ChamaManager.getAllCircleIds()
    let result: {UInt64: Address} = {}

    for id in circleIds {
        if let host = ChamaManager.getCircleHost(circleId: id) {
            result[id] = host
        }
    }

    return result
}
