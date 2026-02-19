// ============================================================================
// InitHandler.cdc — Initialize the ChamaTransactionHandler for a circle
// ============================================================================
//
// WHAT THIS DOES:
//   1. Issues a Capability<&ChamaCircle.Circle> for the circle's storage path
//   2. Creates a ChamaTransactionHandler with that capability
//   3. Stores the handler in the signer's account
//   4. Issues Execute-entitled capability for FlowTransactionScheduler
//
// WHEN TO CALL:
//   After the circle seals (all members joined, status = ACTIVE).
//   Must be called BEFORE ScheduleNextCycle.cdc.
//
// AUTHORIZATION PATTERN:
//   The handler needs to call circle.executeCycle() when the scheduler fires.
//   Inside executeTransaction(), self.owner is unauthorized — we can't
//   borrow from storage directly. Solution: pass a pre-issued capability
//   to the handler at creation time. The capability acts as a pre-authorized
//   reference that can be borrowed without auth checks.
//
// PARAMETERS:
//   circleId: The circle ID (used to construct storage paths)
// ============================================================================

import ChamaCircle from "ChamaCircle"
import ChamaScheduler from "ChamaScheduler"
import FlowTransactionScheduler from "FlowTransactionScheduler"

transaction(circleId: UInt64) {

    prepare(signer: auth(Storage, Capabilities) &Account) {

        // ── Construct paths ──
        let circlePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create circle storage path")

        let handlerPath = StoragePath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler storage path")

        let handlerPublicPath = PublicPath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler public path")

        // ── Check if handler already exists (idempotent) ──
        if signer.storage.borrow<&AnyResource>(from: handlerPath) != nil {
            return
        }

        // ── Step 1: Issue capability to the Circle resource ──
        //
        // This capability allows the handler to borrow the Circle
        // without needing auth(Storage) access. The capability is
        // "pre-authorized" — whoever holds it can borrow the reference.
        let circleCap = signer.capabilities.storage
            .issue<&ChamaCircle.Circle>(circlePath)

        // ── Step 2: Create the handler with the circle capability ──
        let handler <- ChamaScheduler.createHandler(
            circleCap: circleCap,
            storagePath: handlerPath,
            publicPath: handlerPublicPath
        )

        // ── Step 3: Store handler in account ──
        signer.storage.save(<- handler, to: handlerPath)

        // ── Step 4: Issue Execute-entitled capability for the scheduler ──
        //
        // CRITICAL: Must include FlowTransactionScheduler.Execute entitlement.
        // Without it, the scheduler cannot call executeTransaction().
        let _ = signer.capabilities.storage
            .issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(handlerPath)

        // Public capability for discovery (no Execute = read-only)
        let publicCap = signer.capabilities.storage
            .issue<&{FlowTransactionScheduler.TransactionHandler}>(handlerPath)
        signer.capabilities.publish(publicCap, at: handlerPublicPath)
    }
}
