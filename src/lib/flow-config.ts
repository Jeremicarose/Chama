// =============================================================================
// Flow Client Library (FCL) Configuration for Chama
// =============================================================================
//
// PURPOSE:
//   Configures @onflow/fcl, the JavaScript SDK for interacting with the
//   Flow blockchain. FCL handles wallet discovery, transaction signing,
//   script execution, and event subscription.
//
// ENVIRONMENT STRATEGY:
//   Uses environment variables to switch between emulator, testnet, and
//   mainnet. Defaults to emulator for local development.
//
// NEXT_PUBLIC_ PREFIX:
//   Next.js only exposes env vars to the browser with this prefix. Since
//   FCL runs in the browser (for wallet interactions), all config vars use it.
// =============================================================================

import * as fcl from '@onflow/fcl';

// =============================================================================
// Network Detection
// =============================================================================

const FLOW_NETWORK = process.env.NEXT_PUBLIC_FLOW_NETWORK || 'emulator';

// =============================================================================
// Access Node Configuration
// =============================================================================
//
// Flow's Access node is the "front door" — it accepts client requests
// (send transaction, run script, get events) and routes them internally.
//
// The emulator REST API listens on port 8888. The gRPC endpoint (3569) is
// for flow-cli; FCL uses the REST API.
// =============================================================================

const ACCESS_NODE_MAP: Record<string, string> = {
  emulator: 'http://localhost:8888',
  testnet: 'https://rest-testnet.onflow.org',
  mainnet: 'https://rest-mainnet.onflow.org',
};

// =============================================================================
// Wallet Discovery Configuration
// =============================================================================
//
// When a user clicks "Connect Wallet", FCL uses Discovery to list
// compatible wallets. On emulator, the dev-wallet (port 8701) provides
// pre-funded accounts. On testnet/mainnet, Discovery shows Lilico, Blocto, etc.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Discovery
// ─────────────────────────────────────────────────────────────────────────────
//
// Uses FCL Discovery to show available wallets. On testnet this includes
// Blocto (email signup), Flow Wallet, Dapper, etc. The discovery.authn.include
// config below prioritizes Blocto for walletless onboarding.
//
// NOTE: If Blocto's servers are temporarily down (525/526 SSL errors),
// users can still authenticate via other wallets in the Discovery list.
// ─────────────────────────────────────────────────────────────────────────────
const DISCOVERY_MAP: Record<string, string> = {
  emulator: 'http://localhost:8701/fcl/authn',
  testnet: 'https://fcl-discovery.onflow.org/testnet/authn',
  mainnet: 'https://fcl-discovery.onflow.org/authn',
};

// =============================================================================
// Contract Address Configuration
// =============================================================================
//
// Flow addresses are 16-character hex strings (8 bytes). A single account
// can hold multiple contracts. Our three contracts are all deployed to the
// same account on each network.
// =============================================================================

interface ContractAddresses {
  ChamaCircle: string;
  ChamaScheduler: string;
  ChamaManager: string;
}

const CONTRACT_ADDRESSES: Record<string, ContractAddresses> = {
  emulator: {
    ChamaCircle: '0xf8d6e0586b0a20c7',
    ChamaScheduler: '0xf8d6e0586b0a20c7',
    ChamaManager: '0xf8d6e0586b0a20c7',
  },
  testnet: {
    ChamaCircle: '0x4648c731f1777d9d',
    ChamaScheduler: '0x4648c731f1777d9d',
    ChamaManager: '0x4648c731f1777d9d',
  },
  mainnet: {
    ChamaCircle: '0xCHAMA_MAINNET',    // TODO: Replace after mainnet deployment
    ChamaScheduler: '0xCHAMA_MAINNET',
    ChamaManager: '0xCHAMA_MAINNET',
  },
};

// =============================================================================
// FCL Configuration
// =============================================================================
//
// Config keys:
// - flow.network: Which network we're on (affects address validation, etc.)
// - accessNode.api: REST API endpoint for transactions and scripts
// - discovery.wallet: URL for wallet authentication handshake
// - app.detail.*: Metadata shown in wallet connection dialogs
// - 0xChamaCircle, etc.: Address aliases for Cadence imports
//   (e.g., `import ChamaCircle from 0xChamaCircle` gets substituted at runtime)
// =============================================================================

