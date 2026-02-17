# CHAMA — Complete Application Specification
### Trustless Rotating Savings Circles on Flow
**PL Genesis: Frontiers of Collaboration Hackathon**
**Builder:** Chizaa | **Track:** Fresh Code + Flow + Economic Systems
**Build Window:** February 10 – March 16, 2026 (5 weeks)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Deep-Dive](#2-problem-deep-dive)
3. [Solution Architecture](#3-solution-architecture)
4. [Smart Contract Design (Cadence)](#4-smart-contract-design)
5. [Scheduled Transaction Engine](#5-scheduled-transaction-engine)
6. [Storacha Receipt System](#6-storacha-receipt-system)
7. [Frontend Application](#7-frontend-application)
8. [Data Model](#8-data-model)
9. [User Flows](#9-user-flows)
10. [Demo Script](#10-demo-script)
11. [Testing Strategy](#11-testing-strategy)
12. [Build Schedule](#12-build-schedule)
13. [Submission Package](#13-submission-package)
14. [Risk Register](#14-risk-register)

---

## 1. Executive Summary

### What We're Building

**Chama** is two things delivered as one submission:

1. **ChamaKit** — A composable Cadence smart contract library (3 contracts) that any Flow developer can import to add rotating savings circle logic to their application. This is the *primitive* — the building block that makes the project valuable beyond a single hackathon.

2. **Chama App** — A reference web application (React + Next.js) that demonstrates ChamaKit in action: creating savings circles, contributing funds, and watching automated payouts fire without any human trigger.

### The Core Innovation

Every previous blockchain-based ROSCA (WeTrust on Ethereum, Bloinx, BlockCircle on Pharos, and our own CircleSync design on Celo) shares one fatal architectural flaw: someone must call the payout function. Whether it's a keeper bot, a cron job, or a coordinator clicking a button — there's always a human or server in the loop.

Flow's **Scheduled Transactions** (shipped with the Forte upgrade, October 2025) eliminate this for the first time at the protocol level. The blockchain itself triggers the payout at the predetermined time. No bots. No servers. No coordinator. The keeper problem is solved at the infrastructure layer.

**Chama is the first ROSCA implementation where the payout is architecturally trustless — not just "someone will probably trigger it," but "the protocol guarantees it fires."**

### Prize Targeting

| Track | Prize | Our Angle |
|---|---|---|
| Fresh Code | $5,000 (1 of 10) | Brand new Cadence codebase, no prior code |
| Flow: Future of Money | $1,000 (1 of 10) | Showcases Scheduled Tx + Flow Actions — Forte's flagship features |
| Upgrade Economies & Governance | $6,000 (tiered) | Track explicitly lists "savings circles" as example. Zero existing implementations |
| Founders Forge | Accelerator residency | ChamaKit fits the "primitive, not product" pattern of every Forge grad |
| **Total Potential** | **$12,000 + Residency** | |

### What Judges See

A 4-minute demo where:
- A savings circle is created with 4 members
- Members contribute FLOW tokens
- **A countdown hits zero and money moves between accounts with zero human intervention**
- A delinquent member is automatically penalized
- Every action has a verifiable receipt stored on IPFS via Storacha
- The ChamaKit library is shown as a 3-contract import any Flow dev can use

---

## 2. Problem Deep-Dive

### 2.1 What is a ROSCA?

A **Rotating Savings and Credit Association** (ROSCA) is the oldest financial structure on earth. A group of N people each contribute a fixed amount on a regular schedule. Each cycle, one member receives the entire pool. After N cycles, everyone has both contributed and received equally.

**Names by region:**
- Kenya: *Chama* (300M+ participants across Africa)
- Mexico: *Tanda*
- South Korea: *Gye*
- South Africa: *Stokvel*
- Nigeria: *Esusu/Ajo*
- India: *Chit Fund/Kitty Party*

**Scale:** 1 billion+ participants globally. In Kenya alone, chamas manage ~$4.7 billion annually (Kenya Financial Sector Deepening). The World Bank estimates ROSCAs collectively handle $50-100 billion in annual flows.

### 2.2 The Three Structural Failures

**Failure 1: Coordinator Risk (The Problem We Solve)**

Every ROSCA has a coordinator — the person who collects contributions, tracks who paid, and distributes the pool. This creates a single point of failure:

- **Fraud:** The coordinator absconds with the pot. Common enough to have a name in every language.
- **Incapacitation:** Coordinator gets sick, dies, or moves. The circle collapses.
- **Social pressure:** Coordinator's family members or friends pressure for early access.
- **Accounting errors:** Manual tracking via WhatsApp messages or paper ledgers leads to disputes.

Research from a 2023 World Development study documents coordinator default as the #1 risk in ROSCAs globally. A conservative estimate: 10-15% of groups experience treasurer-related fund loss over a 5-year period.

**Failure 2: Enforcement Gap**

When a member doesn't contribute on time, the only enforcement mechanism is social pressure. The coordinator must personally chase late payers. Over time, this social capital erodes, especially in groups that extend beyond close family.

There is no automated consequence for non-payment. No penalty is applied unless the coordinator manually intervenes. This means the system rewards free-riders and punishes the coordinator with emotional labor.

**Failure 3: Record Fragility**

Contribution histories exist as WhatsApp messages (deletable), paper ledgers (losable), or social memory (unreliable). When members relocate, groups dissolve, or disputes arise, there's no authoritative record. Members cannot prove their savings discipline to new groups, landlords, or financial institutions.

### 2.3 Why Previous Blockchain Solutions Failed

| Project | Chain | Year | Fatal Flaw |
|---|---|---|---|
| WeTrust | Ethereum | 2017 | Required keeper bot to trigger payouts. High gas fees ($5-50 per tx). UX required crypto literacy. |
| Bloinx (BX Smart Labs) | Ethereum | 2021 | Same keeper problem. Open-source but no sustained adoption. |
| ROSCAcoin | Custom | 2018 | Tried to create a new token instead of using existing infrastructure. Never reached production. |
| BlockCircle | Pharos | 2025 | Smart contract handles contribution/escrow but still needs `external` function call for payout execution. |
| Rotacash Finance | Polygon | 2023 | Added AI complexity and NFT collateral — solved wrong problem. Core ROSCA logic still centralized. |
| **CircleSync (our own design)** | **Celo** | **2026** | **`executePayout()` is `external` — requires someone to call it. WhatsApp bot acts as keeper. Still a human-in-the-loop architecture.** |

**The common pattern:** Every implementation digitizes the *rules* of a ROSCA into a smart contract, but none eliminates the *trigger*. The "who calls executePayout?" question is either unanswered or answered with "a server we operate" — which recreates the coordinator trust problem at a different layer.

### 2.4 Why Flow Solves This

Flow's **Scheduled Transactions** (FLIP 330, shipped in Forte upgrade October 2025) allow smart contracts to execute code at a future time without any external transaction. The blockchain's own execution engine fires the scheduled code when the timestamp is reached.

This means:
- **No keeper bots** — the network is the keeper
- **No external infrastructure** — no servers to maintain or trust
- **No coordinator** — the contract schedules its own next cycle
- **Guaranteed execution** — as reliable as block production itself

For ROSCAs specifically, this enables a self-advancing cycle where:
1. The contract checks contributions at the deadline
2. Penalizes delinquent members automatically
3. Transfers the pool to the current recipient
4. Schedules the *next* cycle's deadline
5. All without a single human action

**This capability did not exist on any blockchain before October 2025.** Chama is the first project to apply it to community savings.

---

## 3. Solution Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CHAMA APP                                   │
│                    (Next.js + React Frontend)                        │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ Create       │  │ Dashboard    │  │ Contribute │  │ History    │ │
│  │ Circle Page  │  │ (Status,     │  │ Page       │  │ & Receipts │ │
│  │              │  │  Countdown)  │  │            │  │ Page       │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  └─────┬──────┘ │
│         │                 │                │              │         │
│         └─────────────────┼────────────────┼──────────────┘         │
│                           │                │                         │
│                    ┌──────▼────────────────▼──────┐                  │
│                    │    @onflow/fcl + react-sdk   │                  │
│                    │    (Query, Mutate, Subscribe) │                  │
│                    └──────────────┬───────────────┘                  │
└───────────────────────────────────┼──────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        FLOW BLOCKCHAIN                                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                     CHAMAKIT LIBRARY                            │  │
│  │                  (3 Cadence Contracts)                          │  │
│  │                                                                 │  │
│  │  ┌──────────────────┐                                           │  │
│  │  │  ChamaCircle.cdc │ ← Core contract                          │  │
│  │  │                  │   - Circle lifecycle                      │  │
│  │  │  Resources:      │   - Contribution tracking                 │  │
│  │  │  - Circle        │   - Payout execution                      │  │
│  │  │  - Membership    │   - Penalty enforcement                   │  │
│  │  │  - Receipt       │   - Receipt generation                    │  │
│  │  └──────────────────┘                                           │  │
│  │                                                                 │  │
│  │  ┌──────────────────┐                                           │  │
│  │  │ ChamaScheduler   │ ← Scheduled Transaction handler          │  │
│  │  │ .cdc             │   - Implements TransactionHandler         │  │
│  │  │                  │   - Cycle deadline enforcement             │  │
│  │  │                  │   - Auto-payout trigger                    │  │
│  │  │                  │   - Self-scheduling next cycle             │  │
│  │  └──────────────────┘                                           │  │
│  │                                                                 │  │
│  │  ┌──────────────────┐                                           │  │
│  │  │ ChamaManager.cdc │ ← Discovery + registry                   │  │
│  │  │                  │   - Circle creation factory                │  │
│  │  │                  │   - Public circle listing                  │  │
│  │  │                  │   - Membership lookup                      │  │
│  │  └──────────────────┘                                           │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │              FlowTransactionScheduler (System Contract)         │  │
│  │                                                                 │  │
│  │  Cycle 1 Deadline ──▶ Cycle 2 Deadline ──▶ Cycle 3 Deadline    │  │
│  │  (auto-fires)         (auto-fires)         (auto-fires)        │  │
│  │                                                                 │  │
│  │  Each fires ChamaScheduler.executeTransaction() which:         │  │
│  │  1. Checks all contributions                                    │  │
│  │  2. Penalizes delinquent members                                │  │
│  │  3. Transfers pool to current recipient                         │  │
│  │  4. Schedules NEXT cycle deadline                               │  │
│  │  5. Emits events                                                │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │              FlowToken (System Contract)                        │  │
│  │              Used for contributions + payouts                   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ (Post-payout event triggers)
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     STORACHA (IPFS Hot Storage)                       │
│                                                                       │
│  Receipt JSON uploaded after each contribution + payout:              │
│  {                                                                    │
│    "circleId": "0x...",                                               │
│    "action": "contribution" | "payout" | "penalty",                   │
│    "member": "0x...",                                                 │
│    "amount": "10.0",                                                  │
│    "cycle": 1,                                                        │
│    "timestamp": "2026-02-20T14:00:00Z",                              │
│    "txHash": "abc123...",                                             │
│    "previousReceiptCID": "bafybeig..."                                │
│  }                                                                    │
│                                                                       │
│  Each receipt references the previous CID → verifiable chain          │
│  CID stored on-chain in ChamaCircle contract state                   │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Design Principles

**Principle 1: One Job, Done Completely**
Chama does one thing: rotating savings with automated payouts. No yield farming. No lending. No governance tokens. No AI. The scope boundary is enforced ruthlessly.

**Principle 2: The Library IS the Product**
The reference app proves ChamaKit works. But ChamaKit — the importable Cadence library — is what judges evaluate. Another developer should be able to `import ChamaCircle from 0xCHAMA` and have savings circle logic in 5 lines.

**Principle 3: Visible Sponsor Integration**
Flow's Scheduled Transactions are the hero of the demo. The countdown timer, the autonomous payout, the "no one clicked anything" moment — all make Flow's unique capability visible. Storacha receipts show verifiable IPFS CIDs in the UI with clickable links. No invisible backend integrations.

**Principle 4: Fail-Safe Defaults**
If anything goes wrong (scheduled tx doesn't fire, member disputes), funds stay locked in the contract. The system prefers stasis over incorrect execution. Members can always withdraw via group consensus (multi-sig emergency function).

### 3.3 What's In Scope vs. Out of Scope

| IN SCOPE (Hackathon Deliverable) | OUT OF SCOPE (Post-Hackathon / CircleSync Roadmap) |
|---|---|
| Cadence smart contracts (ChamaKit library) | WhatsApp bot integration |
| Scheduled Transaction automation | M-Pesa on/off-ramp |
| FLOW token contributions/payouts | Stablecoin (cUSD/USDC) support |
| Web-based reference app (React + Next.js) | Mobile-native app |
| Storacha receipt storage + verification | Account abstraction / walletless onboarding |
| Sequential rotation order | Bidding/auction payout mode |
| Fixed contribution amounts | Variable contribution tiers |
| Delinquency penalty (deposit forfeiture) | Graduated penalty system |
| Flow Emulator + Testnet deployment | Mainnet deployment |
| 4-member demo circle | 20-30 member production circles |
| Basic UI with status dashboard | Full admin dashboard with analytics |
| CID stored on-chain | ZK credit scoring from contribution history |

---

## 4. Smart Contract Design (Cadence)

### 4.1 Contract Architecture Overview

ChamaKit consists of three contracts that work together but can be used independently:

```
ChamaManager.cdc          ChamaCircle.cdc           ChamaScheduler.cdc
┌──────────────┐          ┌──────────────┐          ┌──────────────────┐
│ Registry of  │ creates  │ Single       │ uses     │ Implements       │
│ all circles  │────────▶ │ circle       │────────▶ │ TransactionHandler│
│              │          │ instance     │          │ interface        │
│ createCircle()│         │              │          │                  │
│ getCircles() │          │ contribute() │          │ executeTransaction()│
│ findByMember()│         │ getStatus()  │          │ (auto-fires      │
│              │          │ getMembers() │          │  at deadline)    │
└──────────────┘          │ forceExit()  │          └──────────────────┘
                          └──────────────┘
```

### 4.2 ChamaCircle.cdc — Core Contract

This is the heart of ChamaKit. It defines the `Circle` resource that manages a single savings circle's complete lifecycle.

**Resource Model (Why Resources, Not Mappings):**

In Solidity (CircleSync's design), circle data lives in contract storage as mappings. Anyone with the contract address can call functions. Access control is managed via `require(msg.sender == ...)` checks.

In Cadence, the `Circle` is a **resource** — it has physical location semantics. It's stored in an account, it can't be duplicated, and access is controlled via **capabilities**. This is architecturally superior for savings circles because:
- Each circle is a self-contained resource with its own state
- Members interact via capabilities (like having a key to the circle)
- The circle resource can't be accidentally duplicated or lost
- Entitlements control who can contribute vs. who can trigger admin actions

**Contract Structure:**

```cadence
// ChamaCircle.cdc
// Core contract for the Chama rotating savings circle protocol

import FungibleToken from "FungibleToken"
import FlowToken from "FlowToken"

access(all) contract ChamaCircle {

    // ============================================================
    // EVENTS
    // ============================================================
    access(all) event CircleCreated(circleId: UInt64, name: String, memberCount: Int, contributionAmount: UFix64)
    access(all) event MemberJoined(circleId: UInt64, member: Address)
    access(all) event CircleSealed(circleId: UInt64)
    access(all) event ContributionReceived(circleId: UInt64, member: Address, amount: UFix64, cycle: UInt64)
    access(all) event PayoutExecuted(circleId: UInt64, recipient: Address, amount: UFix64, cycle: UInt64)
    access(all) event MemberPenalized(circleId: UInt64, member: Address, cycle: UInt64)
    access(all) event CycleAdvanced(circleId: UInt64, newCycle: UInt64, nextDeadline: UFix64)
    access(all) event CircleCompleted(circleId: UInt64)
    access(all) event ReceiptCIDStored(circleId: UInt64, cycle: UInt64, cid: String)

    // ============================================================
    // STATE
    // ============================================================
    access(all) var totalCirclesCreated: UInt64

    // ============================================================
    // ENUMS
    // ============================================================
    access(all) enum CircleStatus: UInt8 {
        access(all) case FORMING     // Accepting members
        access(all) case ACTIVE      // All members joined, cycles running
        access(all) case COMPLETED   // All cycles finished
        access(all) case CANCELLED   // Circle cancelled before completion
    }

    // ============================================================
    // STRUCTS
    // ============================================================
    access(all) struct MemberInfo {
        access(all) let address: Address
        access(all) var hasContributed: Bool
        access(all) var totalContributed: UFix64
        access(all) var cyclesContributed: UInt64
        access(all) var isDelinquent: Bool
        access(all) var rotationPosition: UInt64

        init(address: Address, position: UInt64) {
            self.address = address
            self.hasContributed = false
            self.totalContributed = 0.0
            self.cyclesContributed = 0
            self.isDelinquent = false
            self.rotationPosition = position
        }
    }

    access(all) struct CircleConfig {
        access(all) let name: String
        access(all) let contributionAmount: UFix64  // e.g., 10.0 FLOW
        access(all) let cycleDuration: UFix64        // seconds between payouts
        access(all) let maxMembers: UInt64            // circle size
        access(all) let penaltyPercent: UFix64        // % of deposit forfeited on delinquency

        init(
            name: String,
            contributionAmount: UFix64,
            cycleDuration: UFix64,
            maxMembers: UInt64,
            penaltyPercent: UFix64
        ) {
            pre {
                contributionAmount > 0.0: "Contribution must be positive"
                cycleDuration > 0.0: "Cycle duration must be positive"
                maxMembers >= 2: "Need at least 2 members"
                maxMembers <= 20: "Max 20 members per circle"
                penaltyPercent >= 0.0 && penaltyPercent <= 100.0: "Penalty must be 0-100%"
            }
            self.name = name
            self.contributionAmount = contributionAmount
            self.cycleDuration = cycleDuration
            self.maxMembers = maxMembers
            self.penaltyPercent = penaltyPercent
        }
    }

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

    // ============================================================
    // CIRCLE RESOURCE
    // ============================================================
    access(all) resource Circle {
        access(all) let circleId: UInt64
        access(all) let config: CircleConfig

        access(contract) var status: CircleStatus
        access(contract) var currentCycle: UInt64
        access(contract) var members: {Address: MemberInfo}
        access(contract) var memberOrder: [Address]  // rotation order
        access(contract) var nextDeadline: UFix64
        access(contract) var latestReceiptCID: String

        // The vault holding all contributed funds
        access(self) let vault: @FlowToken.Vault

        // Security deposits (held as collateral against delinquency)
        access(self) let deposits: @{Address: FlowToken.Vault}

        init(
            circleId: UInt64,
            config: CircleConfig,
            creator: Address
        ) {
            self.circleId = circleId
            self.config = config
            self.status = CircleStatus.FORMING
            self.currentCycle = 0
            self.members = {}
            self.memberOrder = []
            self.nextDeadline = 0.0
            self.latestReceiptCID = ""
            self.vault <- FlowToken.createEmptyVault(vaultType: Type<@FlowToken.Vault>())
                as! @FlowToken.Vault
            self.deposits <- {}
        }

        // ---------- MEMBERSHIP ----------

        /// Join the circle with a security deposit
        access(all) fun join(member: Address, deposit: @FlowToken.Vault) {
            pre {
                self.status == CircleStatus.FORMING: "Circle is not accepting members"
                self.members[member] == nil: "Already a member"
                UInt64(self.memberOrder.length) < self.config.maxMembers: "Circle is full"
                deposit.balance >= self.config.contributionAmount: "Deposit must equal contribution amount"
            }

            let position = UInt64(self.memberOrder.length)
            self.members[member] = MemberInfo(address: member, position: position)
            self.memberOrder.append(member)

            // Store security deposit
            let oldDeposit <- self.deposits[member] <- deposit
            destroy oldDeposit

            emit MemberJoined(circleId: self.circleId, member: member)

            // If circle is now full, seal it and start
            if UInt64(self.memberOrder.length) == self.config.maxMembers {
                self.seal()
            }
        }

        /// Seal the circle and begin the first cycle
        access(contract) fun seal() {
            self.status = CircleStatus.ACTIVE
            self.currentCycle = 1
            self.nextDeadline = getCurrentBlock().timestamp + self.config.cycleDuration

            emit CircleSealed(circleId: self.circleId)
        }

        // ---------- CONTRIBUTIONS ----------

        /// Contribute to the current cycle
        access(all) fun contribute(member: Address, payment: @FlowToken.Vault) {
            pre {
                self.status == CircleStatus.ACTIVE: "Circle is not active"
                self.members[member] != nil: "Not a member"
                !(self.members[member]!.hasContributed): "Already contributed this cycle"
                payment.balance >= self.config.contributionAmount: "Insufficient contribution"
            }

            // Deposit funds into the circle's vault
            self.vault.deposit(from: <- payment)

            // Update member state
            if let memberInfo = self.members[member] {
                let updated = MemberInfo(address: memberInfo.address, position: memberInfo.rotationPosition)
                updated.hasContributed = true
                updated.totalContributed = memberInfo.totalContributed + self.config.contributionAmount
                updated.cyclesContributed = memberInfo.cyclesContributed + 1
                self.members[member] = updated
            }

            emit ContributionReceived(
                circleId: self.circleId,
                member: member,
                amount: self.config.contributionAmount,
                cycle: self.currentCycle
            )
        }

        // ---------- CYCLE EXECUTION (Called by Scheduled Transaction) ----------

        /// Execute the current cycle: check contributions, penalize, payout, advance
        access(contract) fun executeCycle() {
            pre {
                self.status == CircleStatus.ACTIVE: "Circle is not active"
            }

            // Step 1: Identify delinquent members
            for addr in self.memberOrder {
                if let memberInfo = self.members[addr] {
                    if !memberInfo.hasContributed && !memberInfo.isDelinquent {
                        self.penalizeMember(member: addr)
                    }
                }
            }

            // Step 2: Determine recipient (based on rotation position)
            let recipientIndex = (self.currentCycle - 1) % UInt64(self.memberOrder.length)
            let recipient = self.memberOrder[recipientIndex]

            // Step 3: Calculate and execute payout
            let payoutAmount = self.vault.balance  // entire pool goes to recipient
            if payoutAmount > 0.0 {
                let payout <- self.vault.withdraw(amount: payoutAmount)

                // Transfer to recipient's account
                let receiverRef = getAccount(recipient)
                    .capabilities.get<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
                    .borrow()
                    ?? panic("Could not borrow receiver for recipient")

                receiverRef.deposit(from: <- payout)

                emit PayoutExecuted(
                    circleId: self.circleId,
                    recipient: recipient,
                    amount: payoutAmount,
                    cycle: self.currentCycle
                )
            }

            // Step 4: Reset contributions for next cycle
            for addr in self.memberOrder {
                if let memberInfo = self.members[addr] {
                    let updated = MemberInfo(address: memberInfo.address, position: memberInfo.rotationPosition)
                    updated.hasContributed = false
                    updated.totalContributed = memberInfo.totalContributed
                    updated.cyclesContributed = memberInfo.cyclesContributed
                    updated.isDelinquent = memberInfo.isDelinquent
                    self.members[addr] = updated
                }
            }

            // Step 5: Advance cycle or complete
            if self.currentCycle >= UInt64(self.memberOrder.length) {
                self.status = CircleStatus.COMPLETED
                emit CircleCompleted(circleId: self.circleId)
                // Return security deposits to non-delinquent members
                self.returnDeposits()
            } else {
                self.currentCycle = self.currentCycle + 1
                self.nextDeadline = getCurrentBlock().timestamp + self.config.cycleDuration
                emit CycleAdvanced(
                    circleId: self.circleId,
                    newCycle: self.currentCycle,
                    nextDeadline: self.nextDeadline
                )
                // ChamaScheduler will handle scheduling the next cycle
            }
        }

        // ---------- PENALTIES ----------

        access(contract) fun penalizeMember(member: Address) {
            // Forfeit a percentage of their security deposit
            if let deposit <- self.deposits[member] <- nil {
                let penaltyAmount = deposit.balance * (self.config.penaltyPercent / 100.0)
                if penaltyAmount > 0.0 && penaltyAmount <= deposit.balance {
                    let penalty <- deposit.withdraw(amount: penaltyAmount)
                    // Penalty goes into the pool (benefits other members)
                    self.vault.deposit(from: <- penalty)
                }
                // Return remainder to deposits
                let oldDeposit <- self.deposits[member] <- deposit
                destroy oldDeposit
            }

            // Mark as delinquent
            if let memberInfo = self.members[member] {
                let updated = MemberInfo(address: memberInfo.address, position: memberInfo.rotationPosition)
                updated.hasContributed = memberInfo.hasContributed
                updated.totalContributed = memberInfo.totalContributed
                updated.cyclesContributed = memberInfo.cyclesContributed
                updated.isDelinquent = true
                self.members[member] = updated
            }

            emit MemberPenalized(circleId: self.circleId, member: member, cycle: self.currentCycle)
        }

        // ---------- DEPOSITS ----------

        access(contract) fun returnDeposits() {
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
                                    // Can't return — put back
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

        // ---------- RECEIPT CID STORAGE ----------

        access(contract) fun storeReceiptCID(cid: String) {
            self.latestReceiptCID = cid
            emit ReceiptCIDStored(circleId: self.circleId, cycle: self.currentCycle, cid: cid)
        }

        // ---------- READ FUNCTIONS ----------

        access(all) fun getState(): CircleState {
            let memberList: [MemberInfo] = []
            for addr in self.memberOrder {
                if let info = self.members[addr] {
                    memberList.append(info)
                }
            }

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

    // ============================================================
    // PUBLIC FUNCTIONS
    // ============================================================

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

    // ============================================================
    // CONTRACT INIT
    // ============================================================

    init() {
        self.totalCirclesCreated = 0
    }
}
```

### 4.3 ChamaScheduler.cdc — Scheduled Transaction Handler

This contract implements Flow's `TransactionHandler` interface, which is the hook that the `FlowTransactionScheduler` calls when a scheduled time arrives.

```cadence
// ChamaScheduler.cdc
// Implements FlowTransactionScheduler.TransactionHandler
// to auto-execute cycle deadlines

import FlowTransactionScheduler from "FlowTransactionScheduler"
import ChamaCircle from "ChamaCircle"

access(all) contract ChamaScheduler {

    access(all) event CycleExecutedByScheduler(circleId: UInt64, cycle: UInt64, timestamp: UFix64)
    access(all) event NextCycleScheduled(circleId: UInt64, cycle: UInt64, scheduledFor: UFix64)

    // The handler resource that FlowTransactionScheduler calls
    access(all) resource ChamaTransactionHandler: FlowTransactionScheduler.TransactionHandler {

        // Reference to the circle this handler manages
        access(self) let circlePath: StoragePath

        init(circlePath: StoragePath) {
            self.circlePath = circlePath
        }

        // This is the function the blockchain calls at the scheduled time
        access(FlowTransactionScheduler.Execute)
        fun executeTransaction(data: AnyStruct?) {
            // Borrow the circle resource from the account that stored it
            let circle = self.owner!.storage
                .borrow<&ChamaCircle.Circle>(from: self.circlePath)
                ?? panic("Could not borrow circle")

            let state = circle.getState()
            let currentCycle = state.currentCycle

            // Execute the cycle (check contributions, penalize, payout, advance)
            circle.executeCycle()

            emit CycleExecutedByScheduler(
                circleId: state.circleId,
                cycle: currentCycle,
                timestamp: getCurrentBlock().timestamp
            )

            // If the circle is still active, schedule the next cycle
            let newState = circle.getState()
            if newState.status == ChamaCircle.CircleStatus.ACTIVE {
                // The caller (transaction) will handle scheduling the next cycle
                // because scheduling requires fee payment
                emit NextCycleScheduled(
                    circleId: state.circleId,
                    cycle: newState.currentCycle,
                    scheduledFor: newState.nextDeadline
                )
            }
        }
    }

    // Factory function to create a handler for a specific circle
    access(all) fun createHandler(circlePath: StoragePath): @ChamaTransactionHandler {
        return <- create ChamaTransactionHandler(circlePath: circlePath)
    }

    init() {}
}
```

### 4.4 ChamaManager.cdc — Registry and Discovery

```cadence
// ChamaManager.cdc
// Registry for discovering circles and looking up membership

access(all) contract ChamaManager {

    access(all) event CircleRegistered(circleId: UInt64, name: String, host: Address)

    // Registry: circleId -> host account address
    access(contract) var circleRegistry: {UInt64: Address}

    // Reverse lookup: member address -> [circleIds]
    access(contract) var memberCircles: {Address: [UInt64]}

    access(all) fun registerCircle(circleId: UInt64, name: String, host: Address) {
        self.circleRegistry[circleId] = host
        emit CircleRegistered(circleId: circleId, name: name, host: host)
    }

    access(all) fun registerMember(circleId: UInt64, member: Address) {
        if self.memberCircles[member] == nil {
            self.memberCircles[member] = []
        }
        self.memberCircles[member]!.append(circleId)
    }

    // ---------- QUERIES ----------

    access(all) fun getCircleHost(circleId: UInt64): Address? {
        return self.circleRegistry[circleId]
    }

    access(all) fun getMemberCircles(member: Address): [UInt64] {
        return self.memberCircles[member] ?? []
    }

    access(all) fun getAllCircleIds(): [UInt64] {
        return self.circleRegistry.keys
    }

    access(all) fun getCircleCount(): Int {
        return self.circleRegistry.length
    }

    init() {
        self.circleRegistry = {}
        self.memberCircles = {}
    }
}
```

---

## 5. Scheduled Transaction Engine

### 5.1 How Scheduled Transactions Work on Flow

Flow's `FlowTransactionScheduler` is a **system contract** deployed on the service account. It allows any contract to register a handler that will be executed at a specified future timestamp.

**Key Flow:**

```
1. Developer creates a TransactionHandler resource
2. Developer stores the handler in their account storage
3. Developer calls FlowTransactionScheduler.schedule() with:
   - The handler capability
   - The target timestamp
   - The execution priority
   - Transaction data (optional)
4. Developer pays scheduling fee upfront
5. At the target timestamp, the Flow execution engine:
   - Calls handler.executeTransaction(data)
   - Emits FlowTransactionScheduler.Executed event
6. The handler can schedule the NEXT execution (self-chaining)
```

### 5.2 Chama's Scheduling Flow

**Initial Schedule (when circle seals):**

```cadence
// Transaction: ScheduleFirstCycle.cdc
import FlowTransactionScheduler from "FlowTransactionScheduler"
import FlowTransactionSchedulerUtils from "FlowTransactionSchedulerUtils"
import ChamaScheduler from "ChamaScheduler"
import ChamaCircle from "ChamaCircle"

transaction(circlePath: StoragePath, cycleDuration: UFix64) {
    prepare(signer: auth(Storage, Capabilities) &Account) {
        // 1. Create the handler
        let handler <- ChamaScheduler.createHandler(circlePath: circlePath)

        // 2. Store the handler
        let handlerPath = /storage/chamaHandler
        signer.storage.save(<- handler, to: handlerPath)

        // 3. Issue capability for the scheduler
        let handlerCap = signer.capabilities.storage
            .issue<&ChamaScheduler.ChamaTransactionHandler>(handlerPath)

        // 4. Estimate fees
        let targetTime = getCurrentBlock().timestamp + cycleDuration
        let estimate = FlowTransactionScheduler.estimate(
            timestamp: targetTime,
            priority: 1,
            executionEffort: 10000
        )

        // 5. Pay fees and schedule
        let feeVault <- signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)!
            .withdraw(amount: estimate.totalFee)

        FlowTransactionScheduler.schedule(
            handlerCap: handlerCap,
            timestamp: targetTime,
            priority: 1,
            executionEffort: 10000,
            data: nil,
            feePayment: <- feeVault
        )
    }
}
```

**Self-Chaining (each cycle schedules the next):**

After `ChamaTransactionHandler.executeTransaction()` fires, the handler emits a `NextCycleScheduled` event. The frontend (or a lightweight listener) reads this event and submits a new scheduling transaction for the next cycle. For the hackathon demo, this can be triggered manually or via a simple event listener since the demo uses 60-second cycles.

**Alternative: Manager Pattern**
Use `FlowTransactionSchedulerUtils.Manager` resource which simplifies scheduling management. The scaffold repo demonstrates this pattern.

### 5.3 Fee Estimation for Circles

At current Flow network costs:
- Scheduling fee per tx: ~0.001 FLOW
- For a 4-member circle with 4 cycles: ~0.004 FLOW total in scheduling fees
- For a 20-member circle with 20 cycles: ~0.02 FLOW total

These costs are negligible and can be paid by the circle creator or split among members at join time.

---

## 6. Storacha Receipt System

### 6.1 Purpose

Every contribution and payout generates a JSON receipt that is uploaded to IPFS via Storacha. This creates:
- **An immutable audit trail** for the circle's financial history
- **A verifiable chain** where each receipt references the previous receipt's CID
- **Visible sponsor integration** — Storacha CIDs appear in the UI with clickable verification links

### 6.2 Receipt Schema

```json
{
  "version": "1.0",
  "circleId": "12345",
  "circleName": "Nairobi Builders Chama",
  "action": "contribution",
  "member": "0xf8d6e0586b0a20c7",
  "amount": "10.00000000",
  "cycle": 1,
  "totalCycles": 4,
  "timestamp": "2026-02-20T14:00:00Z",
  "blockHeight": 892341,
  "txHash": "abc123def456...",
  "previousReceiptCID": "bafybeig5k3ot2...",
  "circleState": {
    "membersContributed": 3,
    "totalMembers": 4,
    "poolBalance": "30.00000000",
    "currentRecipient": "0x179b6b1cb6755e31"
  }
}
```

**Action types:**
- `contribution` — member deposited funds
- `payout` — recipient received the pool
- `penalty` — member was penalized for non-contribution
- `circle_created` — initial circle creation
- `circle_completed` — all cycles finished

### 6.3 Upload Flow

```javascript
// receipt-service.js
import { create } from '@storacha/client'

const storachaClient = await create()
// Authenticate with Storacha (UCAN delegation from setup)

async function uploadReceipt(receiptData, previousCID) {
  const receipt = {
    ...receiptData,
    previousReceiptCID: previousCID || null,
    timestamp: new Date().toISOString()
  }

  const blob = new Blob(
    [JSON.stringify(receipt, null, 2)],
    { type: 'application/json' }
  )

  const cid = await storachaClient.uploadFile(blob)

  // Store CID on-chain via transaction
  await storeReceiptCIDOnChain(receiptData.circleId, cid.toString())

  return cid.toString()
}
```

### 6.4 CID Chain Verification

Each receipt contains `previousReceiptCID`, creating a linked list of receipts on IPFS:

```
Receipt #1 (Circle Created)
  CID: bafybeig5k3...
  previousReceiptCID: null

  Receipt #2 (Member 1 Contributed)
    CID: bafybeiq2m8...
    previousReceiptCID: bafybeig5k3...

    Receipt #3 (Member 2 Contributed)
      CID: bafybeifn7j...
      previousReceiptCID: bafybeiq2m8...

      Receipt #4 (Payout to Member 1)
        CID: bafybeiah4r...
        previousReceiptCID: bafybeifn7j...
```

Anyone with the latest CID (stored on-chain) can trace the entire history backward by following `previousReceiptCID` links.

**Verification URL format:**
```
https://w3s.link/ipfs/{CID}
```

---

## 7. Frontend Application

### 7.1 Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Flow's official tutorials use Next.js. SSR for SEO on Devpost. |
| Flow SDK | @onflow/react-sdk | Official React hooks: useFlowQuery, useFlowMutate, useFlowCurrentUser |
| Styling | Tailwind CSS | Fast prototyping, consistent design, Chizaa's primary CSS framework |
| State | React hooks (useState, useEffect) | No external state library needed for this scope |
| Storacha | @storacha/client (JS) | Official client library for IPFS uploads |
| Wallet | Flow Dev Wallet (emulator) / Blocto (testnet) | Standard Flow wallet integration via FCL discovery |

### 7.2 Page Structure

```
chama-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # FlowProvider wrapper
│   │   ├── page.tsx            # Landing / dashboard
│   │   ├── create/
│   │   │   └── page.tsx        # Create new circle
│   │   ├── circle/
│   │   │   └── [id]/
│   │   │       └── page.tsx    # Circle detail + contribute
│   │   └── history/
│   │       └── page.tsx        # Receipt verification
│   ├── components/
│   │   ├── Navbar.tsx          # Wallet connect + user info
│   │   ├── CircleCard.tsx      # Circle summary card
│   │   ├── MemberList.tsx      # Members with contribution status
│   │   ├── CountdownTimer.tsx  # Live countdown to next payout
│   │   ├── ContributeButton.tsx # Contribute action
│   │   ├── PayoutBanner.tsx    # Shows when payout executes
│   │   ├── ReceiptLink.tsx     # Clickable Storacha CID
│   │   └── CycleTimeline.tsx   # Visual rotation order
│   ├── cadence/
│   │   ├── contracts/          # .cdc contract files
│   │   ├── transactions/       # .cdc transaction files
│   │   └── scripts/            # .cdc script files
│   ├── lib/
│   │   ├── flow-config.ts      # FCL configuration
│   │   ├── storacha.ts         # Storacha client setup
│   │   └── receipt-service.ts  # Receipt upload logic
│   └── hooks/
│       ├── useCircle.ts        # Query circle state
│       ├── useContribute.ts    # Contribute mutation
│       └── useCountdown.ts     # Countdown timer logic
└── flow.json                   # Flow project config
```

### 7.3 Key UI Components

**Dashboard (page.tsx):**
- Shows connected wallet address
- Lists circles the user belongs to
- "Create New Circle" button
- Each circle shows: name, member count, current cycle, next payout countdown

**Circle Detail (circle/[id]/page.tsx):**
This is the most important page — it's what the demo shows.

```
┌──────────────────────────────────────────────────┐
│  Nairobi Builders Chama          [Cycle 2 of 4]  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │  NEXT PAYOUT IN:                            │  │
│  │                                             │  │
│  │        00:00:47                              │  │
│  │                                             │  │
│  │  Recipient: 0x179b...5e31 (Member 2)        │  │
│  │  Pool: 30.0 / 40.0 FLOW                     │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  Members                                          │
│  ┌─────────────────────────────────────────────┐  │
│  │ ✅ 0xf8d6...20c7  │ 10.0 FLOW │ Contributed │  │
│  │ ✅ 0x179b...5e31  │ 10.0 FLOW │ Contributed │  │
│  │ ✅ 0xe03d...b79e  │ 10.0 FLOW │ Contributed │  │
│  │ ⏳ 0xa2c4...8f12  │ ----      │ Pending     │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  [CONTRIBUTE 10.0 FLOW]    (button, if pending)   │
│                                                   │
│  Rotation Order                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ Cycle 1: 0xf8d6... ✅ PAID                  │  │
│  │ Cycle 2: 0x179b... ◀ CURRENT                │  │
│  │ Cycle 3: 0xe03d... ⏳ UPCOMING              │  │
│  │ Cycle 4: 0xa2c4... ⏳ UPCOMING              │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  Latest Receipt                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 🔗 bafybeig5k3ot2... (View on IPFS)        │  │
│  │ Verified ✓                                  │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ ✅ PAYOUT EXECUTED                          │  │
│  │ 40.0 FLOW sent to 0x179b...5e31             │  │
│  │ Tx: 0xabc123...  (View on Explorer)         │  │
│  │ Receipt: bafybeiah4r... (View on IPFS)      │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**The PayoutBanner is the wow moment component:**
- Hidden until the scheduled transaction fires
- Animates in when the `PayoutExecuted` event is detected
- Shows recipient address, amount, tx hash, and Storacha receipt CID
- Green background with checkmark for instant visual confirmation

### 7.4 Flow Configuration

```typescript
// lib/flow-config.ts
import { config } from '@onflow/fcl'

config({
  'app.detail.title': 'Chama - Trustless Savings Circles',
  'app.detail.icon': '/chama-logo.png',

  // Emulator settings (development)
  'accessNode.api': 'http://localhost:8888',
  'discovery.wallet': 'http://localhost:8701/fcl/authn',
  'flow.network': 'emulator',

  // Contract addresses (set after deployment)
  '0xChamaCircle': '0xf8d6e0586b0a20c7',
  '0xChamaScheduler': '0xf8d6e0586b0a20c7',
  '0xChamaManager': '0xf8d6e0586b0a20c7',
  '0xFlowTransactionScheduler': '0xf8d6e0586b0a20c7',

  // Testnet settings (deployment)
  // 'accessNode.api': 'https://rest-testnet.onflow.org',
  // 'discovery.wallet': 'https://fcl-discovery.onflow.org/testnet/authn',
})
```

### 7.5 Key React Hooks

```typescript
// hooks/useCircle.ts
import { useFlowQuery } from '@onflow/react-sdk'

export function useCircle(circleId: string) {
  const { data, isLoading, error, refetch } = useFlowQuery({
    cadence: `
      import ChamaCircle from 0xChamaCircle

      access(all) fun main(circleHost: Address, circlePath: StoragePath): ChamaCircle.CircleState? {
        let acct = getAccount(circleHost)
        if let circle = acct.storage.borrow<&ChamaCircle.Circle>(from: circlePath) {
          return circle.getState()
        }
        return nil
      }
    `,
    args: (arg, t) => [
      arg(circleId, t.Address),
      // Additional args as needed
    ],
  })

  return { circle: data, isLoading, error, refetch }
}
```

```typescript
// hooks/useContribute.ts
import { useFlowMutate } from '@onflow/react-sdk'

export function useContribute() {
  const { mutate, isPending, error } = useFlowMutate()

  const contribute = async (circlePath: string, amount: string) => {
    const txId = await mutate({
      cadence: `
        import ChamaCircle from 0xChamaCircle
        import FlowToken from 0xFlowToken
        import FungibleToken from 0xFungibleToken

        transaction(amount: UFix64) {
          prepare(signer: auth(Storage, BorrowValue) &Account) {
            let vaultRef = signer.storage
              .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                from: /storage/flowTokenVault
              ) ?? panic("Could not borrow vault")

            let payment <- vaultRef.withdraw(amount: amount)

            // Borrow circle and contribute
            let circle = signer.storage
              .borrow<&ChamaCircle.Circle>(from: ${circlePath})
              ?? panic("Could not borrow circle")

            circle.contribute(member: signer.address, payment: <- payment)
          }
        }
      `,
      args: (arg, t) => [
        arg(amount, t.UFix64),
      ],
    })

    return txId
  }

  return { contribute, isPending, error }
}
```

```typescript
// hooks/useCountdown.ts
import { useState, useEffect } from 'react'

export function useCountdown(deadline: number) {
  const [timeLeft, setTimeLeft] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now() / 1000
      const remaining = Math.max(0, deadline - now)
      setTimeLeft(remaining)
    }, 1000)

    return () => clearInterval(interval)
  }, [deadline])

  const minutes = Math.floor(timeLeft / 60)
  const seconds = Math.floor(timeLeft % 60)

  return {
    timeLeft,
    formatted: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
    isExpired: timeLeft <= 0,
  }
}
```

---

## 8. Data Model

### 8.1 On-Chain State (Cadence Resources)

```
Account Storage:
├── /storage/chamaCircle_1     → Circle resource (circleId: 1)
├── /storage/chamaCircle_2     → Circle resource (circleId: 2)
├── /storage/chamaHandler_1    → ChamaTransactionHandler resource
├── /storage/chamaHandler_2    → ChamaTransactionHandler resource
└── /storage/flowTokenVault    → FlowToken.Vault (user's FLOW balance)

Public Capabilities:
├── /public/chamaCircle_1      → &Circle (read-only: getState, isMember, etc.)
├── /public/flowTokenReceiver  → &{FungibleToken.Receiver} (receive FLOW)
└── /public/flowTokenBalance   → &{FungibleToken.Balance} (check balance)
```

### 8.2 Off-Chain State (Storacha / IPFS)

```
Storacha Space:
├── Circle 1/
│   ├── receipt_001.json  (CID: bafybeig...)  → circle_created
│   ├── receipt_002.json  (CID: bafybeiq...)  → contribution (member 1, cycle 1)
│   ├── receipt_003.json  (CID: bafybeif...)  → contribution (member 2, cycle 1)
│   ├── receipt_004.json  (CID: bafybeia...)  → payout (member 1 receives)
│   └── ...
└── (linked via previousReceiptCID field)
```

### 8.3 Events (For Frontend Subscription)

The frontend subscribes to these events to update UI in real-time:

| Event | When Emitted | Frontend Action |
|---|---|---|
| `CircleCreated` | New circle deployed | Redirect to circle page |
| `MemberJoined` | Member joins circle | Update member list |
| `CircleSealed` | Last member joins | Show "ACTIVE" status, start countdown |
| `ContributionReceived` | Member contributes | Update member status to ✅, update pool |
| `PayoutExecuted` | Scheduled tx fires payout | Show PayoutBanner (WOW MOMENT) |
| `MemberPenalized` | Delinquent member penalized | Show penalty indicator |
| `CycleAdvanced` | New cycle begins | Reset contributions, update countdown |
| `CircleCompleted` | All cycles finished | Show completion state |
| `ReceiptCIDStored` | Receipt uploaded to Storacha | Show clickable CID link |

---

## 9. User Flows

### 9.1 Create a Circle

```
User Action                    System Response
────────────────────────────── ──────────────────────────────
1. Click "Create Circle"       → Show creation form
2. Fill in:                    
   - Name: "Nairobi Builders"
   - Members: 4
   - Contribution: 10.0 FLOW
   - Cycle: 60 seconds (demo)
   - Penalty: 50%
3. Click "Create"              → Submit ChamaCircle.createCircle() tx
                               → Register in ChamaManager
                               → Upload "circle_created" receipt to Storacha
                               → Redirect to circle page
                               → Creator auto-joins as Member 1
```

### 9.2 Join a Circle

```
User Action                    System Response
────────────────────────────── ──────────────────────────────
1. Navigate to circle page     → Show circle info + "Join" button
2. Click "Join Circle"         → Prompt wallet for 10.0 FLOW deposit
3. Approve transaction         → Submit Circle.join() tx
                               → Deposit locked in contract
                               → Member added to rotation
                               → Upload "member_joined" receipt
                               → If circle now full → seal + schedule first cycle
```

### 9.3 Contribute to a Cycle

```
User Action                    System Response
────────────────────────────── ──────────────────────────────
1. See countdown timer         → "Next payout in: 00:47"
2. See "CONTRIBUTE" button     → Button shows contribution amount
3. Click "CONTRIBUTE"          → Prompt wallet for 10.0 FLOW
4. Approve transaction         → Submit Circle.contribute() tx
                               → Pool balance increases
                               → Member status → ✅ Contributed
                               → Upload "contribution" receipt
                               → If all contributed → pool ready
```

### 9.4 Automated Payout (No User Action)

```
Scheduled Transaction          System Response
────────────────────────────── ──────────────────────────────
Countdown hits 00:00           → FlowTransactionScheduler fires
                               → ChamaTransactionHandler.executeTransaction()
                               → Circle.executeCycle():
                                  1. Check who contributed
                                  2. Penalize delinquent members
                                  3. Transfer pool to current recipient
                                  4. Reset contribution flags
                                  5. Advance cycle counter
                                  6. Set next deadline
                               → Emit PayoutExecuted event
                               → Frontend detects event
                               → PayoutBanner slides in (WOW)
                               → Upload "payout" receipt to Storacha
                               → Schedule next cycle deadline
```

### 9.5 Delinquent Member Penalty

```
At cycle deadline              System Response
────────────────────────────── ──────────────────────────────
Member 3 hasn't contributed    → Scheduled tx fires
                               → Circle.executeCycle() detects missing contribution
                               → Circle.penalizeMember(member3):
                                  - 50% of deposit forfeited
                                  - Penalty added to pool (benefits others)
                                  - Member marked isDelinquent: true
                               → Emit MemberPenalized event
                               → Pool is smaller but still distributed
                               → Payout proceeds to current recipient
```

---

## 10. Demo Script

### 10.1 Pre-Demo Setup

**Before recording:**
1. Start Flow Emulator: `flow emulator --scheduled-transactions --block-time 1s`
2. Start Dev Wallet: `flow dev-wallet`
3. Deploy ChamaKit contracts
4. Create 4 emulator accounts (creator + 3 members)
5. Fund all accounts with FLOW
6. Start the Next.js app
7. Open 4 browser tabs (one per member)
8. Do a dry run to verify timing

### 10.2 Demo Timeline (4 minutes)

**[0:00 – 0:30] CONTEXT**

*Talking points (voiceover):*
> "One billion people worldwide use savings circles — called chamas in Kenya, tandas in Mexico, stokvels in South Africa. Groups of 5 to 20 people pool money and take turns receiving the pot.
>
> The number one failure mode? The coordinator — the person who holds the money — steals it, loses it, or disappears. Every blockchain-based ROSCA ever built still needs someone to trigger the payout. We built the first one that doesn't.
>
> Chama uses Flow's Scheduled Transactions to make the blockchain itself the coordinator. No bots. No servers. No trust required."

*Screen shows:* Landing page with tagline: "Trustless Savings Circles on Flow"

**[0:30 – 1:00] CREATE CIRCLE**

*Actions:*
1. Click "Create New Circle"
2. Fill form: Name "Nairobi Builders", Members: 4, Contribution: 10.0 FLOW, Cycle: 60s
3. Submit → show transaction pending → confirmed
4. Show the deployed contract address

*Talking point:*
> "We're creating a 4-person circle. Each member contributes 10 FLOW per cycle. Payouts happen every 60 seconds — compressed for this demo, but in production this would be monthly."

**[1:00 – 1:30] MEMBERS JOIN**

*Actions:*
1. Switch to Tab 2 → Member 2 joins (10 FLOW deposit)
2. Switch to Tab 3 → Member 3 joins (10 FLOW deposit)
3. Switch to Tab 4 → Member 4 joins (10 FLOW deposit)
4. Circle status changes to "ACTIVE" → countdown starts

*Talking point:*
> "Each member puts up a security deposit equal to one contribution. This is collateral against skipping a payment. When Member 4 joins, the circle seals and the first scheduled transaction is registered with Flow."

*Screen shows:* Countdown timer: "Next payout in: 00:58"

**[1:30 – 2:15] ⭐ THE WOW MOMENT — AUTOMATED PAYOUT**

*Actions:*
1. All 4 members contribute (switch between tabs, contribute 10 FLOW each)
2. Pool shows 40.0 FLOW
3. Countdown approaches zero
4. **At 00:00 — do nothing. Hands off keyboard.**
5. The PayoutBanner slides in: "✅ PAYOUT EXECUTED — 40.0 FLOW sent to Member 1"
6. Show the on-chain transaction hash (clickable)
7. Show the Storacha receipt CID (clickable)

*Talking point:*
> "Watch what happens. The countdown hits zero and... **I didn't click anything.** No one did. Flow's Scheduled Transaction fired autonomously. 40 FLOW just moved to Member 1's account. That transaction hash is verifiable on-chain. That receipt CID is on IPFS via Storacha. This is the first time any blockchain has done this for a savings circle."

**[2:15 – 2:45] DELINQUENT MEMBER SCENARIO**

*Actions:*
1. Cycle 2 begins, countdown resets
2. Members 1, 2, and 4 contribute (but NOT Member 3)
3. Countdown approaches zero
4. Scheduled tx fires: PayoutBanner shows payout to Member 2
5. Also shows: "⚠️ Member 3 PENALIZED — 50% deposit forfeited"

*Talking point:*
> "In Cycle 2, Member 3 doesn't pay. When the deadline hits, the protocol automatically penalizes them — half their deposit goes into the pool. No coordinator had to chase them. No awkward WhatsApp messages. The smart contract handles enforcement."

**[2:45 – 3:15] VERIFIABLE RECEIPTS**

*Actions:*
1. Click on a Storacha CID link
2. Show the JSON receipt on IPFS: member, amount, cycle, previous CID
3. Follow the `previousReceiptCID` link to show the chain

*Talking point:*
> "Every action generates a receipt stored on IPFS via Storacha. Each receipt links to the previous one, creating a verifiable chain. Any member can independently audit the entire circle history. This is what decentralized storage is for — not just hosting files, but creating trust."

**[3:15 – 3:45] CHAMAKIT: THE PRIMITIVE**

*Actions:*
1. Switch to VS Code (or split screen)
2. Show the three Cadence contracts side by side
3. Show a 5-line code snippet:
```cadence
import ChamaCircle from 0xCHAMA

let config = ChamaCircle.CircleConfig(
    name: "My Circle",
    contributionAmount: 10.0,
    cycleDuration: 2592000.0,  // 30 days
    maxMembers: 10,
    penaltyPercent: 50.0
)
let circle <- ChamaCircle.createCircle(config: config, creator: self.address)
```
4. Show the test suite passing

*Talking point:*
> "Chama isn't just an app. ChamaKit is a composable Cadence library — three contracts that any Flow developer can import. Payroll apps, community banking, remittance tools — any app that needs rotating group payments can add this in 5 lines of Cadence."

**[3:45 – 4:00] CLOSE**

*Talking point:*
> "Chama eliminates the coordinator. One billion people get trustless savings circles. ChamaKit is open-source on GitHub. Built on Flow with Storacha. Thank you."

*Screen shows:* GitHub repo link + "Built for PL Genesis 2026"

---

## 11. Testing Strategy

### 11.1 Cadence Test Suite

```cadence
// cadence/tests/ChamaCircle_test.cdc
import Test
import "ChamaCircle"

access(all) fun testCreateCircle() {
    // Test circle creation with valid config
    // Assert circleId increments
    // Assert status is FORMING
}

access(all) fun testJoinCircle() {
    // Test member join with deposit
    // Assert member count increases
    // Assert deposit locked
    // Test circle auto-seals when full
}

access(all) fun testContribute() {
    // Test contribution with correct amount
    // Assert hasContributed = true
    // Assert pool balance increases
    // Test duplicate contribution rejected
}

access(all) fun testExecuteCycle() {
    // Test payout to correct recipient
    // Assert pool is emptied
    // Assert cycle advances
    // Assert contribution flags reset
}

access(all) fun testDelinquencyPenalty() {
    // Test non-contributing member is penalized
    // Assert deposit partially forfeited
    // Assert penalty goes to pool
}

access(all) fun testCircleCompletion() {
    // Test all N cycles complete
    // Assert status = COMPLETED
    // Assert deposits returned to non-delinquent members
}

access(all) fun testCannotContributeToFormingCircle() {
    // Negative test: contribution before circle is sealed
}

access(all) fun testCannotJoinFullCircle() {
    // Negative test: joining when maxMembers reached
}
```

**Run tests:**
```bash
flow test cadence/tests/ChamaCircle_test.cdc
```

### 11.2 Integration Tests

| Test | Method | Pass Criteria |
|---|---|---|
| Circle lifecycle end-to-end | Flow Emulator with 4 accounts | All 4 cycles complete, all payouts correct |
| Scheduled Transaction fires | Emulator with `--scheduled-transactions --block-time 1s` | Handler executes at correct timestamp |
| Storacha upload | Live Storacha test space | CID returned, JSON retrievable via gateway |
| Frontend event subscription | Next.js dev mode + emulator | PayoutBanner appears when event detected |
| Concurrent contributions | 4 browser tabs contributing | No race conditions, all contributions recorded |
| Delinquency penalty | Deliberately skip one contribution | Penalty applied, payout still proceeds |

### 11.3 Demo Rehearsal Checklist

- [ ] Emulator running with scheduled-transactions flag
- [ ] Dev wallet running on port 8701
- [ ] All 4 accounts funded with 100+ FLOW
- [ ] Contracts deployed to emulator
- [ ] Frontend connects to emulator
- [ ] Storacha space configured and authenticated
- [ ] Run through complete 4-cycle demo
- [ ] Verify countdown timing (60s cycles)
- [ ] Verify PayoutBanner appears on all 4 tabs
- [ ] Verify receipt CIDs are clickable and resolve
- [ ] Record backup video in case of live demo issues

---

## 12. Build Schedule

### Week 1 (Feb 10–16): Core Contracts

| Day | Task | Deliverable |
|---|---|---|
| Mon | Set up Flow dev environment (CLI, emulator, VS Code extension) | Working emulator |
| Tue | Write ChamaCircle.cdc (Circle resource, join, contribute) | Core contract compiles |
| Wed | Write ChamaCircle.cdc (executeCycle, penalties, deposits) | Full lifecycle logic |
| Thu | Write ChamaScheduler.cdc (TransactionHandler implementation) | Handler compiles |
| Fri | Write ChamaManager.cdc (registry, discovery) | All 3 contracts compile |
| Sat | Test scheduled tx on emulator (`--scheduled-transactions --block-time 1s`) | Scheduled tx fires and executes cycle |
| Sun | Write transaction files (CreateCircle, JoinCircle, Contribute, Schedule) | CLI can run full lifecycle |

**Week 1 Gate:** One full circle lifecycle completes via CLI on the emulator with a scheduled transaction auto-firing the payout. If this doesn't work, we stop and debug before touching frontend.

### Week 2 (Feb 17–23): Tests + Storacha

| Day | Task | Deliverable |
|---|---|---|
| Mon | Write Cadence test suite (8-10 tests) | All tests pass |
| Tue | Fix bugs found by tests, edge cases | Stable contract |
| Wed | Set up Storacha client, authenticate, test upload | Receipt uploads return CID |
| Thu | Build receipt service (receipt-service.ts) | Receipts upload after each event |
| Fri | Store CID on-chain, verify retrieval | CID chain works end-to-end |
| Sat | Refine contract: penalty edge cases, deposit return | Bulletproof lifecycle |
| Sun | Deploy to Flow Testnet, test with real network delays | Testnet deployment working |

**Week 2 Gate:** Full circle lifecycle works with Storacha receipts on testnet. CID chain is verifiable.

### Week 3 (Feb 24–Mar 2): Frontend

| Day | Task | Deliverable |
|---|---|---|
| Mon | Scaffold Next.js app, configure @onflow/react-sdk | App connects to emulator |
| Tue | Build wallet authentication (Navbar, login/logout) | User can connect wallet |
| Wed | Build Create Circle page (form, submit tx) | Circle creation works from UI |
| Thu | Build Circle Detail page (member list, pool, status) | Circle state displays correctly |
| Fri | Build ContributeButton + CountdownTimer | Users can contribute, countdown runs |
| Sat | Build PayoutBanner (event subscription, animation) | Banner appears on payout |
| Sun | Build ReceiptLink + history page | CIDs clickable, receipts viewable |

**Week 3 Gate:** Complete UI works end-to-end on emulator. PayoutBanner fires automatically.

### Week 4 (Mar 3–9): Polish + Testnet

| Day | Task | Deliverable |
|---|---|---|
| Mon | UI polish: colors, spacing, responsive design | Professional-looking UI |
| Tue | Edge case handling: partial circles, early exit, error states | Graceful error handling |
| Wed | Deploy to Flow Testnet with real wallet (Blocto) | Testnet deployment live |
| Thu | End-to-end testing on testnet with real delays | Confirmed working on testnet |
| Fri | ChamaKit documentation: README, usage examples | Library is documented |
| Sat | Multi-member testing (4 real accounts on testnet) | Full demo scenario on testnet |
| Sun | Buffer day for any remaining fixes | Everything stable |

### Week 5 (Mar 10–16): Submission

| Day | Task | Deliverable |
|---|---|---|
| Mon | Write demo script, set up screen recording environment | Script finalized |
| Tue | Record demo video (4 minutes, follow Section 10 script) | Video recorded |
| Wed | Edit video (add voiceover, captions, transitions) | Video polished |
| Thu | Write Devpost submission (problem, solution, tech, challenges) | Submission text ready |
| Fri | Create GitHub repo with README, license, screenshots | Repo public |
| Sat | Final review: submission text, video, repo, contracts | Everything checked |
| **Sun Mar 16** | **SUBMIT** | **Deadline** |

---

## 13. Submission Package

### 13.1 Required Deliverables

| Deliverable | Content | Status |
|---|---|---|
| **Devpost Project** | Title, description, problem, solution, tech stack, challenges, what's next | To create |
| **Demo Video** | 4-minute screen recording with voiceover (MP4, 1080p) | To record |
| **GitHub Repo** | ChamaKit contracts, frontend app, tests, README | To create |
| **Live Demo** | App deployed to Vercel/Netlify + Flow Testnet | To deploy |

### 13.2 Devpost Writing Guide

**Title:** Chama — Trustless Savings Circles on Flow

**Tagline:** The first rotating savings protocol where the blockchain is the coordinator. No bots. No servers. No trust required.

**Inspiration:**
1 billion people use savings circles. The #1 failure is the coordinator stealing the money. I designed a protocol (CircleSync) to solve this but discovered that every blockchain implementation — including mine — still needs someone to trigger the payout. Flow's Scheduled Transactions are the first protocol-level solution.

**What it does:**
ChamaKit is a composable Cadence library that brings trustless rotating savings circles to Flow. Members contribute FLOW tokens each cycle. When the deadline arrives, Flow's Scheduled Transaction system automatically transfers the pool to the current recipient — no human intervention required. Every action generates a verifiable receipt on IPFS via Storacha.

**How we built it:**
Three Cadence smart contracts (ChamaCircle, ChamaScheduler, ChamaManager) form the ChamaKit library. ChamaScheduler implements Flow's TransactionHandler interface for autonomous cycle execution. The reference app uses Next.js + @onflow/react-sdk for real-time UI updates. Storacha provides hot IPFS storage with UCAN-based access control for receipt chains.

**Challenges:**
Cadence's resource-oriented model required rethinking the Solidity patterns from our original design. Scheduled Transaction fee estimation needed careful handling to ensure the circle creator can prepay for all cycles. Coordinating the self-chaining pattern (each cycle scheduling the next) was the hardest engineering problem.

**What's next:**
ChamaKit becomes a public good on Flow. Integration with stablecoins (cUSD, USDC) via Flow's Cross-VM bridge. WhatsApp bot for mobile-first coordination. M-Pesa on/off-ramp for direct fiat contribution. ZK credit scoring from contribution histories.

### 13.3 README Structure

```markdown
# 🏦 ChamaKit — Trustless Savings Circles on Flow

> The first ROSCA implementation where the blockchain is the coordinator.

## What is ChamaKit?

ChamaKit is a composable Cadence library for rotating savings circles (ROSCAs/chamas).
It uses Flow's Scheduled Transactions to automate payouts without any external trigger.

## Quick Start

[5-line code example]

## Architecture

[Simplified diagram]

## Contracts

- `ChamaCircle.cdc` — Circle lifecycle, contributions, payouts, penalties
- `ChamaScheduler.cdc` — Scheduled Transaction handler for autonomous execution
- `ChamaManager.cdc` — Circle registry and membership discovery

## Demo

[Link to live app] | [Link to demo video]

## Built With

- Flow Blockchain (Cadence + Scheduled Transactions)
- Storacha (IPFS receipt storage)
- Next.js + @onflow/react-sdk

## License

MIT
```

---

## 14. Risk Register

| # | Risk | Probability | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| 1 | Scheduled Tx doesn't fire on emulator | MEDIUM | HIGH | Test Day 1 of Week 1. If broken, use emulator fork mode or switch to manual triggering + testnet. | Chizaa | Open |
| 2 | Cadence resource model doesn't support MemberInfo struct mutation | MEDIUM | MEDIUM | Use "create new struct, replace" pattern instead of in-place mutation. Already designed this way. | Chizaa | Open |
| 3 | Storacha upload fails during demo | LOW | MEDIUM | Upload asynchronously. On-chain CID hash is immediate backup. Pre-upload test receipts. | Chizaa | Open |
| 4 | Demo countdown timing off (60s cycle doesn't align with recording) | MEDIUM | MEDIUM | Use `--block-time 1s` flag for consistent block production. Rehearse 3x before recording. Have backup video. | Chizaa | Open |
| 5 | Scope creep: temptation to add yield, lending, multiple tokens | HIGH | HIGH | Hard boundary in this spec: 3 contracts, 1 token (FLOW), no DeFi composability. Review against this doc weekly. | Chizaa | Open |
| 6 | Flow CLI version incompatibility | LOW | MEDIUM | Pin CLI version v2.7.0+. Test installation Day 1. | Chizaa | Open |
| 7 | Self-chaining scheduled tx requires fee management | MEDIUM | MEDIUM | Pre-fund scheduling fees at circle creation. Estimate total cost upfront. | Chizaa | Open |
| 8 | Cadence struct immutability requires workaround for member state updates | MEDIUM | LOW | Already accounted for: create new MemberInfo struct with updated fields, replace in dictionary. | Chizaa | Open |
| 9 | Dev Wallet doesn't support 4 simultaneous sessions | LOW | MEDIUM | Use Flow CLI to create 4 accounts. Simulate multi-member via CLI transactions if wallet can't handle it. | Chizaa | Open |
| 10 | Judges unfamiliar with ROSCAs | LOW | MEDIUM | 30-second context intro in demo. Self-explanatory UI. Problem is universal even if name isn't. | Chizaa | Open |

---

## Appendices

### Appendix A: Flow Contract Addresses

**Emulator (development):**
```
FlowToken: 0x0ae53cb6e3f42a79
FungibleToken: 0xee82856bf20e2aa6
FlowTransactionScheduler: 0xf8d6e0586b0a20c7 (service account)
```

**Testnet (deployment):**
```
FlowToken: 0x7e60df042a9c0868
FungibleToken: 0x9a0766d93b6608b7
FlowTransactionScheduler: [verify at deployment]
```

### Appendix B: Storacha Setup

```bash
# Install CLI
npm install -g @web3-storage/w3cli

# Login
w3 login your-email@example.com

# Create space
w3 space create chama-receipts

# Generate agent key (for programmatic access)
w3 key create
# Save the private key as STORACHA_KEY env variable

# Create delegation for the agent
w3 delegation create <DID_FROM_KEY> --base64
# Save as STORACHA_PROOF env variable
```

### Appendix C: Cadence vs. Solidity Design Decisions

| Decision | Solidity (CircleSync) | Cadence (Chama) | Why Cadence is Better Here |
|---|---|---|---|
| Fund storage | Contract holds all funds in single mapping | Each Circle resource has its own Vault | Isolation: one circle's funds can't be affected by another's bugs |
| Access control | `require(msg.sender == ...)` | Capabilities + Entitlements | Fine-grained: can give read access without write access |
| Payout trigger | `external` function anyone can call | Scheduled Transaction (protocol-level) | Trustless: no keeper needed |
| Member data | Mapping of address → struct | Resource with embedded struct dictionary | Ownership semantics: circle data lives with the host account |
| Circle discovery | Contract registry with index | ChamaManager contract with reverse lookups | Same approach, but Cadence's account model makes it natural |

### Appendix D: Glossary

| Term | Definition |
|---|---|
| **ROSCA** | Rotating Savings and Credit Association — a group savings model where members contribute equally and take turns receiving the pool |
| **Chama** | Swahili for "group" — the East African term for informal savings circles |
| **ChamaKit** | The composable Cadence library (3 contracts) that is Chama's primary deliverable |
| **Scheduled Transaction** | Flow protocol feature that allows smart contracts to execute at a future time without external triggers |
| **CID** | Content Identifier — a hash-based address for content on IPFS |
| **Storacha** | Protocol Labs' hot storage network for IPFS, used for receipt storage |
| **UCAN** | User Controlled Authorization Network — Storacha's permission system |
| **Cycle** | One round of a savings circle where all members contribute and one member receives the pool |
| **Delinquent** | A member who fails to contribute before the cycle deadline |
| **Security Deposit** | Collateral locked at join time, partially forfeited on delinquency |

---

**END OF APPLICATION SPECIFICATION**

*This document is the single source of truth for the Chama build. Every code decision, UI choice, and demo moment should trace back to this spec. If something isn't in this document, it's out of scope.*

*Last updated: February 17, 2026*
*Author: Chizaa*
*Status: READY FOR BUILD*
