import ChamaScheduler from "ChamaScheduler"

access(all) fun main(hostAddress: Address, circleId: UInt64): AnyStruct? {
    let host = getAccount(hostAddress)
    let publicPath = PublicPath(identifier: "chamaHandler_".concat(circleId.toString()))
        ?? panic("Could not construct handler public path")

    let handlerRef = host.capabilities
        .borrow<&{ChamaScheduler.ChamaTransactionHandlerPublic}>(publicPath)

    if handlerRef == nil {
        return nil
    }

    return {
        "initialized": true,
        "hasScheduledTransaction": handlerRef!.hasScheduledTransaction(),
        "feeReserveBalance": handlerRef!.getFeeReserveBalance(),
        "scheduledTransactionId": handlerRef!.currentScheduledTransactionId()
    }
}
