// ============================================================================
// ChamaScheduler.cdc — Scheduled Transaction Handler for Chama Circles
// ============================================================================
//
// PURPOSE:
//   This contract bridges ChamaCircle to Flow's FlowTransactionScheduler.
//   It implements the TransactionHandler interface — the hook that the
//   Flow protocol calls when a scheduled timestamp arrives.
//
// HOW SCHEDULED TRANSACTIONS WORK ON FLOW:
//   1. You create a TransactionHandler resource (this contract provides one)
//   2. You store it in your account and issue a capability
//   3. You call FlowTransactionScheduler.schedule() with:
//      - The handler capability
//      - A future timestamp
//      - Priority level (High/Medium/Low)
//      - Execution effort estimate
//      - Fee payment (FlowToken)
//   4. At the target timestamp, the Flow execution engine calls:
//      handler.executeTransaction(id, data)
//   5. The handler can then schedule the NEXT execution (self-chaining)
//
// WHY THIS IS REVOLUTIONARY FOR ROSCAs:
//   Every previous blockchain ROSCA needs an external trigger:
//   - WeTrust (Ethereum): keeper bot
//   - Bloinx: cron job
//   - CircleSync (our Celo design): WhatsApp bot calls executePayout()
//
//   With Flow Scheduled Transactions, the PROTOCOL is the keeper.
//   The blockchain itself fires executeCycle() at the deadline.
//   No bots. No servers. No coordinator. Trustless by architecture.
//
// CRITICAL API CORRECTION (from spec):
//   The spec assumed: executeTransaction(data: AnyStruct?)
//   The actual API is: executeTransaction(id: UInt64, data: AnyStruct?)
//   The handler also MUST implement getViews() and resolveView()
//   to report its storage and public paths. These are required by
//   the TransactionHandler interface.
// ============================================================================

import FlowTransactionScheduler from "FlowTransactionScheduler"
import ChamaCircle from "ChamaCircle"

