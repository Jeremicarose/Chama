// ============================================================================
// InitHandler.cdc — Initialize the ChamaTransactionHandler for a circle
// ============================================================================
//
// WHAT THIS DOES:
//   1. Creates a ChamaTransactionHandler resource tied to a specific circle
//   2. Stores it in the signer's account
//   3. Issues capabilities for the FlowTransactionScheduler to call it
//
// WHEN TO CALL:
//   After the circle seals (all members joined, status = ACTIVE).
//   This MUST happen before ScheduleNextCycle.cdc — you can't schedule
//   a handler that doesn't exist yet.
//
// WHY SEPARATE FROM CreateCircle?
//   The handler is only needed when the circle becomes ACTIVE.
//   Creating it at circle creation time would waste storage for circles
//   that never fill up. Also, the handler needs to be stored BEFORE
//   scheduling, and scheduling needs fees — separating these steps
//   gives the frontend control over the flow.
//
// PARAMETERS:
//   circleId: The circle ID (used to construct storage paths)
// ============================================================================

import ChamaScheduler from "ChamaScheduler"
import FlowTransactionScheduler from "FlowTransactionScheduler"

transaction(circleId: UInt64) {

    prepare(signer: auth(Storage, Capabilities) &Account) {

        // ── Construct paths ──
        // Handler path mirrors the circle path for consistency:
        //   Circle:  /storage/chamaCircle_1
        //   Handler: /storage/chamaHandler_1
        let circlePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create circle storage path")

        let handlerPath = StoragePath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler storage path")

        // ── Check if handler already exists ──
        // Prevents double-initialization (idempotent operation)
        if signer.storage.borrow<&AnyResource>(from: handlerPath) != nil {
            return  // Handler already initialized, nothing to do
        }

        // ── Step 1: Create the handler resource ──
        // The handler is tied to a specific circle via circlePath.
        // When the scheduler calls executeTransaction(), the handler
        // borrows the Circle from this path and calls executeCycle().
        let handler <- ChamaScheduler.createHandler(circlePath: circlePath)

        // ── Step 2: Store in account ──
        signer.storage.save(<- handler, to: handlerPath)

        // ── Step 3: Issue capability with Execute entitlement ──
        //
        // CRITICAL: The capability must have the FlowTransactionScheduler.Execute
        // entitlement. This is what allows the scheduler to call
        // executeTransaction() on our handler. Without this entitlement,
        // the scheduled transaction will fail with an access error.
        //
        // We issue an auth capability (with Execute) for the scheduler,
        // and a plain public capability for querying handler status.
        let _ = signer.capabilities.storage
            .issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(handlerPath)

        // Public capability for discovery (no Execute entitlement = read-only)
        let publicPath = PublicPath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler public path")

        let publicCap = signer.capabilities.storage
            .issue<&{FlowTransactionScheduler.TransactionHandler}>(handlerPath)
        signer.capabilities.publish(publicCap, at: publicPath)
    }
}
