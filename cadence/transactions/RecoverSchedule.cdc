// ============================================================================
// RecoverSchedule.cdc — Manually recover a missing scheduled cycle
// ============================================================================

import ChamaScheduler from "ChamaScheduler"

transaction(circleId: UInt64) {

    prepare(signer: auth(Storage) &Account) {
        let handlerPath = StoragePath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler storage path")

        let handlerRef = signer.storage.borrow<&ChamaScheduler.ChamaTransactionHandler>(from: handlerPath)
            ?? panic("Could not borrow handler — did you run InitHandler?")

        let recovered = handlerRef.recoverSchedule()
        if !recovered {
            panic("Schedule recovery failed. Scheduler reserve may be depleted.")
        }
    }
}
