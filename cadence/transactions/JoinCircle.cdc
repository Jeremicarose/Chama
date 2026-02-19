// ============================================================================
// JoinCircle.cdc — Transaction for a member to join an existing circle
// ============================================================================
//
// WHAT THIS DOES:
//   1. Borrows the Circle resource from the HOST account's storage
//   2. Withdraws the security deposit from the signer's FlowToken vault
//   3. Calls circle.join() to add the signer as a member
//   4. Registers the member in ChamaManager for reverse lookup
//
// WHO CALLS THIS:
//   Any user who wants to join a FORMING circle. They need:
//   - The host address (who created and stores the circle)
//   - The circle ID (to construct the storage path)
//   - Enough FLOW for the security deposit (= contributionAmount)
//
// WHAT HAPPENS IF THE CIRCLE IS NOW FULL:
//   circle.join() auto-calls seal() when memberOrder.length == maxMembers.
//   This transitions the circle from FORMING → ACTIVE and starts Cycle 1.
//   The frontend should listen for the CircleSealed event and then submit
//   the InitHandler + ScheduleFirstCycle transactions.
//
// PARAMETERS:
//   hostAddress: The account that created and stores the Circle resource
//   circleId: The circle's unique ID (used to construct storage path)
// ============================================================================

import ChamaCircle from "ChamaCircle"
import ChamaManager from "ChamaManager"
import FlowToken from "FlowToken"
import FungibleToken from "FungibleToken"

transaction(hostAddress: Address, circleId: UInt64) {

    prepare(signer: auth(Storage) &Account) {

        // ── Step 1: Borrow the Circle from the host's storage ──
        //
        // The circle lives in the HOST's account, not the joiner's.
        // We borrow it via getAccount(hostAddress).
        //
        // WHY getAccount() and not getAuthAccount()?
        //   getAccount() gives us a PublicAccount — read-only access.
        //   But we need to call join(), which is access(all).
        //   access(all) functions are callable via ANY reference, including
        //   public capabilities. So we borrow via the public capability
        //   we issued in CreateCircle.cdc.
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path for circle ".concat(circleId.toString()))

        let circleRef = getAccount(hostAddress)
            .capabilities.get<&ChamaCircle.Circle>(publicPath)
            .borrow()
            ?? panic("Could not borrow circle ".concat(circleId.toString())
                .concat(" from host ").concat(hostAddress.toString())
                .concat(" — is the circle registered?"))

        // ── Step 2: Withdraw security deposit ──
        //
        // The deposit amount equals the circle's contributionAmount.
        // This is locked for the entire circle duration as collateral
        // against non-contribution (delinquency).
        let depositAmount = circleRef.config.contributionAmount

        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                from: /storage/flowTokenVault
            ) ?? panic("Could not borrow FlowToken vault")

        let deposit <- vaultRef.withdraw(amount: depositAmount)
            as! @FlowToken.Vault

        // ── Step 3: Join the circle ──
        //
        // circle.join() will:
        //   - Verify the circle is FORMING
        //   - Verify the signer isn't already a member
        //   - Verify the circle isn't full
        //   - Verify the deposit is sufficient
        //   - Assign a rotation position
        //   - Lock the deposit
        //   - Auto-seal if the circle is now full
        circleRef.join(member: signer.address, deposit: <- deposit)

        // ── Step 4: Register in ChamaManager ──
        //
        // Enables the dashboard to show "My Circles" for this member.
        ChamaManager.registerMember(circleId: circleId, member: signer.address)
    }
}
