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
import ChamaScheduler from "ChamaScheduler"
import ChamaCircle from "ChamaCircle"
import FlowToken from "FlowToken"
import FungibleToken from "FungibleToken"

transaction(circleId: UInt64, cycleDuration: UFix64) {

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

        // ── Get the handler capability ──
        //
        // We need an auth capability with FlowTransactionScheduler.Execute.
        // This was issued in InitHandler.cdc.
        //
        // issue() returns a NEW capability each time. For scheduling,
        // we need one that the scheduler can store and call later.
        // The capability issued in InitHandler should work, but we
        // issue a fresh one here to ensure it's valid.
        let handlerCap = signer.capabilities.storage
            .issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(handlerPath)

        // ── Calculate target timestamp ──
        // Schedule for cycleDuration seconds from NOW.
        // On emulator with --block-time 1s, this means ~cycleDuration blocks.
        let targetTimestamp = getCurrentBlock().timestamp + cycleDuration

        // ── Estimate fees ──
        //
        // FlowTransactionScheduler.estimate() returns a struct with:
        //   - flowFee: UFix64? — the total fee in FLOW
        //   - timestamp: UFix64? — confirmed execution timestamp
        //   - error: String? — if estimation failed
        //
        // Priority levels:
        //   High — executes as soon as possible after timestamp
        //   Medium — standard priority (good for our use case)
        //   Low — best-effort, may be delayed
        //
        // executionEffort: Gas limit estimate. 10000 is generous for
        // our executeCycle() function (iterate members, transfer funds).
        let estimate = FlowTransactionScheduler.estimate(
            data: nil,
            timestamp: targetTimestamp,
            priority: FlowTransactionScheduler.Priority.Medium,
            executionEffort: 10000
        )

        // ── Pay scheduling fee ──
        let feeAmount = estimate.flowFee ?? 0.001  // Fallback if estimate returns nil
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                from: /storage/flowTokenVault
            ) ?? panic("Could not borrow FlowToken vault for fee payment")

        let fees <- vaultRef.withdraw(amount: feeAmount)
            as! @FlowToken.Vault

        // ── Schedule the transaction ──
        //
        // schedule() returns a @ScheduledTransaction resource.
        // In Cadence, resources MUST be explicitly handled — you can't
        // ignore a return value that's a resource type (linear types).
        //
        // We store it in the signer's account so we can:
        //   1. Query its status later (scheduledTx.status())
        //   2. Track which scheduled txs belong to which circle
        //   3. Satisfy Cadence's "no resource loss" rule
        //
        // After scheduling, the Flow protocol will:
        //   1. Hold the fee payment
        //   2. At targetTimestamp, call handlerCap.executeTransaction(id, data)
        //   3. Emit FlowTransactionScheduler.Executed event
        let scheduledTx <- FlowTransactionScheduler.schedule(
            handlerCap: handlerCap,
            data: nil,
            timestamp: targetTimestamp,
            priority: FlowTransactionScheduler.Priority.Medium,
            executionEffort: 10000,
            fees: <- fees
        )

        // Store the scheduled transaction receipt in the signer's account.
        // Path: /storage/chamaScheduledTx_{circleId}
        // This lets us check status or cancel if needed.
        let scheduledTxPath = StoragePath(identifier: "chamaScheduledTx_".concat(circleId.toString()))
            ?? panic("Could not create scheduled tx storage path")

        // If there's a previous scheduled tx at this path (from a prior cycle),
        // we need to remove it first to avoid storage collision.
        if let oldTx <- signer.storage.load<@FlowTransactionScheduler.ScheduledTransaction>(from: scheduledTxPath) {
            destroy oldTx
        }

        signer.storage.save(<- scheduledTx, to: scheduledTxPath)
    }
}
