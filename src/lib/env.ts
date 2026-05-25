// =============================================================================
// env.ts — Centralized environment parsing and validation
// =============================================================================

type FlowNetwork = 'emulator' | 'testnet' | 'mainnet';

function readString(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readInt(name: string, fallback: number): number {
  const raw = readString(name);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validateFlowNetwork(value: string | undefined): FlowNetwork {
  if (!value) return 'emulator';
  if (value === 'emulator' || value === 'testnet' || value === 'mainnet') {
    return value;
  }
  throw new Error(
    `Invalid NEXT_PUBLIC_FLOW_NETWORK "${value}". Expected one of: emulator, testnet, mainnet.`,
  );
}

const flowNetwork = validateFlowNetwork(readString('NEXT_PUBLIC_FLOW_NETWORK'));

const publicAdminAddress = readString('NEXT_PUBLIC_FLOW_ADMIN_ADDRESS');
const publicAdminKeyIndex = readInt('NEXT_PUBLIC_FLOW_ADMIN_KEY_INDEX', 0);
const magicApiKey = readString('NEXT_PUBLIC_MAGIC_API_KEY');
const walletConnectProjectId = readString('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');

const serverAdminAddress = readString('FLOW_ADMIN_ADDRESS');
const serverAdminPrivateKey = readString('FLOW_ADMIN_PRIVATE_KEY');
const serverAdminKeyIndex = readInt('FLOW_ADMIN_KEY_INDEX', 0);

const storachaKey = readString('STORACHA_KEY');
const storachaProof = readString('STORACHA_PROOF');
const storachaSpaceDid = readString('STORACHA_SPACE_DID');

function assertServerEnvConsistency() {
  const adminFields = [serverAdminAddress, serverAdminPrivateKey];
  const hasPartialAdmin = adminFields.some(Boolean) && !adminFields.every(Boolean);
  if (hasPartialAdmin) {
    throw new Error(
      'Incomplete payer configuration. Set both FLOW_ADMIN_ADDRESS and FLOW_ADMIN_PRIVATE_KEY, or neither.',
    );
  }

  const storachaFields = [storachaKey, storachaProof, storachaSpaceDid];
  const hasPartialStoracha = storachaFields.some(Boolean) && !storachaFields.every(Boolean);
  if (hasPartialStoracha) {
    throw new Error(
      'Incomplete Storacha configuration. Set STORACHA_KEY, STORACHA_PROOF, and STORACHA_SPACE_DID together.',
    );
  }
}

function assertClientEnvConsistency() {
  if (typeof window === 'undefined') return;

  if (publicAdminAddress && !/^0x[0-9a-fA-F]{16}$/.test(publicAdminAddress)) {
    throw new Error(
      `Invalid NEXT_PUBLIC_FLOW_ADMIN_ADDRESS "${publicAdminAddress}". Expected a Flow address like 0x1234abcd....`,
    );
  }
}

export const publicEnv = {
  flowNetwork,
  magicApiKey,
  walletConnectProjectId,
  flowAdminAddress: publicAdminAddress,
  flowAdminKeyIndex: publicAdminKeyIndex,
} as const;

export const serverEnv = {
  flowAdminAddress: serverAdminAddress,
  flowAdminPrivateKey: serverAdminPrivateKey,
  flowAdminKeyIndex: serverAdminKeyIndex,
  storachaKey,
  storachaProof,
  storachaSpaceDid,
} as const;

assertServerEnvConsistency();
assertClientEnvConsistency();

export function isGasSponsorshipConfigured(): boolean {
  return Boolean(serverEnv.flowAdminAddress && serverEnv.flowAdminPrivateKey);
}

export function isReceiptStorageConfigured(): boolean {
  return Boolean(serverEnv.storachaKey && serverEnv.storachaProof && serverEnv.storachaSpaceDid);
}
