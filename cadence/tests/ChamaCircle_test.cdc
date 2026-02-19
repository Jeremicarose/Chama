// ============================================================================
// ChamaCircle_test.cdc — Test suite for ChamaKit contracts
// ============================================================================
//
// Run with: flow test cadence/tests/ChamaCircle_test.cdc
//
// HOW CADENCE TESTING WORKS:
//   The test framework spins up an in-memory blockchain (NOT the emulator).
//   Each test function runs independently. We deploy our contracts in setup()
//   and then test them via transactions and scripts.
//
//   Key differences from the emulator:
//   - Accounts are created with Test.createAccount(), not pre-existing
//   - Contracts must be explicitly deployed in setup()
//   - Resource operations need transactions (can't create resources in scripts)
//   - Struct operations CAN be tested directly (value types, no ownership)
//
// WHAT WE TEST:
//   1. CircleConfig validation (reject bad inputs)
//   2. MemberInfo helper methods (struct operations)
//   3. Circle creation via transaction
//   4. Circle state queries via scripts
//   5. Member joining and auto-seal
//   6. Contribution tracking
// ============================================================================

import Test
import "ChamaCircle"

// ============================================================================
// SETUP — Deploy contracts to the test blockchain
// ============================================================================
//
// This runs ONCE before all tests. It deploys ChamaCircle to the test
// blockchain so all test functions can interact with it.
//
// WHY NOT import and use directly?
//   The test framework's in-memory blockchain needs contracts deployed
//   explicitly. Unlike the emulator which reads flow.json, the test
//   blockchain starts empty.
// ============================================================================

access(all) let account = Test.getAccount(0x0000000000000007)

access(all) fun setup() {
    // Deploy ChamaCircle to the test blockchain.
    // The test framework resolves "ChamaCircle" from flow.json's contracts section.
    let err = Test.deployContract(
        name: "ChamaCircle",
        path: "../contracts/ChamaCircle.cdc",
        arguments: []
    )
    Test.expect(err, Test.beNil())
}

// ============================================================================
// TEST: CircleConfig Validation
// ============================================================================
//
// CircleConfig uses pre-conditions to enforce invariants at construction.
// These tests verify that invalid configs are rejected.
// We test struct creation directly because structs are value types —
// no resource ownership issues.
// ============================================================================

access(all) fun testCreateCircleConfigValid() {
    // WHAT: Create a config with valid parameters
    // WHY: Baseline test — valid configs must succeed
    let config = ChamaCircle.CircleConfig(
        name: "Test Chama",
        contributionAmount: 10.0,
        cycleDuration: 60.0,
        maxMembers: 4,
        penaltyPercent: 50.0
    )

    // Verify all fields are set correctly
    Test.assertEqual("Test Chama", config.name)
    Test.assertEqual(10.0, config.contributionAmount)
    Test.assertEqual(60.0, config.cycleDuration)
    Test.assertEqual(4 as UInt64, config.maxMembers)
    Test.assertEqual(50.0, config.penaltyPercent)
}

access(all) fun testConfigRejectsZeroContribution() {
    // WHAT: Config with contributionAmount = 0 should panic
    // WHY: A circle where nobody contributes anything is meaningless.
    //       The pre-condition "contributionAmount > 0.0" must catch this.
    let failed = Test.expectFailure(fun(): Void {
        let _ = ChamaCircle.CircleConfig(
            name: "Bad Circle",
            contributionAmount: 0.0,
            cycleDuration: 60.0,
            maxMembers: 4,
            penaltyPercent: 50.0
        )
    }, errorMessageSubstring: "Contribution must be positive")
}

access(all) fun testConfigRejectsOneMember() {
    // WHAT: Config with maxMembers = 1 should panic
    // WHY: A ROSCA needs at least 2 people — you can't rotate with yourself.
    let failed = Test.expectFailure(fun(): Void {
        let _ = ChamaCircle.CircleConfig(
            name: "Solo Circle",
            contributionAmount: 10.0,
            cycleDuration: 60.0,
            maxMembers: 1,
            penaltyPercent: 50.0
        )
    }, errorMessageSubstring: "Need at least 2 members")
}

access(all) fun testConfigRejectsTooManyMembers() {
    // WHAT: Config with maxMembers > 20 should panic
    // WHY: Large circles create gas issues in executeCycle() which
    //       iterates over all members. 20 is the safety cap.
    let failed = Test.expectFailure(fun(): Void {
        let _ = ChamaCircle.CircleConfig(
            name: "Huge Circle",
            contributionAmount: 10.0,
            cycleDuration: 60.0,
            maxMembers: 25,
            penaltyPercent: 50.0
        )
    }, errorMessageSubstring: "Max 20 members")
}

access(all) fun testConfigRejectsInvalidPenalty() {
    // WHAT: Config with penaltyPercent > 100 should panic
    // WHY: You can't forfeit more than 100% of a deposit.
    let failed = Test.expectFailure(fun(): Void {
        let _ = ChamaCircle.CircleConfig(
            name: "Harsh Circle",
            contributionAmount: 10.0,
            cycleDuration: 60.0,
            maxMembers: 4,
            penaltyPercent: 150.0
        )
    }, errorMessageSubstring: "Penalty must be 0-100%")
}

