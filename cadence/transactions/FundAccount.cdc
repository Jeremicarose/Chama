// Fund a test account with FLOW tokens from the emulator service account
import FungibleToken from "FungibleToken"
import FlowToken from "FlowToken"

transaction(recipient: Address, amount: UFix64) {
    prepare(signer: auth(Storage) &Account) {
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                from: /storage/flowTokenVault
            ) ?? panic("Could not borrow vault")

        let payment <- vaultRef.withdraw(amount: amount)

        let receiverRef = getAccount(recipient)
            .capabilities.get<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            .borrow()
            ?? panic("Could not borrow receiver")

        receiverRef.deposit(from: <- payment)
    }
}
