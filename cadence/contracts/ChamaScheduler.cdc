// ============================================================================
// ChamaScheduler.cdc — Scheduled Transaction Handler for Chama Circles
// ============================================================================
//
// PURPOSE:
//   Bridges ChamaCircle to Flow's FlowTransactionScheduler.
//   Implements the TransactionHandler interface that the Flow protocol
//   calls at scheduled timestamps.
//
// AUTHORIZATION FIX:
//   Inside executeTransaction(), self.owner gives us an UNAUTHORIZED
//   &Account reference. We cannot call .storage.borrow() on it.
//
//   Solution: Store a Capability<&ChamaCircle.Circle> at init time.
//   The handler holds a capability (issued when the handler is created)
//   and borrows from it when the scheduler fires. This avoids the
//   auth(Storage | BorrowValue) requirement entirely.
//
// HOW IT WORKS:
//   1. CreateCircle transaction stores Circle in /storage/chamaCircle_N
//   2. InitHandler transaction:
//      a. Issues a Capability<&ChamaCircle.Circle> for the storage path
//      b. Creates the handler WITH that capability
//      c. Stores the handler in /storage/chamaHandler_N
//      d. Issues Execute-entitled capability for the scheduler
//   3. ScheduleNextCycle registers the handler with FlowTransactionScheduler
//   4. At the deadline, the scheduler calls executeTransaction()
//   5. The handler borrows the circle via its stored capability
//   6. Calls circle.executeCycle() → payout fires trustlessly
// ============================================================================

import FlowTransactionScheduler from "FlowTransactionScheduler"
import ChamaCircle from "ChamaCircle"

access(all) contract ChamaScheduler {

    // ========================================================================
    // EVENTS
    // ========================================================================

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
    // STORAGE PATHS (for getViews/resolveView)
    // ========================================================================

    access(all) let HandlerStoragePathPrefix: String
    access(all) let HandlerPublicPathPrefix: String

    // ========================================================================
    // TRANSACTION HANDLER RESOURCE
    // ========================================================================
    //
    // Holds a Capability to the Circle resource. When the scheduler
    // fires executeTransaction(), the handler borrows the Circle via
    // this capability and calls executeCycle().
    //
    // WHY A CAPABILITY instead of direct storage borrow?
    //   The TransactionHandler's executeTransaction() runs in a context
    //   where self.owner gives an unauthorized account reference.
    //   You CANNOT call self.owner!.storage.borrow() — it requires
    //   auth(Storage | BorrowValue) which isn't available.
    //
    //   Capabilities solve this: they're pre-authorized references
    //   that can be borrowed without additional auth checks.
    // ========================================================================

    access(all) resource ChamaTransactionHandler: FlowTransactionScheduler.TransactionHandler {

        // Pre-authorized capability to the Circle resource.
        // Issued by the circle host during InitHandler transaction.
        access(self) let circleCap: Capability<&ChamaCircle.Circle>

        // Storage path where THIS handler is stored (for getViews)
        access(self) let storagePath: StoragePath
        access(self) let publicPath: PublicPath

        init(
            circleCap: Capability<&ChamaCircle.Circle>,
            storagePath: StoragePath,
            publicPath: PublicPath
        ) {
            self.circleCap = circleCap
            self.storagePath = storagePath
            self.publicPath = publicPath
        }

        // ────────────────────────────────────────────────────────────────
        // executeTransaction — THE FUNCTION THE BLOCKCHAIN CALLS
        // ────────────────────────────────────────────────────────────────
        //
        // Called by the Flow protocol at the scheduled timestamp.
        // No human triggers this — the blockchain is the keeper.
        //
        // Parameters:
        //   id: UInt64 — scheduling ID assigned by FlowTransactionScheduler
        //   data: AnyStruct? — optional data (we pass nil)
        // ────────────────────────────────────────────────────────────────

        access(FlowTransactionScheduler.Execute)
        fun executeTransaction(id: UInt64, data: AnyStruct?) {

            // Borrow the Circle via the stored capability.
            // This works because the capability was issued with full
            // access to the Circle resource during InitHandler.
            let circle = self.circleCap.borrow()
                ?? panic("Could not borrow circle via capability — was the circle moved or destroyed?")

            // Capture state BEFORE execution (for event data)
            let state = circle.getState()
            let currentCycle = state.currentCycle

            // ── THE CRITICAL CALL ──
            // circle.executeCycle() handles everything:
            //   1. Penalize delinquent members
            //   2. Transfer pool to current recipient
            //   3. Reset contribution flags
            //   4. Advance cycle (or complete circle)
            circle.executeCycle()

            emit CycleExecutedByScheduler(
                circleId: state.circleId,
                cycle: currentCycle,
                timestamp: getCurrentBlock().timestamp
            )

            // If circle is still active, emit event for re-scheduling
            let newState = circle.getState()
            if newState.status == ChamaCircle.CircleStatus.ACTIVE {
                emit NextCycleScheduled(
                    circleId: state.circleId,
                    cycle: newState.currentCycle,
                    scheduledFor: newState.nextDeadline
                )
            }
        }

        // ────────────────────────────────────────────────────────────────
        // getViews + resolveView — REQUIRED by TransactionHandler
        // ────────────────────────────────────────────────────────────────

        access(all) view fun getViews(): [Type] {
            return [Type<StoragePath>(), Type<PublicPath>()]
        }

        access(all) fun resolveView(_ view: Type): AnyStruct? {
            switch view {
            case Type<StoragePath>():
                return self.storagePath
            case Type<PublicPath>():
                return self.publicPath
            default:
                return nil
            }
        }
    }

    // ========================================================================
    // FACTORY FUNCTION
    // ========================================================================
    //
    // Creates a handler tied to a specific circle via capability.
    //
    // Called by InitHandler.cdc after issuing a capability for the circle.
    // ========================================================================

    access(all) fun createHandler(
        circleCap: Capability<&ChamaCircle.Circle>,
        storagePath: StoragePath,
        publicPath: PublicPath
    ): @ChamaTransactionHandler {
        return <- create ChamaTransactionHandler(
            circleCap: circleCap,
            storagePath: storagePath,
            publicPath: publicPath
        )
    }

    init() {
        self.HandlerStoragePathPrefix = "chamaHandler_"
        self.HandlerPublicPathPrefix = "chamaHandler_"
    }
}
