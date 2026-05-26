// ============================================================================
// RegisterMember.cdc — Register a circle member in ChamaManager
// ============================================================================

import ChamaCircle from "ChamaCircle"
import ChamaManager from "ChamaManager"

transaction(hostAddress: Address, circleId: UInt64) {

    prepare(signer: auth(Storage) &Account) {
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path for circle")

        let circleRef = getAccount(hostAddress)
            .capabilities.get<&ChamaCircle.Circle>(publicPath)
            .borrow()
            ?? panic("Could not borrow circle from host")

        if !circleRef.isMember(address: signer.address) {
            panic("Signer is not a member of the target circle")
        }

        ChamaManager.registerMember(circleId: circleId, member: signer.address)
    }
}