fcl.config()
  .put('flow.network', FLOW_NETWORK)
  .put('accessNode.api', ACCESS_NODE_MAP[FLOW_NETWORK] || ACCESS_NODE_MAP.emulator)
  .put('discovery.wallet', DISCOVERY_MAP[FLOW_NETWORK] || DISCOVERY_MAP.emulator)
  .put('app.detail.title', 'Chama Savings Circle')
  .put('app.detail.icon', 'https://placekitten.com/g/200/200') // TODO: Replace with actual app icon
  // ─────────────────────────────────────────────────────────────────────────
  // WalletConnect Configuration
  // ─────────────────────────────────────────────────────────────────────────
  //
  // WalletConnect is a protocol that lets mobile/desktop wallets connect to
  // dApps via QR code or deep link. FCL uses it as a transport for wallets
  // like Lilico. Without a projectId, WalletConnect-based wallets won't work.
  //
  // Get a free projectId at: https://cloud.walletconnect.com
  // For development, we use the env var or a placeholder that silences the warning.
  .put('walletconnect.projectId', process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'development')
  // ─────────────────────────────────────────────────────────────────────────
  // Blocto Wallet — Email-Based Onboarding
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Blocto lets users sign up with just an email address — no browser
  // extension or seed phrase. It creates a custodial Flow account behind
  // the scenes. By including Blocto's service address in discovery.authn.include,
  // FCL shows it first (or only) in the wallet selection popup.
  //
  // Service address per network:
  //   Testnet: 0x82ec283f88a62e65
  //   Mainnet: 0xdb6b70764af4ff68
  // ─────────────────────────────────────────────────────────────────────────
  .put('discovery.authn.include', FLOW_NETWORK === 'mainnet'
    ? ['0xdb6b70764af4ff68']
    : FLOW_NETWORK === 'testnet'
      ? ['0x82ec283f88a62e65']
      : [])
  .put(
    '0xChamaCircle',
    CONTRACT_ADDRESSES[FLOW_NETWORK]?.ChamaCircle || CONTRACT_ADDRESSES.emulator.ChamaCircle,
  )
  .put(
    '0xChamaScheduler',
    CONTRACT_ADDRESSES[FLOW_NETWORK]?.ChamaScheduler || CONTRACT_ADDRESSES.emulator.ChamaScheduler,
  )
  .put(
    '0xChamaManager',
    CONTRACT_ADDRESSES[FLOW_NETWORK]?.ChamaManager || CONTRACT_ADDRESSES.emulator.ChamaManager,
  )
  // ─────────────────────────────────────────────────────────────────────────
  // System Contract Aliases
  // ─────────────────────────────────────────────────────────────────────────
  //
  // FungibleToken and FlowToken are pre-deployed system contracts on Flow.
  // Their addresses differ per network. Our Cadence transactions import them
  // as `import FungibleToken from 0xFungibleToken` — FCL substitutes these
  // placeholders at runtime using these config entries.
  //
  // ADDRESSES BY NETWORK:
  //   Emulator:  0xee82856bf20e2aa6 (FungibleToken), 0x0ae53cb6e3f42a79 (FlowToken)
  //   Testnet:   0x9a0766d93b6608b7 (FungibleToken), 0x7e60df042a9c0868 (FlowToken)
  //   Mainnet:   0xf233dcee88fe0abe (FungibleToken), 0x1654653399040a61 (FlowToken)
  //
  // WHY NOT IN CONTRACT_ADDRESSES above?
  //   These are Flow platform contracts, not our custom contracts. Keeping them
  //   separate makes it clear which addresses we control vs. which are standard.
  // ─────────────────────────────────────────────────────────────────────────
  .put('0xFungibleToken', FLOW_NETWORK === 'mainnet'
    ? '0xf233dcee88fe0abe'
    : FLOW_NETWORK === 'testnet'
      ? '0x9a0766d93b6608b7'
      : '0xee82856bf20e2aa6')
  .put('0xFlowToken', FLOW_NETWORK === 'mainnet'
    ? '0x1654653399040a61'
    : FLOW_NETWORK === 'testnet'
      ? '0x7e60df042a9c0868'
      : '0x0ae53cb6e3f42a79')
  // FlowTransactionScheduler — used by InitHandler + ScheduleNextCycle
  .put('0xFlowTransactionScheduler', FLOW_NETWORK === 'mainnet'
    ? '0x8c5303eaa26202d6' // TODO: confirm mainnet address
    : FLOW_NETWORK === 'testnet'
      ? '0x8c5303eaa26202d6'
      : '0x8c5303eaa26202d6');

// =============================================================================
// Exports
// =============================================================================
//
// Re-export fcl so other modules import from this centralized config file
// rather than importing @onflow/fcl directly. This guarantees every module
// gets the configured version.
//
// Usage:
//   import { fcl, FLOW_NETWORK, CONTRACT_ADDRESSES } from '@/lib/flow-config';
// =============================================================================

export { fcl, FLOW_NETWORK, CONTRACT_ADDRESSES };
export type { ContractAddresses };
