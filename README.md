# Chama — Trustless Rotating Savings Circles on Flow

Chama brings the centuries-old tradition of community savings circles (ROSCAs) to the blockchain. Members pool money each cycle, and one person receives the entire pot on a rotating basis — all enforced by smart contracts. No middleman. No trust needed. Just code.

**Built for the PL Genesis Hackathon 2026.**

## How It Works

```
1. CREATE  — Someone sets the rules (contribution amount, cycle duration, max members)
2. JOIN    — Members join by paying a security deposit
3. SEAL    — Circle activates when all slots fill
4. CYCLE   — Each round: everyone contributes → one member gets the full payout
5. ROTATE  — Payout recipient rotates each cycle (join order)
6. DONE    — After all cycles, deposits are returned automatically
```

### What makes this different from traditional chamas?

| Traditional | Chama on Flow |
|---|---|
| Trust the group leader | Smart contract holds all funds |
| Manual collection | Automatic contributions |
| No enforcement | Penalties enforced by code (deposit slashing) |
| No audit trail | Every action recorded as IPFS receipt |
| Easy to cheat | Cryptographically impossible to cheat |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                     │
│  Dashboard │ Create │ Join │ Circle Detail │ History      │
│                                                          │
│  FCL (Flow Client Library) ←→ Flow Wallet / Blocto       │
└──────────────────────┬──────────────────────────────────┘
                       │ Cadence transactions & scripts
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  FLOW BLOCKCHAIN (Testnet)                │
│                                                          │
│  ┌──────────────┐ ┌────────────────┐ ┌──────────────┐   │
│  │ ChamaCircle  │ │ ChamaScheduler │ │ ChamaManager │   │
│  │              │ │                │ │              │   │
│  │ • createCircle│ │ • TransHandler │ │ • registry   │   │
│  │ • join       │ │ • executeTx()  │ │ • lookup     │   │
│  │ • contribute │ │                │ │              │   │
│  │ • executeCycle│ └───────┬────────┘ └──────────────┘   │
│  │ • penalize   │         │                              │
│  │ • returnDeps │         ▼                              │
│  └──────────────┘  FlowTransactionScheduler              │
│                    (auto-execute at deadline)             │
└──────────────────────┬──────────────────────────────────┘
                       │ Receipt CIDs stored on-chain
                       ▼
┌─────────────────────────────────────────────────────────┐
│              STORACHA (IPFS / Filecoin)                   │
│                                                          │
│  Receipt Chain:  CID_n → CID_n-1 → ... → CID_0 (genesis)│
│  Each receipt: { action, actor, timestamp, details,      │
│                  previousReceiptCID, transactionId }      │
└─────────────────────────────────────────────────────────┘
```

### Three Smart Contracts

**ChamaCircle** — The core logic. Creates circle resources, manages member lifecycle (join, seal, contribute), executes payouts via rotation, penalizes delinquent members by slashing deposits, and returns deposits when complete.

**ChamaScheduler** — Implements Flow's `TransactionHandler` interface. Holds a pre-authorized capability to the circle, allowing the Flow protocol to call `executeCycle()` automatically at each deadline without human intervention.

**ChamaManager** — Global registry mapping circle IDs to host addresses and member addresses to their circles. Enables frontend discovery without scanning all accounts on-chain.

### Receipt Chain (Storacha / IPFS)

Every on-chain action (create, join, contribute, payout, penalty) produces a receipt uploaded to IPFS via Storacha. Each receipt includes a `previousReceiptCID` field linking to the prior receipt, forming a tamper-proof linked list. Changing any receipt would break the CID chain downstream — making the audit trail cryptographically verifiable.

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Flow (Testnet) |
| Smart Contracts | Cadence |
| Scheduled Execution | FlowTransactionScheduler |
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Wallet Integration | FCL (Flow Client Library) |
| Receipt Storage | Storacha (IPFS + Filecoin) |
| Receipt Format | JSON with CID-linked chain |

## Project Structure

```
Chama/
├── cadence/
│   ├── contracts/
│   │   ├── ChamaCircle.cdc        # Core savings circle logic
│   │   ├── ChamaScheduler.cdc     # Scheduled transaction handler
│   │   └── ChamaManager.cdc       # Global circle registry
│   ├── transactions/
│   │   ├── CreateCircle.cdc        # Create a new circle
│   │   ├── JoinCircle.cdc          # Join an existing circle
│   │   ├── Contribute.cdc          # Make a contribution
│   │   ├── InitHandler.cdc         # Initialize scheduler handler
│   │   └── ScheduleNextCycle.cdc   # Register with FlowTransactionScheduler
│   ├── scripts/                    # Read-only Cadence queries
│   └── tests/                      # Cadence test suite
├── src/
│   ├── app/
│   │   ├── page.tsx                # Dashboard — your circles overview
│   │   ├── create/page.tsx         # Create a new circle
│   │   ├── join/page.tsx           # Search and join circles
│   │   ├── circle/[id]/page.tsx    # Circle detail — contribute, view members
│   │   ├── history/page.tsx        # IPFS receipt chain viewer
│   │   ├── layout.tsx              # Root layout (dark theme)
│   │   └── globals.css             # Global styles
│   ├── components/
│   │   ├── Navbar.tsx              # Navigation with wallet connect
│   │   └── TransactionToast.tsx    # TX lifecycle notifications
│   ├── hooks/
│   │   └── useCurrentUser.ts       # FCL current user hook
│   └── lib/
│       ├── flow-config.ts          # FCL configuration (networks, aliases)
│       ├── storacha-client.ts      # Storacha/IPFS client
│       └── receipt-service.ts      # Receipt upload service
├── scripts/
│   └── auto-commit.sh             # Auto-commit with conventional messages
├── flow.json                       # Flow project config
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- Flow CLI (`brew install flow-cli`)
- A Flow wallet (Flow Wallet extension or Blocto)

### Run Locally

```bash
# Install dependencies
npm install

# Start the dev server (connects to testnet by default)
npm run dev
```

The app runs at `http://localhost:3000`.

### Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_FLOW_NETWORK=testnet
# Optional: Get a free project ID at https://cloud.walletconnect.com
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

### Run Against Local Emulator

```bash
# Start emulator + deploy contracts + dev wallet (all in one)
npm run chain

# In another terminal
NEXT_PUBLIC_FLOW_NETWORK=emulator npm run dev
```

## Testnet Deployment

All three contracts are deployed to testnet at:

```
Account: 0x4648c731f1777d9d
Contracts: ChamaCircle, ChamaScheduler, ChamaManager
```

## How the Payout Works

When all members contribute for a cycle, the frontend automatically triggers `executeCycle()`:

1. **Penalize** — Members who didn't contribute get their deposit slashed (penalty % configured at creation)
2. **Identify recipient** — Rotation by join order: cycle 1 → member 0, cycle 2 → member 1, etc.
3. **Transfer pool** — Entire pool (contributions + penalties) sent to recipient's Flow account
4. **Reset** — Contribution flags cleared, cycle counter advanced
5. **Complete or continue** — If all cycles done, return deposits. Otherwise, set new deadline.

The `executeCycle()` function is `access(all)` — anyone can call it. The smart contract enforces all rules regardless of who triggers it.

## License

MIT
