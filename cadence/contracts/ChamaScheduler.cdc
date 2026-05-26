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
import FlowToken from "FlowToken"
import FungibleToken from "FungibleToken"

access(all) contract ChamaScheduler {

    access(all) struct ScheduleResult {
        access(all) let success: Bool
        access(all) let scheduledFor: UFix64
        access(all) let reason: String

        init(success: Bool, scheduledFor: UFix64, reason: String) {
            self.success = success
            self.scheduledFor = scheduledFor
            self.reason = reason
        }
    }

    access(all) resource interface ChamaTransactionHandlerPublic {
        access(all) view fun getFeeReserveBalance(): UFix64
        access(all) view fun hasScheduledTransaction(): Bool
        access(all) view fun currentScheduledTransactionId(): UInt64?
    }

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
    access(all) event SchedulerInitialized(circleId: UInt64, feeReserve: UFix64)
    access(all) event SchedulerRecoveryNeeded(circleId: UInt64, cycle: UInt64, reason: String)
    access(all) event SchedulerRecovered(circleId: UInt64, cycle: UInt64, scheduledFor: UFix64)

    // ========================================================================
    // STORAGE PATHS (for getViews/resolveView)
    // ========================================================================

    access(all) let HandlerStoragePathPrefix: String
    access(all) let HandlerPublicPathPrefix: String
    access(all) let ScheduledTxStoragePathPrefix: String

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

    access(all) resource ChamaTransactionHandler:
        FlowTransactionScheduler.TransactionHandler,
        ChamaTransactionHandlerPublic {

        // Pre-authorized capability to the Circle resource.
        // Issued by the circle host during InitHandler transaction.
        access(self) let circleCap: Capability<&ChamaCircle.Circle>
        access(self) var schedulerCapability: Capability<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>?
        access(self) let feeVault: @FlowToken.Vault
        access(self) var currentScheduledTx: @FlowTransactionScheduler.ScheduledTransaction?
        access(self) var currentScheduledTxId: UInt64?

        // Storage path where THIS handler is stored (for getViews)
        access(self) let storagePath: StoragePath
        access(self) let publicPath: PublicPath

        init(
            circleCap: Capability<&ChamaCircle.Circle>,
            feeVault: @FlowToken.Vault,
            storagePath: StoragePath,
            publicPath: PublicPath
        ) {
            self.circleCap = circleCap
            self.schedulerCapability = nil
            self.feeVault <- feeVault
            self.currentScheduledTx <- nil
            self.currentScheduledTxId = nil
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
                let result = self.scheduleNextCycle(deadline: newState.nextDeadline)
                if result.success {
                    emit NextCycleScheduled(
                        circleId: state.circleId,
                        cycle: newState.currentCycle,
                        scheduledFor: result.scheduledFor
                    )
                } else {
                    emit SchedulerRecoveryNeeded(
                        circleId: state.circleId,
                        cycle: newState.currentCycle,
                        reason: result.reason
                    )
                }
            }
        }

        access(all) fun configureSchedulerCapability(
            _ capability: Capability<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>
        ) {
            self.schedulerCapability = capability
        }

        access(self) fun estimateFeeForTimestamp(_ timestamp: UFix64): FlowTransactionScheduler.EstimatedScheduledTransaction {
            return FlowTransactionScheduler.estimate(
                data: nil,
                timestamp: timestamp,
                priority: FlowTransactionScheduler.Priority.Medium,
                executionEffort: 5000
            )
        }

        access(self) view fun currentTimestamp(): UFix64 {
            return getCurrentBlock().timestamp
        }

        access(self) fun scheduleNextCycle(deadline: UFix64): ScheduleResult {
            if self.schedulerCapability == nil {
                return ScheduleResult(
                    success: false,
                    scheduledFor: deadline,
                    reason: "Scheduler capability is not configured"
                )
            }
            let handlerCap = self.schedulerCapability!

            let estimate = self.estimateFeeForTimestamp(deadline)
            let targetTimestamp = estimate.timestamp ?? deadline
            let feeAmount = estimate.flowFee ?? 0.001

            if self.feeVault.balance < feeAmount {
                return ScheduleResult(
                    success: false,
                    scheduledFor: deadline,
                    reason: "Insufficient scheduler fee reserve"
                )
            }

            let fees <- self.feeVault.withdraw(amount: feeAmount) as! @FlowToken.Vault
            let scheduledTx <- FlowTransactionScheduler.schedule(
                handlerCap: handlerCap,
                data: nil,
                timestamp: targetTimestamp,
                priority: FlowTransactionScheduler.Priority.Medium,
                executionEffort: 5000,
                fees: <- fees
            )
            let scheduledTxId = scheduledTx.id

            if let oldTx <- self.currentScheduledTx <- scheduledTx {
                destroy oldTx
            }
            self.currentScheduledTxId = scheduledTxId

            return ScheduleResult(success: true, scheduledFor: targetTimestamp, reason: "")
        }

        access(all) fun initializeSchedule(deadline: UFix64, cycleDuration: UFix64): Bool {
            let current = self.currentTimestamp()
            var requestedDeadline = deadline
            if deadline <= current {
                requestedDeadline = current + cycleDuration
            }

            let result = self.scheduleNextCycle(deadline: requestedDeadline)
            return result.success
        }

        access(all) fun recoverSchedule(): Bool {
            let circle = self.circleCap.borrow()
                ?? panic("Could not borrow circle via capability — was the circle moved or destroyed?")
            let state = circle.getState()
            if state.status != ChamaCircle.CircleStatus.ACTIVE {
                panic("Can only recover schedules for active circles")
            }

            let current = self.currentTimestamp()
            var recoveryDeadline = state.nextDeadline
            if state.nextDeadline <= current {
                recoveryDeadline = current + 1.0
            }

            let result = self.scheduleNextCycle(deadline: recoveryDeadline)
            if result.success {
                emit SchedulerRecovered(
                    circleId: state.circleId,
                    cycle: state.currentCycle,
                    scheduledFor: result.scheduledFor
                )
            } else {
                emit SchedulerRecoveryNeeded(
                    circleId: state.circleId,
                    cycle: state.currentCycle,
                    reason: result.reason
                )
            }
            return result.success
        }

        access(all) view fun getFeeReserveBalance(): UFix64 {
            return self.feeVault.balance
        }

        access(all) view fun hasScheduledTransaction(): Bool {
            return self.currentScheduledTxId != nil
        }

        access(all) view fun currentScheduledTransactionId(): UInt64? {
            return self.currentScheduledTxId
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
        feeVault: @FlowToken.Vault,
        storagePath: StoragePath,
        publicPath: PublicPath
    ): @ChamaTransactionHandler {
        return <- create ChamaTransactionHandler(
            circleCap: circleCap,
            feeVault: <- feeVault,
            storagePath: storagePath,
            publicPath: publicPath
        )
    }

    init() {
        self.HandlerStoragePathPrefix = "chamaHandler_"
        self.HandlerPublicPathPrefix = "chamaHandler_"
        self.ScheduledTxStoragePathPrefix = "chamaScheduledTx_"
    }
}
