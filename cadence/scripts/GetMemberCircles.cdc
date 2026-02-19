// ============================================================================
// GetMemberCircles.cdc — Query all circles a member belongs to
// ============================================================================
//
// Powers the dashboard "My Circles" section.
// Returns an array of circle IDs that the member has joined.
// The frontend then calls GetCircleState for each ID to get full details.
//
// PARAMETER:
//   memberAddress: The Flow account address to look up
// ============================================================================

import ChamaManager from "ChamaManager"

access(all) fun main(memberAddress: Address): [UInt64] {
    return ChamaManager.getMemberCircles(member: memberAddress)
}
