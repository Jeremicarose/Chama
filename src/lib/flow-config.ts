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
    ChamaCircle: '0xCHAMA_TESTNET',    // TODO: Replace after testnet deployment
    ChamaScheduler: '0xCHAMA_TESTNET',
    ChamaManager: '0xCHAMA_TESTNET',
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
  );

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
