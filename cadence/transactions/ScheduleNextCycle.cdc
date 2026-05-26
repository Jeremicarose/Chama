// ============================================================================
// ScheduleNextCycle.cdc — Schedule the next cycle's payout via FlowTransactionScheduler
// ============================================================================
//
// WHAT THIS DOES:
//   1. Borrows the Circle to read the next deadline timestamp
//   2. Borrows the handler capability
//   3. Estimates the scheduling fee
//   4. Pays the fee and registers the scheduled transaction
//
// WHEN TO CALL:
//   - After InitHandler.cdc (first cycle scheduling)
//   - After each CycleExecutedByScheduler event (re-scheduling for next cycle)
//
// THE SELF-CHAINING PATTERN:
//   Flow Scheduled Transactions don't automatically repeat. Each scheduling
//   is a one-shot: fire once at the target timestamp, then done.
//
//   For Chama's rotating cycles, we need to CHAIN:
//     Circle seals → Schedule Cycle 1 deadline
//     Cycle 1 fires → Schedule Cycle 2 deadline
//     Cycle 2 fires → Schedule Cycle 3 deadline
//     ... until all cycles complete.
//
//   The handler can't self-schedule (no access to fee vault inside
//   executeTransaction()). So the frontend listens for NextCycleScheduled
//   events and submits this transaction to schedule the next one.
//
//   For the hackathon demo (4 cycles, 60s each), this is fine — the presenter
//   can even do it manually. In production, you'd use the Manager pattern
//   with pre-funded fees or an event listener service.
//
// PARAMETERS:
//   circleId: Circle ID (for path construction)
//   cycleDuration: How far in the future to schedule (seconds)
//
// COST:
//   ~0.001 FLOW per scheduling at current network rates.
//   For a 4-member circle: ~0.004 FLOW total. Negligible.
// ============================================================================

import FlowTransactionScheduler from "FlowTransactionScheduler"
import ChamaCircle from "ChamaCircle"
import ChamaScheduler from "ChamaScheduler"

transaction(circleId: UInt64) {

    prepare(signer: auth(Storage, Capabilities) &Account) {

        // ── Construct paths ──
        let circlePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create circle storage path")
        let handlerPath = StoragePath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler storage path")

        // ── Verify the circle is still ACTIVE ──
        // No point scheduling if the circle is completed or cancelled
        let circleRef = signer.storage.borrow<&ChamaCircle.Circle>(from: circlePath)
            ?? panic("Could not borrow circle — is it stored at this path?")

        let state = circleRef.getState()
        if state.status != ChamaCircle.CircleStatus.ACTIVE {
            return  // Circle is not active, nothing to schedule
        }

        let handlerRef = signer.storage.borrow<&ChamaScheduler.ChamaTransactionHandler>(from: handlerPath)
            ?? panic("Could not borrow handler — did you run InitHandler?")

        let scheduled = handlerRef.initializeSchedule(
            deadline: state.nextDeadline,
            cycleDuration: state.config.cycleDuration
        )
        if !scheduled {
            panic("Unable to schedule cycle. Scheduler reserve may be depleted.")
        }
    }
}
