// ============================================================================
// CreateCircle.cdc — Transaction to create a new savings circle
// ============================================================================
//
// WHAT THIS DOES:
//   1. Creates a CircleConfig with the provided parameters
//   2. Calls ChamaCircle.createCircle() to mint a new Circle resource
//   3. Stores the Circle resource in the signer's account storage
//   4. Issues a public capability so others can read circle state
//   5. Registers the circle in ChamaManager for discovery
//   6. Auto-joins the creator as the first member (with security deposit)
//
// WHO CALLS THIS:
//   The circle creator, via the "Create New Circle" page in the frontend.
//   The signer becomes the HOST — the Circle resource lives in their account.
//
// PARAMETERS:
//   name: Human-readable circle name (e.g., "Nairobi Builders")
//   contributionAmount: FLOW per member per cycle (e.g., 10.0)
//   cycleDuration: Seconds between payouts (60.0 for demo, 2592000.0 for monthly)
//   maxMembers: Circle size, also = number of cycles (e.g., 4)
//   penaltyPercent: % of deposit forfeited on delinquency (e.g., 50.0)
//
// COST TO SIGNER:
//   - contributionAmount in FLOW (security deposit for auto-join)
//   - ~0.001 FLOW storage fee for the Circle resource
// ============================================================================

import ChamaCircle from "ChamaCircle"
import ChamaManager from "ChamaManager"
import FlowToken from "FlowToken"
import FungibleToken from "FungibleToken"

transaction(
    name: String,
    contributionAmount: UFix64,
    cycleDuration: UFix64,
    maxMembers: UInt64,
    penaltyPercent: UFix64
) {
    // References we'll use across prepare and execute
    let signer: auth(Storage, Capabilities) &Account
    let signerAddress: Address

    prepare(signer: auth(Storage, Capabilities) &Account) {
        self.signer = signer
        self.signerAddress = signer.address

        // ── Step 1: Build the circle configuration ──
        // CircleConfig validates all inputs in its init() pre-conditions.
        // If any are invalid (e.g., maxMembers < 2), the entire tx reverts.
        let config = ChamaCircle.CircleConfig(
            name: name,
            contributionAmount: contributionAmount,
            cycleDuration: cycleDuration,
            maxMembers: maxMembers,
            penaltyPercent: penaltyPercent
        )

        // ── Step 2: Create the Circle resource ──
        // ChamaCircle.createCircle() returns a @Circle resource.
        // The <- operator moves ownership to us (Cadence linear types).
        let circle <- ChamaCircle.createCircle(
            config: config,
            creator: signer.address
        )

        // Capture the circle ID before moving the resource into storage
        let circleId = circle.circleId

        // ── Step 3: Store in the signer's account ──
        // Storage path is deterministic: /storage/chamaCircle_{id}
        // This lets anyone reconstruct the path from just the circle ID.
        let storagePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create storage path for circle ".concat(circleId.toString()))

        signer.storage.save(<- circle, to: storagePath)

        // ── Step 4: Issue public capability for read access ──
        // Anyone can borrow a &ChamaCircle.Circle reference to call
        // getState(), isMember(), hasContributed(), etc.
        // They CANNOT call executeCycle() because it requires the actual
        // resource (not just a reference) or contract-level access.
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create public path")

        let cap = signer.capabilities.storage
            .issue<&ChamaCircle.Circle>(storagePath)
        signer.capabilities.publish(cap, at: publicPath)

        // ── Step 5: Register in ChamaManager ──
        // Makes this circle discoverable via ChamaManager.getAllCircleIds()
        // and ChamaManager.getCircleHost(circleId)
        ChamaManager.registerCircle(
            circleId: circleId,
            name: name,
            host: signer.address
        )

        // ── Step 6: Auto-join creator as Member 1 ──
        // The creator puts up the security deposit and gets rotation position 0.
        // This means they receive the payout in Cycle 1.
        //
        // Borrow the vault to withdraw the deposit amount
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                from: /storage/flowTokenVault
            ) ?? panic("Could not borrow FlowToken vault — is your account set up?")

        let deposit <- vaultRef.withdraw(amount: contributionAmount)
            as! @FlowToken.Vault

        // Borrow the circle we just stored to call join()
        let circleRef = signer.storage
            .borrow<&ChamaCircle.Circle>(from: storagePath)
            ?? panic("Could not borrow circle we just created")

        circleRef.join(member: signer.address, deposit: <- deposit)

        // Register creator as a member in the manager
        ChamaManager.registerMember(circleId: circleId, member: signer.address)
    }
}
