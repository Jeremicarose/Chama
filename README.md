# Chama — Trustless Rotating Savings Circles on Flow

> *In communities across Africa, Asia, and Latin America, millions of people save money together through rotating savings circles — known as "chamas" in Kenya, "tandas" in Mexico, "susus" in West Africa. Each month, everyone contributes, and one person takes home the full pot. It's mutual aid powered by trust.*
>
> *But trust breaks down. Leaders disappear with funds. Members skip payments. There's no enforcement, no transparency, no recourse. Billions of dollars flow through these informal circles every year with zero protection.*
>
> **Chama puts the entire savings circle on-chain — every contribution, every payout, every penalty enforced by smart contracts. The code is the middleman.**

**Built for the PL Genesis Hackathon 2026.**

**[Live Demo](https://chama-eosin.vercel.app)** | **[Testnet Contracts](https://testnet.flowscan.io/account/0x4648c731f1777d9d)**

---

## The Problem

Traditional savings circles (ROSCAs) move **billions of dollars annually** across developing economies, yet they run entirely on trust:

| The Problem | The Reality |
|---|---|
| Group leaders hold all funds | No accountability — they can vanish |
| Payments tracked on paper | Disputes with no resolution |
| No penalty for skipping | Free-riders destroy the circle |
| No transparency | Members can't verify the math |
| Limited to your village | Can't form circles with strangers |

People who depend on these circles the most — low-income communities, migrant workers, small business owners — are the ones hurt worst when trust fails.

## The Solution

Chama replaces trust with code. Three smart contracts on Flow handle the entire lifecycle of a savings circle:

```
1. SIGN IN  — Enter your email (no wallet extension needed)
2. CREATE   — Set the rules (contribution amount, cycle duration, members)
3. JOIN     — Members join by paying a security deposit
4. SEAL     — Circle activates when all slots fill
5. CYCLE    — Each round: everyone contributes → one member gets the full payout
6. ROTATE   — Payout recipient rotates each cycle (join order)
7. DONE     — After all cycles, deposits are returned automatically
```

Every step is enforced on-chain. Miss a payment? Your deposit gets slashed automatically. Try to take the pot and run? Impossible — the smart contract controls all funds. Want to verify? Every action has a Flowscan link.

## Why This Matters: Consumer DeFi

Here's the key insight: **the people who need this most have never touched crypto.** So we built Chama to feel like a normal fintech app, not a crypto dApp:

| Crypto Problem | Chama Solution |
|---|---|
| "Install MetaMask" | Sign in with your email via Magic.link |
| "Approve transaction — Gas: 0.002 ETH" | Zero gas fees — server-side sponsorship |
| "Connect wallet to dApp" | No wallet needed, ever |
| "Sign this hex payload" | "Contribute" button, one click |
| "Check Etherscan for TX status" | Real-time toast notifications + Flowscan links |
| "What's my reputation?" | On-chain trust scores computed from history |

**The blockchain is invisible.** Users see "Contribute 100 FLOW" — not "Approve ERC-20 transfer of 100000000000000000 wei to contract 0x7a3f...". That's the difference between a product and a proof of concept.

## Features

- **Walletless onboarding** — Email sign-in via Magic.link. No browser extensions, no seed phrases, no hex addresses.
- **Sponsored gas** — Users never see or pay transaction fees. A server-side admin account pays gas on every transaction.
- **Automatic payouts** — When all members contribute, the smart contract distributes the full pool to the next recipient instantly.
- **Deposit slashing** — Miss a payment? Your security deposit gets penalized automatically. No arguments, no excuses.
- **Force execution** — If someone ghosts after the grace period, any member can trigger the payout and penalize non-payers.
- **Payout notifications** — Real-time toast showing who received how much, persistent payout history, and a "You received" congratulations banner.
- **On-chain reputation** — Four trust dimensions (Consistency, Reliability, Experience, Standing) computed from contribution history. Your track record follows you.
- **Achievement badges** — 12 unlockable badges for milestones (First Circle, Perfect Record, Veteran, etc.).
- **Fiat conversion** — Live FLOW/USD prices so users see real money values, not just token amounts.
- **Full audit trail** — Every action recorded on-chain. Every transaction linked to Flowscan. Complete transparency.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js 16)                   │
│  Dashboard │ Create │ Join │ Circle Detail │ History        │
│  Badges │ Reputation │ Payout Notifications                 │
│                                                             │
│  Magic.link (email auth) ←→ FCL (Flow Client Library)      │
└──────────────────────┬──────────────────────────────────────┘
                       │ Cadence transactions & scripts
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  FLOW BLOCKCHAIN (Testnet)                   │
│                                                             │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐    │
│  │ ChamaCircle  │  │ ChamaScheduler │  │ ChamaManager │    │
│  │              │  │                │  │              │    │
│  │ • createCircle│  │ • TransHandler │  │ • registry   │    │
│  │ • join       │  │ • executeTx()  │  │ • lookup     │    │
│  │ • contribute │  │                │  │              │    │
│  │ • executeCycle│  └────────────────┘  └──────────────┘    │
│  │ • penalize   │                                           │
│  │ • returnDeps │                                           │
│  └──────────────┘                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               SERVER-SIDE GAS SPONSORSHIP                   │
│                                                             │
│  /api/sign-as-payer — Signs transaction envelopes as payer  │
│  role using admin private key (ECDSA_P256 + SHA3-256).      │
│  Users sign the action, admin pays the gas. Zero cost.      │
└─────────────────────────────────────────────────────────────┘
```

### Three Smart Contracts

**ChamaCircle** — The core engine. Creates circle resources, manages the full member lifecycle (join → seal → contribute → payout → complete), enforces contribution rules, executes rotating payouts, slashes deposits for delinquent members, and returns deposits when all cycles finish. The `executeCycle()` function is `access(all)` — anyone can call it, and the contract enforces all rules regardless of who triggers it.

**ChamaScheduler** — Implements Flow's `TransactionHandler` interface. Holds a pre-authorized capability to the circle, enabling the Flow protocol to call `executeCycle()` automatically at scheduled deadlines.

**ChamaManager** — Global registry mapping circle IDs to host addresses and member addresses to their circles. This is what lets the frontend discover circles without scanning every account on-chain.

## How the Payout Works

Payouts are **contribution-driven** — each cycle waits for all members to contribute, then executes automatically:

```
          ┌──────────────┐
          │  Cycle Start │
          └──────┬───────┘
                 ▼
     ┌───────────────────────┐
     │  Members contribute   │  ← Each sends their share (e.g. 100 FLOW)
     │  one by one           │
     └───────────┬───────────┘
                 ▼
        ┌────────────────┐        ┌──────────────────────┐
        │ All contributed?├──No──►│ Grace period (3x dur) │
        └───────┬────────┘        └──────────┬───────────┘
                │ Yes                        │ Expired
                ▼                            ▼
     ┌──────────────────┐        ┌───────────────────────┐
     │  AUTO-EXECUTE    │        │ FORCE EXECUTE         │
     │  Payout fires    │        │ Any member triggers   │
     │  instantly       │        │ Non-payers penalized  │
     └───────┬──────────┘        └───────────┬───────────┘
             │                               │
             └───────────┬───────────────────┘
                         ▼
              ┌──────────────────┐
              │ Recipient gets   │  ← Rotation by join order
              │ the full pool    │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐        ┌─────────────────┐
              │ More cycles?     ├──No──►│ Return deposits  │
              └───────┬──────────┘        │ Circle complete  │
                      │ Yes               └─────────────────┘
                      ▼
              ┌──────────────────┐
              │ Next cycle begins│
              └──────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Blockchain | Flow (Testnet) | Resource-oriented model, native scheduled transactions, low fees |
