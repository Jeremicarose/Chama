// ============================================================================
// ChamaCircle.cdc — Core Contract for the Chama Rotating Savings Protocol
// ============================================================================
//
// PURPOSE:
//   Defines the Circle resource — a self-contained savings circle that manages
//   its own lifecycle: member enrollment, contribution collection, cycle
//   execution (payout + penalty), and deposit return on completion.
//
// WHY A RESOURCE (not a contract-level mapping)?
//   In Solidity, you'd store all circles in a single contract using
//   mapping(uint => Circle). This creates a shared attack surface: a bug in
//   one circle's logic can affect another's funds.
//
//   In Cadence, each Circle is a RESOURCE with its own FlowToken Vault.
//   Resources have linear type semantics — they can't be copied, must be
//   explicitly moved (<-), and must be destroyed or stored. This means:
//   - Each circle's funds are physically isolated
//   - The host account pays storage costs (and retains custody semantics)
//   - Access is controlled via capabilities, not msg.sender checks
//
// ARCHITECTURE:
//   ChamaCircle.cdc (this file) — Circle resource + lifecycle logic
//   ChamaScheduler.cdc — TransactionHandler that calls executeCycle()
//   ChamaManager.cdc — Registry for circle discovery
// ============================================================================

import FungibleToken from "FungibleToken"
import FlowToken from "FlowToken"

