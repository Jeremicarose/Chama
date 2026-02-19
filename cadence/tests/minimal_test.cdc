import Test

access(all) fun setup() {
    let err = Test.deployContract(
        name: "ChamaCircle",
        path: "cadence/contracts/ChamaCircle.cdc",
        arguments: []
    )
    if err != nil {
        log(err!.message)
    }
    Test.expect(err, Test.beNil())
}

access(all) fun testBasic() {
    Test.assert(true, message: "basic test")
}
