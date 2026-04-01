# Chama — Trustless Rotating Savings Circles on Flow

Chama brings the centuries-old tradition of community savings circles (ROSCAs) to the blockchain. Members pool money each cycle, and one person receives the entire pot on a rotating basis — all enforced by smart contracts. No middleman. No trust needed. Just code.

**Built for the PL Genesis Hackathon 2026.**

## How It Works

```
1. SIGN IN  — Enter your email (no wallet extension needed)
2. CREATE   — Set the rules (contribution amount, cycle duration, members)
3. JOIN     — Members join by paying a security deposit
4. SEAL     — Circle activates when all slots fill
5. CYCLE    — Each round: everyone contributes → one member gets the full payout
6. ROTATE   — Payout recipient rotates each cycle (join order)
7. DONE     — After all cycles, deposits are returned automatically
```

### What makes this different from traditional chamas?

| Traditional | Chama on Flow |
|---|---|
| Trust the group leader | Smart contract holds all funds |
| Manual collection | Automatic contributions |
| No enforcement | Penalties enforced by code (deposit slashing) |
| Need a wallet extension | Sign in with email (Magic.link) |
| Users pay gas fees | Gas fees sponsored by the app |
| No audit trail | Every action recorded on-chain with Flowscan links |
| Easy to cheat | Cryptographically impossible to cheat |

## Consumer DeFi Features

Chama is designed to feel like a **normal fintech app**, not a crypto dApp:

- **Walletless onboarding** — Sign up with email via Magic.link. No browser extension, no seed phrases, no hex addresses to understand.
- **Sponsored gas** — Users never see or pay transaction fees. A server-side admin account pays gas on behalf of users.
- **Human language** — No "wallet", "transaction", or "approve in wallet" jargon. Just "Sign in", "Contribute", and "Confirm".
- **Automatic execution** — Payouts execute automatically when all members contribute. No manual triggers needed.
- **Payout notifications** — Real-time toast notifications showing who received how much, persistent payout history with Flowscan links, and a "You received" congratulations banner.
- **Reputation system** — On-chain trust scores (Consistency, Reliability, Experience, Standing) computed from contribution history.
- **Achievement badges** — 12 unlockable badges for milestones (First Circle, Perfect Record, etc.).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 16)                   │
│  Dashboard │ Create │ Join │ Circle Detail │ History       │
│  Badges │ Reputation │ Payout Notifications                │
│                                                           │
│  Magic.link (email auth) ←→ FCL (Flow Client Library)     │
└──────────────────────┬────────────────────────────────────┘
                       │ Cadence transactions & scripts
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  FLOW BLOCKCHAIN (Testnet)                 │
│                                                           │
│  ┌──────────────┐ ┌────────────────┐ ┌──────────────┐    │
│  │ ChamaCircle  │ │ ChamaScheduler │ │ ChamaManager │    │
│  │              │ │                │ │              │    │
│  │ • createCircle│ │ • TransHandler │ │ • registry   │    │
│  │ • join       │ │ • executeTx()  │ │ • lookup     │    │
│  │ • contribute │ │                │ │              │    │
│  │ • executeCycle│ └────────────────┘ └──────────────┘    │
│  │ • penalize   │                                        │
│  │ • returnDeps │                                        │
│  └──────────────┘                                        │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              SERVER-SIDE GAS SPONSORSHIP                   │
│                                                           │
│  /api/sign-as-payer — Signs transaction envelopes as      │
│  payer role using admin private key (ECDSA_P256 + SHA3)   │
│  Users sign the action, admin pays the gas. Zero cost.    │
└─────────────────────────────────────────────────────────┘
```

### Three Smart Contracts

**ChamaCircle** — The core logic. Creates circle resources, manages member lifecycle (join, seal, contribute), executes payouts via rotation, penalizes delinquent members by slashing deposits, and returns deposits when complete.

**ChamaScheduler** — Implements Flow's `TransactionHandler` interface. Holds a pre-authorized capability to the circle, allowing the Flow protocol to call `executeCycle()` automatically at each deadline.

**ChamaManager** — Global registry mapping circle IDs to host addresses and member addresses to their circles. Enables frontend discovery without scanning all accounts on-chain.

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Flow (Testnet) |
| Smart Contracts | Cadence |
| Frontend | Next.js 16, React 19, Tailwind CSS v4 |
| Authentication | Magic.link (email) + FCL Discovery (wallet fallback) |
| Gas Sponsorship | Server-side payer (ECDSA_P256 + SHA3-256) |
| On-chain Events | Flow REST API (activity feed, payout history) |
| Wallet Integration | FCL (Flow Client Library) |

## Project Structure

```
Chama/
├── cadence/
│   ├── contracts/
│   │   ├── ChamaCircle.cdc          # Core savings circle logic
│   │   ├── ChamaScheduler.cdc       # Scheduled transaction handler
│   │   └── ChamaManager.cdc         # Global circle registry
│   ├── transactions/
│   │   ├── CreateCircle.cdc          # Create a new circle
│   │   ├── JoinCircle.cdc            # Join an existing circle
│   │   ├── Contribute.cdc            # Make a contribution
│   │   ├── InitHandler.cdc           # Initialize scheduler handler
│   │   └── ScheduleNextCycle.cdc     # Register with FlowTransactionScheduler
│   ├── scripts/                      # Read-only Cadence queries
│   └── tests/                        # Cadence test suite
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Dashboard — your circles overview
│   │   ├── create/page.tsx           # Create a new circle
│   │   ├── join/page.tsx             # Search and join circles
│   │   ├── circle/[id]/page.tsx      # Circle detail — contribute, view members
│   │   ├── history/page.tsx          # On-chain event history viewer
│   │   ├── achievements/page.tsx     # Achievement badges gallery
│   │   ├── api/sign-as-payer/route.ts # Server-side gas sponsorship endpoint
│   │   ├── layout.tsx                # Root layout (dark theme)
│   │   └── globals.css               # Global styles
│   ├── components/
│   │   ├── Navbar.tsx                # Navigation with email sign-in
│   │   ├── TransactionToast.tsx      # TX lifecycle notifications
│   │   ├── ActivityFeed.tsx          # On-chain event timeline
│   │   ├── PotGrowth.tsx             # Animated contribution progress
│   │   ├── ReputationCard.tsx        # Trust score display
│   │   ├── AchievementBadge.tsx      # Achievement badge component
│   │   └── FlowProvider.tsx          # FCL configuration provider
│   ├── hooks/
│   │   └── useCurrentUser.ts         # Dual auth hook (Magic + FCL)
│   └── lib/
│       ├── flow-config.ts            # FCL configuration (networks, aliases)
│       ├── flow-events.ts            # On-chain event fetching with caching
│       ├── flow-transaction.ts       # sponsoredMutate() — gas-free transactions
│       ├── magic-auth.ts             # Magic.link email authentication
│       ├── currency.ts               # FLOW price + fiat conversion
│       ├── reputation.ts             # On-chain reputation scoring
│       └── achievements.ts           # Achievement badge logic
├── e2e/
│   └── full-test.spec.ts            # Playwright end-to-end tests
├── scripts/
│   └── auto-commit.sh               # Auto-commit with conventional messages
├── flow.json                         # Flow project config
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- A browser (no wallet extension needed — Magic.link handles auth)

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
# Flow network (testnet recommended for testing)
NEXT_PUBLIC_FLOW_NETWORK=testnet