access(all) contract ChamaCircle {

    // ========================================================================
    // EVENTS
    // ========================================================================
    // Events are the primary way the frontend learns about state changes.
    // The React app subscribes via @onflow/fcl event polling.
    // Each event carries enough data to update the UI without re-querying.

    access(all) event CircleCreated(circleId: UInt64, name: String, memberCount: Int, contributionAmount: UFix64)
    access(all) event MemberJoined(circleId: UInt64, member: Address)
    access(all) event CircleSealed(circleId: UInt64)
    access(all) event ContributionReceived(circleId: UInt64, member: Address, amount: UFix64, cycle: UInt64)
    access(all) event PayoutExecuted(circleId: UInt64, recipient: Address, amount: UFix64, cycle: UInt64)
    access(all) event MemberPenalized(circleId: UInt64, member: Address, cycle: UInt64)
    access(all) event CycleAdvanced(circleId: UInt64, newCycle: UInt64, nextDeadline: UFix64)
    access(all) event CircleCompleted(circleId: UInt64)
    access(all) event ReceiptCIDStored(circleId: UInt64, cycle: UInt64, cid: String)

    // ========================================================================
    // CONTRACT STATE
    // ========================================================================

    // Sequential counter for circle IDs.
    // Why not UUID? Circle IDs appear in UI and events — sequential integers
    // are easier to read, debug, and communicate ("Circle #7" vs "Circle 0xa3f...").
    // Thread-safety isn't a concern: Cadence guarantees atomic per-transaction execution.
    access(all) var totalCirclesCreated: UInt64

    // ========================================================================
    // ENUMS
    // ========================================================================

    // Circle lifecycle: FORMING → ACTIVE → COMPLETED (or CANCELLED)
    // Only FORMING accepts new members. Only ACTIVE accepts contributions.
    // Transitions are one-way (no going back to FORMING from ACTIVE).
    access(all) enum CircleStatus: UInt8 {
        access(all) case FORMING     // Accepting members, waiting to fill
        access(all) case ACTIVE      // All members joined, cycles running
        access(all) case COMPLETED   // All N cycles finished, deposits returned
        access(all) case CANCELLED   // Emergency cancellation
    }

    // ========================================================================
    // STRUCTS
    // ========================================================================

    // MemberInfo tracks per-member state within a circle.
    //
    // WHY A STRUCT (not a resource)?
    //   Members don't "own" their membership in the Cadence resource sense.
    //   The Circle resource owns all member data. Structs are value types —
    //   they can be freely copied and replaced, which is exactly what we need
    //   when updating hasContributed each cycle.
    //
    // CADENCE QUIRK: Structs are immutable after creation in dictionaries.
    //   You can't do `self.members[addr]!.hasContributed = true`.
    //   Instead, you create a NEW struct with the updated value and replace
    //   the old one in the dictionary. This is the standard Cadence pattern.
    access(all) struct MemberInfo {
        access(all) let address: Address
        access(all) var hasContributed: Bool
        access(all) var totalContributed: UFix64
        access(all) var cyclesContributed: UInt64
        access(all) var isDelinquent: Bool
        access(all) let rotationPosition: UInt64

        init(address: Address, position: UInt64) {
            self.address = address
            self.hasContributed = false
            self.totalContributed = 0.0
            self.cyclesContributed = 0
            self.isDelinquent = false
            self.rotationPosition = position
        }

        // Helper to create an updated copy with contribution recorded.
        // This is the "create new, replace" pattern for struct mutation.
        access(all) fun withContribution(amount: UFix64): MemberInfo {
            let updated = MemberInfo(address: self.address, position: self.rotationPosition)
            updated.hasContributed = true
            updated.totalContributed = self.totalContributed + amount
            updated.cyclesContributed = self.cyclesContributed + 1
            updated.isDelinquent = self.isDelinquent
            return updated
        }

        // Helper to reset contribution flag for the next cycle
        access(all) fun resetForNewCycle(): MemberInfo {
            let updated = MemberInfo(address: self.address, position: self.rotationPosition)
            updated.hasContributed = false
            updated.totalContributed = self.totalContributed
            updated.cyclesContributed = self.cyclesContributed
            updated.isDelinquent = self.isDelinquent
            return updated
        }

        // Helper to mark as delinquent
        access(all) fun withDelinquency(): MemberInfo {
            let updated = MemberInfo(address: self.address, position: self.rotationPosition)
            updated.hasContributed = self.hasContributed
            updated.totalContributed = self.totalContributed
            updated.cyclesContributed = self.cyclesContributed
            updated.isDelinquent = true
            return updated
        }
    }

    // CircleConfig is immutable after creation — the rules of the circle
    // are locked at creation time. No one (not even the creator) can change
    // the contribution amount or penalty percentage mid-game.
    access(all) struct CircleConfig {
        access(all) let name: String
        access(all) let contributionAmount: UFix64   // e.g., 10.0 FLOW per cycle
        access(all) let cycleDuration: UFix64         // seconds between payouts
        access(all) let maxMembers: UInt64             // circle size (= number of cycles)
        access(all) let penaltyPercent: UFix64         // % of deposit forfeited on delinquency

        init(
            name: String,
            contributionAmount: UFix64,
            cycleDuration: UFix64,
            maxMembers: UInt64,
            penaltyPercent: UFix64
        ) {
            // Pre-conditions enforce invariants at construction time.
            // If any fail, the entire transaction reverts.
            pre {
                contributionAmount > 0.0: "Contribution must be positive"
                cycleDuration > 0.0: "Cycle duration must be positive"
                maxMembers >= 2: "Need at least 2 members for a circle"
                maxMembers <= 20: "Max 20 members per circle (prevents gas issues)"
                penaltyPercent >= 0.0 && penaltyPercent <= 100.0: "Penalty must be 0-100%"
            }
            self.name = name
            self.contributionAmount = contributionAmount
            self.cycleDuration = cycleDuration
            self.maxMembers = maxMembers
            self.penaltyPercent = penaltyPercent
        }
    }

    // CircleState is a read-only snapshot for frontend queries.
    // Scripts call circle.getState() and receive this struct —
    // it contains everything the UI needs to render.
    access(all) struct CircleState {
        access(all) let circleId: UInt64
        access(all) let config: CircleConfig
        access(all) let status: CircleStatus
        access(all) let currentCycle: UInt64
        access(all) let members: [MemberInfo]
        access(all) let poolBalance: UFix64
        access(all) let nextDeadline: UFix64
        access(all) let nextRecipient: Address?
        access(all) let latestReceiptCID: String

        init(
            circleId: UInt64,
            config: CircleConfig,
            status: CircleStatus,
            currentCycle: UInt64,
            members: [MemberInfo],
            poolBalance: UFix64,
            nextDeadline: UFix64,
            nextRecipient: Address?,
            latestReceiptCID: String
        ) {
            self.circleId = circleId
            self.config = config
            self.status = status
            self.currentCycle = currentCycle
            self.members = members
            self.poolBalance = poolBalance
            self.nextDeadline = nextDeadline
            self.nextRecipient = nextRecipient
            self.latestReceiptCID = latestReceiptCID
        }
    }

    // ========================================================================
    // CIRCLE RESOURCE — The heart of ChamaKit
    // ========================================================================
    //
    // Each Circle is a standalone resource containing:
    //   - Its own FlowToken Vault (contribution pool)
    //   - A dictionary of security deposit Vaults (one per member)
    //   - Full lifecycle state (members, cycles, deadlines)
    //
    // Access levels explained:
    //   access(all) — anyone with a reference can call (read functions)
    //   access(contract) — only this contract's code can call (executeCycle, penalties)
    //   access(self) — only this resource's own methods (vault, deposits)
    //
    // WHY access(contract) for executeCycle?
    //   We want ChamaScheduler (another contract) to trigger cycle execution,
    //   but ChamaScheduler calls via a reference that this contract provides.
    //   Actually, the scheduler borrows the Circle from storage directly.
    //   Making executeCycle access(contract) means only code within ChamaCircle.cdc
    //   can call it — the scheduler accesses it through the public function
    //   advanceCycle() which we expose below.
    // ========================================================================

    access(all) resource Circle {
        access(all) let circleId: UInt64
        access(all) let config: CircleConfig

        access(contract) var status: CircleStatus
        access(contract) var currentCycle: UInt64
        access(contract) var members: {Address: MemberInfo}
        access(contract) var memberOrder: [Address]   // rotation order (index = payout position)
        access(contract) var nextDeadline: UFix64
        access(contract) var latestReceiptCID: String

        // The Vault holding all contributed funds for the current cycle.
        // access(self) means ONLY this resource's methods can touch it.
        // Not even other code in ChamaCircle.cdc contract can access it directly.
        access(self) let vault: @FlowToken.Vault

        // Security deposits: one Vault per member, held as collateral.
        // On delinquency, a percentage is forfeited into the contribution vault.
        // On circle completion, remaining deposits are returned.
        access(self) let deposits: @{Address: FlowToken.Vault}

        init(circleId: UInt64, config: CircleConfig, creator: Address) {
            self.circleId = circleId
            self.config = config
            self.status = CircleStatus.FORMING
            self.currentCycle = 0
            self.members = {}
            self.memberOrder = []
            self.nextDeadline = 0.0
            self.latestReceiptCID = ""

            // Create an empty vault to hold contributions.
            // FlowToken.createEmptyVault() returns a @{FungibleToken.Vault},
            // so we force-cast it to @FlowToken.Vault for type specificity.
            self.vault <- FlowToken.createEmptyVault(vaultType: Type<@FlowToken.Vault>())
                as! @FlowToken.Vault

            // Empty dictionary to hold per-member deposit vaults.
            self.deposits <- {}
        }

        // ────────────────────────────────────────────────────────────────
        // MEMBERSHIP
        // ────────────────────────────────────────────────────────────────

        /// Join the circle with a security deposit.
        ///
        /// The deposit acts as collateral: if you skip a contribution,
        /// a percentage is forfeited. This eliminates the "contribute early,
        /// receive payout, then ghost" exploit common in blockchain ROSCAs.
        ///
        /// deposit.balance must be >= contributionAmount. The deposit is
        /// locked for the entire circle duration.
        access(all) fun join(member: Address, deposit: @FlowToken.Vault) {
            pre {
                self.status == CircleStatus.FORMING:
                    "Circle is not accepting members (status: ".concat(self.status.rawValue.toString()).concat(")")
                self.members[member] == nil:
                    "Address already a member of this circle"
                UInt64(self.memberOrder.length) < self.config.maxMembers:
                    "Circle is full (".concat(self.config.maxMembers.toString()).concat(" members max)")
                deposit.balance >= self.config.contributionAmount:
                    "Deposit must be at least ".concat(self.config.contributionAmount.toString()).concat(" FLOW")
            }

            // Assign rotation position based on join order.
            // Position 0 receives payout in cycle 1, position 1 in cycle 2, etc.
            let position = UInt64(self.memberOrder.length)
            self.members[member] = MemberInfo(address: member, position: position)
            self.memberOrder.append(member)

            // Store the security deposit vault.
            // The `<- deposit` moves ownership from the caller to our deposits dict.
            // `oldDeposit` captures whatever was previously at that key (should be nil).
            let oldDeposit <- self.deposits[member] <- deposit
            destroy oldDeposit

            emit MemberJoined(circleId: self.circleId, member: member)

            // Auto-seal when the circle reaches maxMembers.
            // This triggers the first cycle — no manual "start" needed.
            if UInt64(self.memberOrder.length) == self.config.maxMembers {
                self.seal()
            }
        }

        /// Seal the circle: transition from FORMING → ACTIVE.
        /// Called automatically when the last member joins.
        /// Sets up cycle 1 and calculates the first deadline.
        access(contract) fun seal() {
            self.status = CircleStatus.ACTIVE
            self.currentCycle = 1

            // Deadline = current block timestamp + configured cycle duration.
            // On emulator with --block-time 1s, timestamps advance ~1s per block.
            // For the demo: cycleDuration = 60.0 means payout fires ~60s after sealing.
            self.nextDeadline = getCurrentBlock().timestamp + self.config.cycleDuration

            emit CircleSealed(circleId: self.circleId)
        }

        // ────────────────────────────────────────────────────────────────
        // CONTRIBUTIONS
        // ────────────────────────────────────────────────────────────────

        /// Contribute to the current cycle.
        ///
        /// Each member must call this once per cycle before the deadline.
        /// The payment Vault is consumed (moved into the circle's pool vault).
        /// If a member doesn't contribute before the scheduled tx fires,
        /// they're automatically penalized.
        access(all) fun contribute(member: Address, payment: @FlowToken.Vault) {
            pre {
                self.status == CircleStatus.ACTIVE:
                    "Circle is not active"
                self.members[member] != nil:
                    "Not a member of this circle"
                !(self.members[member]!.hasContributed):
                    "Already contributed this cycle"
                payment.balance >= self.config.contributionAmount:
                    "Insufficient contribution: need ".concat(self.config.contributionAmount.toString())
                    .concat(" FLOW, got ").concat(payment.balance.toString())
            }

            // Move funds from the payment vault into the circle's pool vault.
            // After this line, `payment` is empty and will be destroyed.
            self.vault.deposit(from: <- payment)

            // Update member state using the "create new, replace" pattern.
            // We can't mutate structs in-place within dictionaries in Cadence.
            if let memberInfo = self.members[member] {
                self.members[member] = memberInfo.withContribution(
                    amount: self.config.contributionAmount
                )
            }

            emit ContributionReceived(
                circleId: self.circleId,
                member: member,
                amount: self.config.contributionAmount,
                cycle: self.currentCycle
            )
        }

        // ────────────────────────────────────────────────────────────────
        // CYCLE EXECUTION — Called by ChamaScheduler at the deadline
        // ────────────────────────────────────────────────────────────────

        /// Execute the current cycle's payout logic.
        ///
        /// This is the function that makes Chama trustless. It runs
        /// INSIDE a scheduled transaction — no human calls it.
        /// The Flow protocol's execution engine fires it at the deadline.
        ///
        /// Steps:
        ///   1. Identify members who didn't contribute → penalize them
        ///   2. Determine this cycle's recipient (by rotation position)
        ///   3. Transfer the entire pool to the recipient
        ///   4. Reset contribution flags for the next cycle
        ///   5. Advance the cycle counter (or complete the circle)
        ///
        /// access(all) because ChamaScheduler needs to call this via a borrowed
        /// reference. The scheduled tx handler borrows the Circle from storage
        /// and calls executeCycle(). We rely on the fact that only the account
        /// that stores the Circle can borrow it with write access.
        access(all) fun executeCycle() {
            pre {
                self.status == CircleStatus.ACTIVE: "Circle is not active"
            }

            // ── Step 1: Penalize delinquent members ──
            // Anyone who hasn't contributed AND isn't already delinquent gets penalized.
            // Penalty = percentage of their security deposit → goes into the pool.
            for addr in self.memberOrder {
                if let memberInfo = self.members[addr] {
                    if !memberInfo.hasContributed && !memberInfo.isDelinquent {
                        self.penalizeMember(member: addr)
                    }
                }
            }

            // ── Step 2: Determine recipient by rotation ──
            // Cycle 1 → position 0, Cycle 2 → position 1, etc.
            // Modulo handles edge cases but shouldn't be needed (cycles = members).
            let recipientIndex = (self.currentCycle - 1) % UInt64(self.memberOrder.length)
            let recipient = self.memberOrder[recipientIndex]

            // ── Step 3: Transfer entire pool to recipient ──
            let payoutAmount = self.vault.balance
            if payoutAmount > 0.0 {
                let payout <- self.vault.withdraw(amount: payoutAmount)

                // Borrow the recipient's public FlowToken receiver capability.
                // Every Flow account has this by default — it's how you receive FLOW.
                let receiverRef = getAccount(recipient)
                    .capabilities.get<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
                    .borrow()
                    ?? panic("Could not borrow receiver for recipient ".concat(recipient.toString()))

                receiverRef.deposit(from: <- payout)

                emit PayoutExecuted(
                    circleId: self.circleId,
                    recipient: recipient,
                    amount: payoutAmount,
                    cycle: self.currentCycle
                )
            }

            // ── Step 4: Reset contribution flags ──
            for addr in self.memberOrder {
                if let memberInfo = self.members[addr] {
                    self.members[addr] = memberInfo.resetForNewCycle()
                }
            }

            // ── Step 5: Advance or complete ──
            // If we've completed N cycles (one per member), the circle is done.
            // Otherwise, bump the cycle and set the next deadline.
            if self.currentCycle >= UInt64(self.memberOrder.length) {
                self.status = CircleStatus.COMPLETED
                emit CircleCompleted(circleId: self.circleId)
                self.returnDeposits()
            } else {
                self.currentCycle = self.currentCycle + 1
                self.nextDeadline = getCurrentBlock().timestamp + self.config.cycleDuration
                emit CycleAdvanced(
                    circleId: self.circleId,
                    newCycle: self.currentCycle,
                    nextDeadline: self.nextDeadline
                )
            }
        }

        // ────────────────────────────────────────────────────────────────
        // PENALTIES
        // ────────────────────────────────────────────────────────────────

        /// Penalize a member for not contributing by the deadline.
        ///
        /// Forfeits penaltyPercent of their security deposit into the pool.
        /// This is the enforcement mechanism that replaces social pressure.
        /// The penalty benefits other members by increasing the pool size.
        access(self) fun penalizeMember(member: Address) {
            // Remove the member's deposit vault from storage
            if let deposit <- self.deposits[member] <- nil {
                let penaltyAmount = deposit.balance * (self.config.penaltyPercent / 100.0)

                if penaltyAmount > 0.0 && penaltyAmount <= deposit.balance {
                    let penalty <- deposit.withdraw(amount: penaltyAmount)
                    // Penalty goes into the contribution pool → benefits recipients
                    self.vault.deposit(from: <- penalty)
                }

                // Return the remaining deposit to storage (reduced by penalty)
                let oldDeposit <- self.deposits[member] <- deposit
                destroy oldDeposit
            }

            // Mark member as delinquent (permanent for this circle)
            if let memberInfo = self.members[member] {
                self.members[member] = memberInfo.withDelinquency()
            }

            emit MemberPenalized(
                circleId: self.circleId,
                member: member,
                cycle: self.currentCycle
            )
        }

        // ────────────────────────────────────────────────────────────────
        // DEPOSIT RETURN
        // ────────────────────────────────────────────────────────────────

        /// Return security deposits to all non-delinquent members.
        /// Called when the circle completes (all cycles finished).
        /// Delinquent members have already had their deposits reduced.
        access(self) fun returnDeposits() {
            for addr in self.memberOrder {
                if let memberInfo = self.members[addr] {
                    if !memberInfo.isDelinquent {
                        if let deposit <- self.deposits[addr] <- nil {
                            if deposit.balance > 0.0 {
                                let receiverRef = getAccount(addr)
                                    .capabilities.get<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
                                    .borrow()

                                if let receiver = receiverRef {
                                    receiver.deposit(from: <- deposit)
                                } else {
                                    // Can't return — store back for manual retrieval
                                    let old <- self.deposits[addr] <- deposit
                                    destroy old
                                }
                            } else {
                                destroy deposit
                            }
                        }
                    }
                }
            }
        }

        // ────────────────────────────────────────────────────────────────
        // RECEIPT CID STORAGE — Storacha integration
        // ────────────────────────────────────────────────────────────────

        /// Store the latest IPFS receipt CID on-chain.
        ///
        /// After each event (contribution, payout, penalty), the frontend
        /// uploads a JSON receipt to Storacha and stores the returned CID
        /// here. This creates an on-chain anchor for the off-chain audit trail.
        access(all) fun storeReceiptCID(cid: String) {
            self.latestReceiptCID = cid
            emit ReceiptCIDStored(
                circleId: self.circleId,
                cycle: self.currentCycle,
                cid: cid
            )
        }

        // ────────────────────────────────────────────────────────────────
        // READ FUNCTIONS — Used by frontend scripts
        // ────────────────────────────────────────────────────────────────

        /// Get a complete snapshot of the circle's current state.
        /// This is what the frontend's useCircle() hook calls via a Cadence script.
        access(all) fun getState(): CircleState {
            let memberList: [MemberInfo] = []
            for addr in self.memberOrder {
                if let info = self.members[addr] {
                    memberList.append(info)
                }
            }

            // Determine who receives the payout this cycle
            var nextRecipient: Address? = nil
            if self.status == CircleStatus.ACTIVE && self.memberOrder.length > 0 {
                let recipientIndex = (self.currentCycle - 1) % UInt64(self.memberOrder.length)
                nextRecipient = self.memberOrder[recipientIndex]
            }

            return CircleState(
                circleId: self.circleId,
                config: self.config,
                status: self.status,
                currentCycle: self.currentCycle,
                members: memberList,
                poolBalance: self.vault.balance,
                nextDeadline: self.nextDeadline,
                nextRecipient: nextRecipient,
                latestReceiptCID: self.latestReceiptCID
            )
        }

        access(all) fun isMember(address: Address): Bool {
            return self.members[address] != nil
        }

        access(all) fun hasContributed(address: Address): Bool {
            if let info = self.members[address] {
                return info.hasContributed
            }
            return false
        }

        access(all) fun allContributed(): Bool {
            for addr in self.memberOrder {
                if let info = self.members[addr] {
                    if !info.hasContributed {
                        return false
                    }
                }
            }
            return true
        }
    }

    // ========================================================================
    // PUBLIC FACTORY FUNCTION
    // ========================================================================

    /// Create a new Circle resource.
    ///
    /// Returns the resource to the caller (a transaction), who must then
    /// store it in their account via `signer.storage.save(<- circle, to: path)`.
    /// This is the Cadence pattern: the contract creates resources,
    /// the caller decides where to put them.
    ///
    /// Why return the resource instead of storing it ourselves?
    ///   Cadence's resource model means the creator OWNS the circle.
    ///   They store it in their account's storage, and they issue capabilities
    ///   to let others interact with it. This is more secure than a contract
    ///   holding everyone's circles.
    access(all) fun createCircle(config: CircleConfig, creator: Address): @Circle {
        self.totalCirclesCreated = self.totalCirclesCreated + 1
        let circle <- create Circle(
            circleId: self.totalCirclesCreated,
            config: config,
            creator: creator
        )
        emit CircleCreated(
            circleId: self.totalCirclesCreated,
            name: config.name,
            memberCount: Int(config.maxMembers),
            contributionAmount: config.contributionAmount
        )
        return <- circle
    }

    // ========================================================================
    // CONTRACT INITIALIZATION
    // ========================================================================

    init() {
        self.totalCirclesCreated = 0
    }
}
