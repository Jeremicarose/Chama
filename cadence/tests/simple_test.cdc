import Test
import "TestSimple"

access(all) fun setup() {
    let err = Test.deployContract(
        name: "TestSimple",
        path: "../contracts/TestSimple.cdc",
        arguments: []
    )
    if err != nil { log(err!.message) }
    Test.expect(err, Test.beNil())
}

access(all) fun testCount() {
    Test.assertEqual(0 as UInt64, TestSimple.count)
}
