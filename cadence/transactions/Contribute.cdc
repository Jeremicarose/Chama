// ============================================================================
// Contribute.cdc — Transaction for a member to contribute to the current cycle
// ============================================================================
//
// WHAT THIS DOES:
//   1. Borrows the Circle from the host account
//   2. Withdraws the contribution amount from the signer's vault
//   3. Calls circle.contribute() to deposit into the circle's pool
//
// TIMING:
//   Members must contribute BEFORE the scheduled transaction fires.
//   If they don't, executeCycle() will mark them as delinquent and
//   penalize their security deposit. There's no grace period —
//   the blockchain is the enforcer.
//
// PARAMETERS:
//   hostAddress: Account that stores the Circle resource
//   circleId: Circle ID (for storage path construction)
// ============================================================================

import ChamaCircle from "ChamaCircle"
import FlowToken from "FlowToken"
import FungibleToken from "FungibleToken"

transaction(hostAddress: Address, circleId: UInt64) {

    prepare(signer: auth(Storage) &Account) {

        // ── Borrow the circle via public capability ──
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")

        let circleRef = getAccount(hostAddress)
            .capabilities.get<&ChamaCircle.Circle>(publicPath)
            .borrow()
            ?? panic("Could not borrow circle ".concat(circleId.toString()))

        // ── Read the contribution amount from config ──
        // We don't pass the amount as a parameter — it's defined
        // in the circle's config. This prevents members from
        // over-contributing or under-contributing.
        let amount = circleRef.config.contributionAmount

        // ── Withdraw from signer's vault ──
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                from: /storage/flowTokenVault
            ) ?? panic("Could not borrow FlowToken vault")

        let payment <- vaultRef.withdraw(amount: amount)
            as! @FlowToken.Vault

        // ── Contribute to the circle ──
        // circle.contribute() will:
        //   - Verify the circle is ACTIVE
        //   - Verify the signer is a member
        //   - Verify the signer hasn't already contributed this cycle
        //   - Deposit the payment into the circle's pool vault
        //   - Update the member's contribution status
        //   - Emit ContributionReceived event
        circleRef.contribute(member: signer.address, payment: <- payment)
    }
}