# Magic.link — Email-based walletless onboarding
# Get a free key at https://dashboard.magic.link
NEXT_PUBLIC_MAGIC_API_KEY=your_magic_api_key

# Optional: Server-side gas sponsorship
# Fund an admin account on testnet via https://faucet.flow.com
FLOW_ADMIN_ADDRESS=0x...
FLOW_ADMIN_PRIVATE_KEY=...
FLOW_ADMIN_KEY_INDEX=0
NEXT_PUBLIC_FLOW_ADMIN_ADDRESS=0x...
NEXT_PUBLIC_FLOW_ADMIN_KEY_INDEX=0
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (sets up project on first run)
vercel

# Production deployment
vercel --prod
```

Add the same environment variables in Vercel's dashboard under Settings > Environment Variables.

## Testnet Deployment

All three contracts are deployed to testnet at:

```
Account: 0x4648c731f1777d9d
Contracts: ChamaCircle, ChamaScheduler, ChamaManager
```

## How the Payout Works

Payouts are **contribution-driven**, not deadline-driven. Each cycle waits for all members to contribute before executing:

1. **Contribute** — Each member sends their contribution (e.g., 100 FLOW)
2. **Auto-execute** — When ALL members have contributed, the payout fires automatically
3. **Penalize** — If someone doesn't contribute within the grace period (3x cycle duration), any member can force-execute, penalizing non-payers
4. **Identify recipient** — Rotation by join order: cycle 1 → member 1, cycle 2 → member 2, etc.
5. **Transfer pool** — Entire pool (contributions + penalties) sent to recipient's Flow account
6. **Notify** — Toast notification + payout history entry with Flowscan link
7. **Reset** — Contribution flags cleared, next cycle begins
8. **Complete or continue** — If all cycles done, return deposits. Otherwise, wait for next round.

The `executeCycle()` function is `access(all)` — anyone can call it. The smart contract enforces all rules regardless of who triggers it.

## Testing with Multiple Accounts

To test the full chama flow, you need multiple Flow accounts (one per member):

1. Sign in with different email addresses (each gets a unique Flow account via Magic.link)
2. Fund each account with testnet FLOW at https://faucet.flow.com
3. Create a circle with one account, join with the others
4. Each member contributes → payout auto-executes

Tip: Use Gmail's `+` trick — `you+test1@gmail.com`, `you+test2@gmail.com`, etc. all route to the same inbox but create separate Flow accounts.

## License

MIT
