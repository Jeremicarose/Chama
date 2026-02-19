// ============================================================================
// ChamaManager.cdc — Registry and Discovery for Chama Circles
// ============================================================================
//
// PURPOSE:
//   Provides a global registry so circles can be discovered by:
//   - Circle ID → host account address (who stores the Circle resource)
//   - Member address → list of circle IDs they belong to
//
// WHY A SEPARATE CONTRACT?
//   ChamaCircle.cdc defines the Circle resource but doesn't track WHERE
//   circles are stored. Each Circle lives in a host account's storage.
//   Without a registry, you'd need to know the exact account address AND
//   storage path to find a circle.
//
//   ChamaManager solves this by maintaining two lookup tables:
//   1. circleRegistry: circleId → host address (forward lookup)
//   2. memberCircles: member address → [circleIds] (reverse lookup)
//
//   The frontend calls ChamaManager to list "all circles" or "my circles"
//   without needing to scan every account on the network.
//
// DESIGN DECISION: Contract-level storage vs. per-account
//   Alternative: Each account stores their own list of circles.
//   We chose contract-level storage because:
//   - Simpler queries (one contract call vs. scanning accounts)
//   - The registry is small (IDs + addresses, not full circle data)
//   - Discovery is the primary use case (dashboard, "browse circles")
//   - Full circle data is still fetched from the host account's Circle resource
//
// SECURITY NOTE:
//   registerCircle() and registerMember() are access(all) — anyone can call them.
//   This is intentional for the hackathon: we trust that only the CreateCircle
//   and JoinCircle transactions call these functions.
//   In production, you'd gate these with entitlements or an admin capability.
// ============================================================================

access(all) contract ChamaManager {

    // ========================================================================
    // EVENTS
    // ========================================================================

    access(all) event CircleRegistered(circleId: UInt64, name: String, host: Address)

    // ========================================================================
    // STATE
    // ========================================================================

    // Forward lookup: given a circle ID, find which account hosts it.
    // The frontend uses this to construct the storage path and borrow
    // the Circle resource for reading state.
    access(contract) var circleRegistry: {UInt64: Address}

    // Reverse lookup: given a member's address, find all their circles.
    // Powers the dashboard's "My Circles" section.
    access(contract) var memberCircles: {Address: [UInt64]}

    // ========================================================================
    // REGISTRATION FUNCTIONS
    // ========================================================================

    /// Register a newly created circle in the global registry.
    ///
    /// Called by the CreateCircle transaction after storing the Circle resource.
    /// Maps circleId → host address so anyone can discover and query it.
    ///
    /// Parameters:
    ///   circleId: The unique ID returned by ChamaCircle.createCircle()
    ///   name: Circle name (for event emission — not stored separately)
    ///   host: The account address that stores the Circle resource
    access(all) fun registerCircle(circleId: UInt64, name: String, host: Address) {
        self.circleRegistry[circleId] = host
        emit CircleRegistered(circleId: circleId, name: name, host: host)
    }

    /// Register a member's association with a circle.
    ///
    /// Called by the JoinCircle transaction after the member successfully joins.
    /// Enables reverse lookup: "show me all circles this address belongs to."
    ///
    /// Parameters:
    ///   circleId: The circle the member joined
    ///   member: The member's Flow account address
    access(all) fun registerMember(circleId: UInt64, member: Address) {
        if self.memberCircles[member] == nil {
            self.memberCircles[member] = []
        }
        // Append the circle ID to this member's list.
        // We don't check for duplicates because join() has its own
        // "already a member" pre-condition that prevents double-joining.
        self.memberCircles[member]!.append(circleId)
    }

    // ========================================================================
    // QUERY FUNCTIONS — Used by frontend Cadence scripts
    // ========================================================================

    /// Get the host account address for a circle.
    /// Returns nil if the circle ID isn't registered.
    ///
    /// Usage: Frontend calls this to know WHERE to borrow the Circle resource.
    /// Then it constructs StoragePath(/storage/chamaCircle_{id}) and borrows.
    access(all) fun getCircleHost(circleId: UInt64): Address? {
        return self.circleRegistry[circleId]
    }

    /// Get all circle IDs a member belongs to.
    /// Returns empty array if the member isn't in any circles.
    ///
    /// Usage: Dashboard "My Circles" tab. For each returned ID, the frontend
    /// calls getCircleHost() then borrows the Circle to get full state.
    access(all) fun getMemberCircles(member: Address): [UInt64] {
        return self.memberCircles[member] ?? []
    }

    /// Get all registered circle IDs.
    /// Used for the "Browse All Circles" page.
    ///
    /// NOTE: For the hackathon (< 20 circles), returning all IDs is fine.
    /// In production, you'd want pagination or filtering.
    access(all) fun getAllCircleIds(): [UInt64] {
        return self.circleRegistry.keys
    }

    /// Get the total number of registered circles.
    /// Useful for dashboard stats without fetching all IDs.
    access(all) fun getCircleCount(): Int {
        return self.circleRegistry.length
    }

    // ========================================================================
    // CONTRACT INITIALIZATION
    // ========================================================================

    init() {
        self.circleRegistry = {}
        self.memberCircles = {}
    }
}
