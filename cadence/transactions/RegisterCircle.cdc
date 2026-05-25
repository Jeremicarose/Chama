// ============================================================================
// RegisterCircle.cdc — Register a created circle in ChamaManager
// ============================================================================

import ChamaCircle from "ChamaCircle"
import ChamaManager from "ChamaManager"

transaction(circleId: UInt64, name: String) {

    prepare(signer: auth(Storage) &Account) {
        let storagePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create circle storage path")

        let circleRef = signer.storage.borrow<&ChamaCircle.Circle>(from: storagePath)
            ?? panic("Could not borrow circle from signer storage")

        let state = circleRef.getState()

        pre {
            state.circleId == circleId: "Circle ID does not match stored circle"
            state.config.name == name: "Provided circle name does not match stored circle"
        }

        ChamaManager.registerCircle(
            circleId: circleId,
            name: name,
            host: signer.address
        )
    }
}
