// =============================================================================
// StoreReceiptCID.cdc — Store an IPFS receipt CID on-chain
// =============================================================================
//
// WHAT THIS DOES:
//   After the frontend uploads a receipt JSON to Storacha (IPFS), it gets
//   back a CID (Content Identifier). This transaction stores that CID on
//   the Circle resource, creating an on-chain anchor for the off-chain
//   audit trail.
//
// WHY ON-CHAIN?
//   The CID alone doesn't prove the receipt was created at a specific time
//   or by an authorized party. By storing it on-chain:
//   1. The block timestamp proves WHEN the receipt was anchored
//   2. The transaction signer proves WHO stored it
//   3. The ReceiptCIDStored event makes it discoverable by indexers
//   4. Anyone can fetch the CID, retrieve the receipt from IPFS, and verify
//
// PARAMETERS:
//   hostAddress: The Flow address of the circle host (where Circle is stored)
//   circleId: The circle's ID (for path construction)
//   cid: The IPFS CID string (e.g., "bafybei...")
// =============================================================================

import ChamaCircle from "ChamaCircle"

transaction(hostAddress: Address, circleId: UInt64, cid: String) {

    prepare(signer: auth(Storage) &Account) {
        // Borrow the Circle via the host's public capability
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")

        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle from host — is it published?")

        // Store the CID on-chain
        circleRef.storeReceiptCID(cid: cid)
    }
}