access(all) contract ChamaScheduler {

    // ========================================================================
    // EVENTS
    // ========================================================================
    // These events let the frontend know when scheduled actions fire.
    // The frontend subscribes to CycleExecutedByScheduler to trigger
    // the PayoutBanner animation — the "wow moment" in the demo.

    access(all) event CycleExecutedByScheduler(
        circleId: UInt64,
        cycle: UInt64,
        timestamp: UFix64
    )
    access(all) event NextCycleScheduled(
        circleId: UInt64,
        cycle: UInt64,
        scheduledFor: UFix64
    )

    // ========================================================================
    // TRANSACTION HANDLER RESOURCE
    // ========================================================================
    //
    // This resource implements FlowTransactionScheduler.TransactionHandler.
    // When the Flow protocol fires a scheduled transaction, it calls
    // executeTransaction() on this resource.
    //
    // WHY A RESOURCE (not a function)?
    //   The scheduler needs a stable reference to call back into.
    //   A resource stored in an account provides this — the scheduler
    //   holds a capability to it. Resources can't be duplicated or
    //   spoofed, so only the legitimate handler fires.
    //
    // ACCESS CONTROL:
    //   executeTransaction uses access(FlowTransactionScheduler.Execute)
    //   This is an ENTITLEMENT — only the FlowTransactionScheduler system
    //   contract can call it. No one else can trigger your handler.
    //   This prevents griefing attacks where someone calls executeCycle()
    //   at the wrong time.
    // ========================================================================

    access(all) resource ChamaTransactionHandler: FlowTransactionScheduler.TransactionHandler {

        // The storage path where the Circle resource lives.
        // Each handler is tied to ONE circle — if you have multiple circles,
        // you create multiple handlers stored at different paths.
        access(self) let circlePath: StoragePath

        init(circlePath: StoragePath) {
            self.circlePath = circlePath
        }

        // ────────────────────────────────────────────────────────────────
        // executeTransaction — THE FUNCTION THE BLOCKCHAIN CALLS
        // ────────────────────────────────────────────────────────────────
        //
        // Parameters (from FlowTransactionScheduler.TransactionHandler):
        //   id: UInt64 — unique scheduling ID assigned by the scheduler
        //   data: AnyStruct? — optional data passed at schedule time
        //
        // IMPORTANT: The spec had only (data: AnyStruct?) but the actual
        // Flow API requires (id: UInt64, data: AnyStruct?). The id lets
        // you track which scheduled tx fired (useful for debugging and
        // for the Manager pattern's internal bookkeeping).
        //
        // WHAT HAPPENS WHEN THIS FIRES:
        //   1. Borrows the Circle resource from the host account's storage
        //   2. Reads the current state (to capture cycle number for events)
        //   3. Calls circle.executeCycle() which:
        //      - Checks all contributions
        //      - Penalizes delinquent members
        //      - Transfers pool to current recipient
        //      - Resets contribution flags
        //      - Advances cycle (or completes circle)
        //   4. Emits events for the frontend to pick up
        //   5. If circle is still active, emits NextCycleScheduled
        //      (the frontend or a re-scheduling tx handles the next schedule)
        // ────────────────────────────────────────────────────────────────

        access(FlowTransactionScheduler.Execute)
        fun executeTransaction(id: UInt64, data: AnyStruct?) {

            // self.owner is the account that stores this handler resource.
            // We borrow the Circle from that same account's storage.
            // This is safe because:
            //   - Only the account owner can store resources in their storage
            //   - The capability is issued by the owner
            //   - The scheduler calls via that capability
            let circle = self.owner!.storage
                .borrow<&ChamaCircle.Circle>(from: self.circlePath)
                ?? panic("Could not borrow circle from ".concat(self.circlePath.toString()))

            // Capture state BEFORE execution (for event data)
            let state = circle.getState()
            let currentCycle = state.currentCycle

            // ── THE CRITICAL CALL ──
            // This is where the trustless payout happens.
            // circle.executeCycle() handles everything:
            // penalties, payout transfer, cycle advancement.
            circle.executeCycle()

            emit CycleExecutedByScheduler(
                circleId: state.circleId,
                cycle: currentCycle,
                timestamp: getCurrentBlock().timestamp
            )

            // Check if the circle is still active (more cycles remain)
            let newState = circle.getState()
            if newState.status == ChamaCircle.CircleStatus.ACTIVE {
                // Emit event so the frontend (or a listener transaction)
                // knows to schedule the next cycle.
                //
                // WHY NOT SELF-SCHEDULE HERE?
                //   Scheduling requires paying fees (FlowToken withdrawal).
                //   Inside executeTransaction(), we don't have access to a
                //   fee-paying vault. The scheduling fee must come from a
                //   separate transaction submitted by the circle host or
                //   from a pre-funded fee vault.
                //
                //   For the hackathon demo (4 cycles, 60s each), the frontend
                //   listens for this event and auto-submits ScheduleNextCycle.cdc.
                //   In production, you'd use FlowTransactionSchedulerUtils.Manager
                //   with pre-funded fees at circle creation time.
                emit NextCycleScheduled(
                    circleId: state.circleId,
                    cycle: newState.currentCycle,
                    scheduledFor: newState.nextDeadline
                )
            }
        }

        // ────────────────────────────────────────────────────────────────
        // getViews + resolveView — REQUIRED BY TransactionHandler
        // ────────────────────────────────────────────────────────────────
        //
        // These methods tell the scheduler where this handler lives
        // in account storage. The scheduler uses them for discovery
        // and management. Without these, deployment will fail with
        // "does not conform to TransactionHandler".
        //
        // getViews() returns the types of views this handler supports.
        // resolveView() returns the actual value for a given view type.
        // For handlers, the convention is to return StoragePath and PublicPath.
        // ────────────────────────────────────────────────────────────────

        access(all) view fun getViews(): [Type] {
            return [Type<StoragePath>(), Type<PublicPath>()]
        }

        access(all) fun resolveView(_ view: Type): AnyStruct? {
            switch view {
            case Type<StoragePath>():
                return self.circlePath
            case Type<PublicPath>():
                // Derive a public path from the storage path name
                // e.g., /storage/chamaHandler_1 -> /public/chamaHandler_1
                return PublicPath(identifier: self.circlePath.toString().slice(
                    from: "/storage/".length,
                    upTo: self.circlePath.toString().length
                )) ?? /public/chamaHandler
            default:
                return nil
            }
        }
    }

    // ========================================================================
    // FACTORY FUNCTION
    // ========================================================================
    //
    // Creates a handler tied to a specific circle's storage path.
    //
    // Usage in a transaction:
    //   let handler <- ChamaScheduler.createHandler(
    //       circlePath: /storage/chamaCircle_1
    //   )
    //   signer.storage.save(<- handler, to: /storage/chamaHandler_1)
    //
    // The caller then issues a capability and passes it to the scheduler.
    // ========================================================================

    access(all) fun createHandler(circlePath: StoragePath): @ChamaTransactionHandler {
        return <- create ChamaTransactionHandler(circlePath: circlePath)
    }

    init() {}
}
