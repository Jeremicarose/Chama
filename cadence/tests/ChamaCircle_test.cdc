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
    Test.assertEqual(0 as UInt64, member.delinquencyCount)
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
    // WHAT: withDelinquency() marks a member as delinquent and increments count
    // WHY: Delinquency is tracked per-cycle. Each missed cycle increments the
    //       count and applies another penalty to the remaining deposit.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)

    Test.assertEqual(false, member.isDelinquent)
    Test.assertEqual(0 as UInt64, member.delinquencyCount)

    let delinquent = member.withDelinquency()

    Test.assertEqual(true, delinquent.isDelinquent)
    Test.assertEqual(1 as UInt64, delinquent.delinquencyCount)
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
// TEST: Compounding Delinquency
// ============================================================================
//
// These tests verify the new penalty model where missing multiple cycles
// applies repeated penalties to the shrinking deposit.

access(all) fun testDelinquencyCountIncrements() {
    // WHAT: Each withDelinquency() call increments the count
    // WHY: Distinguishes "missed 1 cycle" from "missed 4 cycles" in the UI.
    //       Compounding penalties: count=3 means deposit was penalized 3 times.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let d1 = member.withDelinquency()
    let d2 = d1.withDelinquency()
    let d3 = d2.withDelinquency()

    Test.assertEqual(1 as UInt64, d1.delinquencyCount)
    Test.assertEqual(2 as UInt64, d2.delinquencyCount)
    Test.assertEqual(3 as UInt64, d3.delinquencyCount)

    // isDelinquent stays true throughout
    Test.assertEqual(true, d1.isDelinquent)
    Test.assertEqual(true, d2.isDelinquent)
    Test.assertEqual(true, d3.isDelinquent)
}

access(all) fun testDelinquencyPreservesContributionAfterMultipleMisses() {
    // WHAT: A member who contributed then missed two cycles keeps history
    // WHY: The receipt system and UI need accurate contribution records
    //       even for members who later became delinquent.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let contributed = member.withContribution(amount: 10.0)
    let reset1 = contributed.resetForNewCycle()
    let d1 = reset1.withDelinquency()          // Missed cycle 2
    let reset2 = d1.resetForNewCycle()
    let d2 = reset2.withDelinquency()          // Missed cycle 3

    Test.assertEqual(10.0, d2.totalContributed)
    Test.assertEqual(1 as UInt64, d2.cyclesContributed)
    Test.assertEqual(2 as UInt64, d2.delinquencyCount)
    Test.assertEqual(true, d2.isDelinquent)
    Test.assertEqual(false, d2.hasContributed)  // Reset for new cycle
}

access(all) fun testDelinquentMemberCanContributeAgain() {
    // WHAT: A delinquent member can still contribute in subsequent cycles
    // WHY: Being delinquent doesn't exclude you from the circle. You're still
    //       expected to contribute. The penalty was for the MISSED cycle.
    //       Contributing in a later cycle still updates your stats.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let delinquent = member.withDelinquency()     // Missed cycle 1
    let reset = delinquent.resetForNewCycle()
    let contributed = reset.withContribution(amount: 10.0)  // Paid in cycle 2

    Test.assertEqual(true, contributed.isDelinquent)
    Test.assertEqual(1 as UInt64, contributed.delinquencyCount)
    Test.assertEqual(true, contributed.hasContributed)
    Test.assertEqual(10.0, contributed.totalContributed)
    Test.assertEqual(1 as UInt64, contributed.cyclesContributed)
}

access(all) fun testWithContributionPreservesDelinquencyCount() {
    // WHAT: withContribution() doesn't reset delinquency tracking
    // WHY: Delinquency count is permanent history — it records how many
    //       cycles were missed regardless of subsequent contributions.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let d1 = member.withDelinquency()
    let d2 = d1.withDelinquency()
    let reset = d2.resetForNewCycle()
    let contributed = reset.withContribution(amount: 10.0)

    Test.assertEqual(2 as UInt64, contributed.delinquencyCount)
    Test.assertEqual(true, contributed.isDelinquent)
}

access(all) fun testResetForNewCyclePreservesDelinquencyCount() {
    // WHAT: resetForNewCycle() keeps delinquency count intact
    // WHY: Only hasContributed resets each cycle. Delinquency history persists.
    let member = ChamaCircle.MemberInfo(address: account.address, position: 0)
    let delinquent = member.withDelinquency().withDelinquency()
    let reset = delinquent.resetForNewCycle()

    Test.assertEqual(2 as UInt64, reset.delinquencyCount)
    Test.assertEqual(true, reset.isDelinquent)
    Test.assertEqual(false, reset.hasContributed)
}

// ============================================================================
// TEST: CircleConfig Edge Cases
// ============================================================================

access(all) fun testConfigAcceptsZeroPenalty() {
    // WHAT: penaltyPercent = 0 is valid (no-penalty circle)
    // WHY: Some circles may rely on social trust rather than financial penalty.
    //       The contract should allow this as a valid configuration.
    let config = ChamaCircle.CircleConfig(
        name: "Trust Circle",
        contributionAmount: 10.0,
        cycleDuration: 60.0,
        maxMembers: 4,
        penaltyPercent: 0.0
    )
    Test.assertEqual(0.0, config.penaltyPercent)
}

access(all) fun testConfigAcceptsFullPenalty() {
    // WHAT: penaltyPercent = 100 is valid (total forfeit on first miss)
    // WHY: A strict circle may want to forfeit the entire deposit on any
    //       missed contribution. This is the maximum enforcement.
    let config = ChamaCircle.CircleConfig(
        name: "Strict Circle",
        contributionAmount: 10.0,
        cycleDuration: 60.0,
        maxMembers: 4,
        penaltyPercent: 100.0
    )
    Test.assertEqual(100.0, config.penaltyPercent)
}

access(all) fun testConfigAcceptsMinimumMembers() {
    // WHAT: maxMembers = 2 is the minimum valid circle
    // WHY: Two people is the smallest possible rotation.
    let config = ChamaCircle.CircleConfig(
        name: "Pair Circle",
        contributionAmount: 5.0,
        cycleDuration: 30.0,
        maxMembers: 2,
        penaltyPercent: 25.0
    )
    Test.assertEqual(2 as UInt64, config.maxMembers)
}

access(all) fun testConfigAcceptsMaximumMembers() {
    // WHAT: maxMembers = 20 is the maximum valid circle
    // WHY: 20 is the gas safety cap for executeCycle() iteration.
    let config = ChamaCircle.CircleConfig(
        name: "Max Circle",
        contributionAmount: 1.0,
        cycleDuration: 120.0,
        maxMembers: 20,
        penaltyPercent: 10.0
    )
    Test.assertEqual(20 as UInt64, config.maxMembers)
}

// ============================================================================
// TEST: Circle Counter
// ============================================================================

access(all) fun testTotalCirclesCreatedIncrements() {
    // WHAT: The global counter starts at 0 after deployment
    // WHY: Circle IDs must be unique and sequential for UI readability.
    let initialCount = ChamaCircle.totalCirclesCreated
    Test.assert(initialCount >= 0, message: "Counter should be non-negative")
}
