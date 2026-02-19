// ============================================================================
// GetCircleCount.cdc — Get total number of registered circles
// ============================================================================

import ChamaManager from "ChamaManager"

access(all) fun main(): Int {
    return ChamaManager.getCircleCount()
}
