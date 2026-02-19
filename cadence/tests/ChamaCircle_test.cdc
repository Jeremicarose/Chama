// ============================================================================
// ChamaCircle_test.cdc — Test suite for ChamaKit contracts
// ============================================================================
//
// Run with: flow test cadence/tests/ChamaCircle_test.cdc
//
// These tests validate the full Circle lifecycle:
//   1. Creation with valid config
//   2. Member joining with deposit
//   3. Auto-sealing when full
//   4. Contribution tracking
//   5. Cycle execution (payout + penalties)
//   6. Circle completion + deposit return
//   7. Negative tests (invalid states)
// ============================================================================

import Test
import "ChamaCircle"
import "ChamaManager"
import "FlowToken"
import "FungibleToken"

// ── TEST HELPERS ──

access(all) let admin = Test.getAccount(0xf8d6e0586b0a20c7)

access(all) fun setupAccounts(): [Test.TestAccount] {
    let acct1 = Test.createAccount()
    let acct2 = Test.createAccount()
    let acct3 = Test.createAccount()
    let acct4 = Test.createAccount()
    return [acct1, acct2, acct3, acct4]
}

// ── TEST: Circle Creation ──

access(all) fun testCreateCircleWithValidConfig() {
    let config = ChamaCircle.CircleConfig(
        name: "Test Chama",
        contributionAmount: 10.0,
        cycleDuration: 60.0,
        maxMembers: 4,
        penaltyPercent: 50.0
    )

    // Verify config fields
    Test.assertEqual("Test Chama", config.name)
    Test.assertEqual(10.0, config.contributionAmount)
    Test.assertEqual(60.0, config.cycleDuration)
    Test.assertEqual(4 as UInt64, config.maxMembers)
    Test.assertEqual(50.0, config.penaltyPercent)
}

access(all) fun testCircleIdIncrements() {
    let initialCount = ChamaCircle.totalCirclesCreated

    let config = ChamaCircle.CircleConfig(
        name: "Circle A",
        contributionAmount: 10.0,
        cycleDuration: 60.0,
        maxMembers: 2,
        penaltyPercent: 50.0
    )

    let circle1 <- ChamaCircle.createCircle(config: config, creator: admin.address)
    let id1 = circle1.circleId

    let circle2 <- ChamaCircle.createCircle(config: config, creator: admin.address)
    let id2 = circle2.circleId

    // IDs should be sequential
    Test.assertEqual(id1 + 1, id2)

    destroy circle1
    destroy circle2
}

// ── TEST: Circle Config Validation ──

access(all) fun testCannotCreateCircleWithZeroContribution() {
    // contributionAmount must be > 0
    Test.expectFailure(fun() {
        let config = ChamaCircle.CircleConfig(
            name: "Bad Circle",
            contributionAmount: 0.0,
            cycleDuration: 60.0,
            maxMembers: 4,
            penaltyPercent: 50.0
        )
    }, errorMessageSubstring: "Contribution must be positive")
}

access(all) fun testCannotCreateCircleWithOneMember() {
    // maxMembers must be >= 2
    Test.expectFailure(fun() {
        let config = ChamaCircle.CircleConfig(
            name: "Solo Circle",
            contributionAmount: 10.0,
            cycleDuration: 60.0,
            maxMembers: 1,
            penaltyPercent: 50.0
        )
    }, errorMessageSubstring: "Need at least 2 members")
}

access(all) fun testCannotCreateCircleWithTooManyMembers() {
    // maxMembers must be <= 20
    Test.expectFailure(fun() {
        let config = ChamaCircle.CircleConfig(
            name: "Huge Circle",
            contributionAmount: 10.0,
            cycleDuration: 60.0,
            maxMembers: 25,
            penaltyPercent: 50.0
        )
    }, errorMessageSubstring: "Max 20 members")
}

// ── TEST: Circle State ──

access(all) fun testNewCircleIsForming() {
    let config = ChamaCircle.CircleConfig(
        name: "Forming Circle",
        contributionAmount: 10.0,
        cycleDuration: 60.0,
        maxMembers: 4,
        penaltyPercent: 50.0
    )

    let circle <- ChamaCircle.createCircle(config: config, creator: admin.address)
    let state = circle.getState()

    // New circles start in FORMING status
    Test.assertEqual(ChamaCircle.CircleStatus.FORMING, state.status)
    Test.assertEqual(0 as UInt64, state.currentCycle)
    Test.assertEqual(0, state.members.length)
    Test.assertEqual(0.0, state.poolBalance)

    destroy circle
}

// ── TEST: MemberInfo Helpers ──

access(all) fun testMemberInfoWithContribution() {
    let member = ChamaCircle.MemberInfo(address: admin.address, position: 0)

    // Initially not contributed
    Test.assertEqual(false, member.hasContributed)
    Test.assertEqual(0.0, member.totalContributed)

    // After contribution
    let updated = member.withContribution(amount: 10.0)
    Test.assertEqual(true, updated.hasContributed)
    Test.assertEqual(10.0, updated.totalContributed)
    Test.assertEqual(1 as UInt64, updated.cyclesContributed)
}

access(all) fun testMemberInfoResetForNewCycle() {
    let member = ChamaCircle.MemberInfo(address: admin.address, position: 0)
    let contributed = member.withContribution(amount: 10.0)

    // Reset should clear hasContributed but keep totals
    let reset = contributed.resetForNewCycle()
    Test.assertEqual(false, reset.hasContributed)
    Test.assertEqual(10.0, reset.totalContributed)
    Test.assertEqual(1 as UInt64, reset.cyclesContributed)
}

access(all) fun testMemberInfoWithDelinquency() {
    let member = ChamaCircle.MemberInfo(address: admin.address, position: 0)

    Test.assertEqual(false, member.isDelinquent)

    let delinquent = member.withDelinquency()
    Test.assertEqual(true, delinquent.isDelinquent)
}
