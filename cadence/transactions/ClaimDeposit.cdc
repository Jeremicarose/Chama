// =============================================================================
// ClaimDeposit.cdc — Manual deposit retrieval for failed auto-returns
// =============================================================================
//
// WHEN TO USE:
//   After a circle completes, returnDeposits() automatically sends deposits
//   back. If that fails (e.g., broken receiver capability), the deposit stays
//   in the Circle resource. This transaction lets the member claim it manually.
//
// PARAMETERS:
//   hostAddress: Flow address of the circle host (who stores the Circle)
//   circleId: The circle's ID
// =============================================================================

import ChamaCircle from "ChamaCircle"
import FungibleToken from "FungibleToken"
import FlowToken from "FlowToken"

transaction(hostAddress: Address, circleId: UInt64) {

    prepare(signer: auth(Storage) &Account) {

        // Borrow the Circle via the host's public capability
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")

        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle from host")

        // Claim the deposit (returns a FlowToken.Vault resource)
        let deposit <- circleRef.claimDeposit(member: signer.address)
            as! @FlowToken.Vault

        // Deposit into the signer's FlowToken vault
        let vaultRef = signer.storage
            .borrow<&FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault")

        vaultRef.deposit(from: <- deposit)
    }
}