| Smart Contracts | Cadence | Type-safe, resource-based — prevents entire classes of DeFi exploits |
| Frontend | Next.js 16, React 19, Tailwind CSS v4 | Modern stack, server components, fast builds |
| Authentication | Magic.link | Email-based walletless onboarding — zero crypto friction |
| Gas Sponsorship | Server-side payer (ECDSA_P256 + SHA3-256) | Users never pay fees |
| On-chain Events | Flow REST API | Activity feed, payout history, audit trail |
| Wallet Fallback | FCL (Flow Client Library) | For power users who prefer wallet extensions |

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
# Flow network
NEXT_PUBLIC_FLOW_NETWORK=testnet

# Magic.link — get a free key at https://dashboard.magic.link
NEXT_PUBLIC_MAGIC_API_KEY=your_magic_api_key

# Optional: Server-side gas sponsorship
FLOW_ADMIN_ADDRESS=0x...
FLOW_ADMIN_PRIVATE_KEY=...
FLOW_ADMIN_KEY_INDEX=0
```

### Deploy

```bash
vercel --prod
```

## Testnet Deployment

All three contracts are live on Flow testnet:

```
Account:   0x4648c731f1777d9d
Contracts: ChamaCircle, ChamaScheduler, ChamaManager
Explorer:  https://testnet.flowscan.io/account/0x4648c731f1777d9d
```

## Try It Yourself

1. Go to **[chama-eosin.vercel.app](https://chama-eosin.vercel.app)**
2. Sign in with your email (no wallet needed)
3. Create a circle — set contribution amount, cycle duration, and member count
4. Share the circle ID with friends (or use Gmail's `+` trick: `you+test1@gmail.com`, `you+test2@gmail.com`)
5. Each member joins by paying a security deposit
6. Circle seals when all slots fill
7. Everyone contributes each cycle → payout auto-executes to the next recipient
8. After all cycles complete, deposits are returned

**That's it. No MetaMask. No gas fees. No crypto jargon. Just savings.**

## License

MIT