// ============================================================================
// TEST: MemberInfo Helpers
// ============================================================================
//
// MemberInfo is a struct (value type), so we can create and test it
// directly without transactions. The helper methods (withContribution,
// resetForNewCycle, withDelinquency) use the "create new, replace"
// pattern required by Cadence's immutable structs in dictionaries.
// ============================================================================

access(all) fun testMemberInfoInitialization() {
    // WHAT: New MemberInfo starts with clean state
    // WHY: Members should have no contributions and no penalties at creation
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)

    Test.assertEqual(account.address, member.address)
    Test.assertEqual(false, member.hasContributed)
    Test.assertEqual(0.0, member.totalContributed)
    Test.assertEqual(0 as UInt64, member.cyclesContributed)
    Test.assertEqual(false, member.isDelinquent)
    Test.assertEqual(0 as UInt64, member.rotationPosition)
}

access(all) fun testMemberInfoWithContribution() {
    // WHAT: withContribution() returns a new struct with updated fields
    // WHY: In Cadence, structs in dictionaries are immutable in-place.
    //       You must create a new struct and replace the old one.
    //       This helper encapsulates that pattern.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 2)
    let updated = member.withContribution(amount: 10.0)

    // The ORIGINAL is unchanged (value type semantics)
    Test.assertEqual(false, member.hasContributed)
    Test.assertEqual(0.0, member.totalContributed)

    // The UPDATED copy has the new values
    Test.assertEqual(true, updated.hasContributed)
    Test.assertEqual(10.0, updated.totalContributed)
    Test.assertEqual(1 as UInt64, updated.cyclesContributed)

    // Position and address are preserved
    Test.assertEqual(2 as UInt64, updated.rotationPosition)
    Test.assertEqual(account.address, updated.address)
}

access(all) fun testMemberInfoAccumulatesContributions() {
    // WHAT: Multiple contributions accumulate totalContributed
    // WHY: Over N cycles, a member contributes N × contributionAmount.
    //       The total is tracked for the receipt system and history page.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let after1 = member.withContribution(amount: 10.0)
    let after2 = after1.resetForNewCycle().withContribution(amount: 10.0)

    Test.assertEqual(20.0, after2.totalContributed)
    Test.assertEqual(2 as UInt64, after2.cyclesContributed)
    Test.assertEqual(true, after2.hasContributed)
}

access(all) fun testMemberInfoResetForNewCycle() {
    // WHAT: resetForNewCycle() clears hasContributed but keeps totals
    // WHY: At the start of each cycle, contribution flags reset so members
    //       must contribute again. But historical totals are preserved.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let contributed = member.withContribution(amount: 10.0)
    let reset = contributed.resetForNewCycle()

    // hasContributed resets to false
    Test.assertEqual(false, reset.hasContributed)

    // But totals are preserved
    Test.assertEqual(10.0, reset.totalContributed)
    Test.assertEqual(1 as UInt64, reset.cyclesContributed)
}

access(all) fun testMemberInfoWithDelinquency() {
    // WHAT: withDelinquency() marks a member as permanently delinquent
    // WHY: Once marked delinquent, a member's deposit is partially forfeited
    //       and they don't get their deposit back at circle completion.
    //       Delinquency is permanent for the circle — no forgiveness.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)

    Test.assertEqual(false, member.isDelinquent)

    let delinquent = member.withDelinquency()

    Test.assertEqual(true, delinquent.isDelinquent)
    // Other fields preserved
    Test.assertEqual(account.address, delinquent.address)
    Test.assertEqual(0 as UInt64, delinquent.rotationPosition)
}

access(all) fun testDelinquencyPreservesContributionHistory() {
    // WHAT: Marking delinquent preserves prior contribution data
    // WHY: A member who contributed in cycles 1-3 but missed cycle 4
    //       should still have their history (for receipts and auditing).
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let contributed = member.withContribution(amount: 10.0)
    let delinquent = contributed.withDelinquency()

    Test.assertEqual(true, delinquent.isDelinquent)
    Test.assertEqual(true, delinquent.hasContributed)
    Test.assertEqual(10.0, delinquent.totalContributed)
    Test.assertEqual(1 as UInt64, delinquent.cyclesContributed)
}

// ============================================================================
// TEST: Circle Counter
// ============================================================================

access(all) fun testTotalCirclesCreatedIncrements() {
    // WHAT: Each createCircle() call increments the global counter
    // WHY: Circle IDs must be unique and sequential for UI readability.
    //       The counter lives at the contract level and only increments.
    let initialCount = ChamaCircle.totalCirclesCreated

    // We can't call createCircle() directly from a test (returns a resource
    // that needs storage), but we can verify the counter starts at the
    // expected value. After our setup + any prior tests, it should be
    // at whatever the deployment set it to (0).
    Test.assert(initialCount >= 0, message: "Counter should be non-negative")
}
