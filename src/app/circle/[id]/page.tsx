// =============================================================================
// circle/[id]/page.tsx — Circle detail page with members, contributions, actions
// =============================================================================
//
// PURPOSE:
//   Shows everything about a specific circle:
//   - Header: name, status badge, cycle progress
//   - Countdown timer to next payout deadline
//   - Members list with contribution status per cycle
//   - Action buttons: Join, Contribute, View Receipts
//   - Payout history (which member received in which cycle)
//
// ROUTE:
//   /circle/[id] where [id] is the circle's UInt64 ID (e.g., /circle/1)
//   Next.js extracts the ID via params.id (dynamic route segment).
//
// DATA FLOW:
//   1. Extract circleId from URL params
//   2. Query ChamaManager.getCircleHost(id) → host address
//   3. Query ChamaCircle.getState(host, id) → full state
//   4. Render based on status (FORMING → show join, ACTIVE → show contribute)
//   5. Auto-refresh every 10 seconds to pick up new contributions
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { useTransactionToast } from '@/components/TransactionToast';

// =============================================================================
// Cadence Scripts
// =============================================================================

const GET_CIRCLE_HOST_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(circleId: UInt64): Address? {
    return ChamaManager.getCircleHost(circleId: circleId)
}
`;

const GET_CIRCLE_STATE_SCRIPT = `
import ChamaCircle from 0xChamaCircle

access(all) fun main(hostAddress: Address, circleId: UInt64): AnyStruct {
    let host = getAccount(hostAddress)
    let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
        ?? panic("Could not construct public path")
    let circleRef = host.capabilities
        .borrow<&ChamaCircle.Circle>(publicPath)
        ?? panic("Could not borrow Circle")
    return circleRef.getState()
}
`;

// =============================================================================
// Cadence Transactions
// =============================================================================

const JOIN_CIRCLE_TX = `
import ChamaCircle from 0xChamaCircle
import ChamaManager from 0xChamaManager
import FungibleToken from 0xFungibleToken
import FlowToken from 0xFlowToken

transaction(hostAddress: Address, circleId: UInt64) {
    prepare(signer: auth(Storage) &Account) {
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")
        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle")

        let state = circleRef.getState()
        let depositAmount = state.config.contributionAmount

        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault")
        let deposit <- vaultRef.withdraw(amount: depositAmount) as! @FlowToken.Vault

        circleRef.join(member: signer.address, deposit: <- deposit)
        ChamaManager.registerMember(circleId: circleId, member: signer.address)
    }
}
`;

const CONTRIBUTE_TX = `
import ChamaCircle from 0xChamaCircle
import FungibleToken from 0xFungibleToken
import FlowToken from 0xFlowToken

transaction(hostAddress: Address, circleId: UInt64) {
    prepare(signer: auth(Storage) &Account) {
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")
        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle")

        let state = circleRef.getState()
        let amount = state.config.contributionAmount

        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault")
        let payment <- vaultRef.withdraw(amount: amount) as! @FlowToken.Vault

        circleRef.contribute(member: signer.address, payment: <- payment)
    }
}
`;

// =============================================================================
// Types
// =============================================================================

interface MemberData {
  address: string;
  hasContributed: boolean;
  totalContributed: string;
  isDelinquent: boolean;
  delinquencyCount: string;
  rotationPosition: string;
}

interface CircleData {
  circleId: string;
  config: {
    name: string;
    contributionAmount: string;
    cycleDuration: string;
    maxMembers: string;
    penaltyPercent: string;
  };
  status: { rawValue: string };
  currentCycle: string;
  members: MemberData[];
  poolBalance: string;
  nextDeadline: string;
  nextRecipient: string | null;
  latestReceiptCID: string;
}

// =============================================================================
// Helpers
// =============================================================================

const STATUS_LABELS: Record<string, string> = {
  '0': 'Forming', '1': 'Active', '2': 'Completed', '3': 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  '0': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  '1': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  '2': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  '3': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// =============================================================================
// Countdown Hook
// =============================================================================
//
// Formats seconds remaining until deadline as "Xm Ys" or "EXPIRED".
// Updates every second via setInterval.
function useCountdown(deadlineTimestamp: number): string {
  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(interval);
  }, []);

  if (deadlineTimestamp <= 0) return '--';

  const remaining = deadlineTimestamp - now;
  if (remaining <= 0) return 'EXPIRED';

  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);

  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  return `${minutes}m ${seconds}s`;
}

// =============================================================================
// Component
// =============================================================================

export default function CircleDetailPage() {
  const params = useParams();
  const circleId = params.id as string;
  const { user } = useCurrentUser();

  const [circle, setCircle] = useState<CircleData | null>(null);
  const [hostAddress, setHostAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Countdown to next deadline ──
  const countdown = useCountdown(
    circle ? parseFloat(circle.nextDeadline) : 0
  );

  // -------------------------------------------------------------------------
  // Fetch circle state
  // -------------------------------------------------------------------------
  const fetchCircle = useCallback(async () => {
    try {
      const host: string | null = await fcl.query({
        cadence: GET_CIRCLE_HOST_SCRIPT,
        args: (arg: any, t: any) => [arg(circleId, t.UInt64)],
      });

      if (!host) {
        setError('Circle not found.');
        setLoading(false);
        return;
      }

      setHostAddress(host);

      const state: CircleData = await fcl.query({
        cadence: GET_CIRCLE_STATE_SCRIPT,
        args: (arg: any, t: any) => [
          arg(host, t.Address),
          arg(circleId, t.UInt64),
        ],
      });

      setCircle(state);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch circle:', err);
      setError('Failed to load circle data.');
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  // ── Auto-fetch + refresh every 10 seconds ──
  useEffect(() => {
    fetchCircle();
    const interval = setInterval(fetchCircle, 10000);
    return () => clearInterval(interval);
  }, [fetchCircle]);

  // -------------------------------------------------------------------------
  // Actions: Join + Contribute
  // -------------------------------------------------------------------------
  async function handleJoin() {
    if (!hostAddress) return;
    setActionLoading(true);
    setError(null);
    try {
      const txId = await fcl.mutate({
        cadence: JOIN_CIRCLE_TX,
        args: (arg: any, t: any) => [
          arg(hostAddress, t.Address),
          arg(circleId, t.UInt64),
        ],
        proposer: fcl.currentUser,
        payer: fcl.currentUser,
        authorizations: [fcl.currentUser],
        limit: 9999,
      });
      await fcl.tx(txId).onceSealed();
      await fetchCircle();
    } catch (err: any) {
      setError(err?.message || 'Join failed.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleContribute() {
    if (!hostAddress) return;
    setActionLoading(true);
    setError(null);
    try {
      const txId = await fcl.mutate({
        cadence: CONTRIBUTE_TX,
        args: (arg: any, t: any) => [
          arg(hostAddress, t.Address),
          arg(circleId, t.UInt64),
        ],
        proposer: fcl.currentUser,
        payer: fcl.currentUser,
        authorizations: [fcl.currentUser],
        limit: 9999,
      });
      await fcl.tx(txId).onceSealed();
      await fetchCircle();
    } catch (err: any) {
      setError(err?.message || 'Contribution failed.');
    } finally {
      setActionLoading(false);
    }
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-emerald-600" />
      </div>
    );
  }

  if (error && !circle) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-emerald-600 underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!circle) return null;

  const statusRaw = circle.status.rawValue;
  const isForming = statusRaw === '0';
  const isActive = statusRaw === '1';
  const isCompleted = statusRaw === '2';

  // Check if current user is a member and if they've contributed this cycle
  const currentMember = circle.members.find(
    (m) => m.address === user.addr
  );
  const isMember = !!currentMember;
  const hasContributed = currentMember?.hasContributed ?? false;

  // Can the user join? (forming + not already a member + wallet connected)
  const canJoin = isForming && !isMember && user.loggedIn;

  // Can the user contribute? (active + is member + hasn't contributed yet)
  const canContribute = isActive && isMember && !hasContributed;

  return (
    <div className="mx-auto max-w-3xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            &larr; Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {circle.config.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Circle #{circle.circleId}
          </p>
        </div>
        <span className={`mt-1 rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[statusRaw]}`}>
          {STATUS_LABELS[statusRaw]}
        </span>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── Stats Grid ── */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Contribution', value: `${parseFloat(circle.config.contributionAmount).toFixed(2)} FLOW` },
          { label: 'Pool Balance', value: `${parseFloat(circle.poolBalance).toFixed(2)} FLOW` },
          { label: 'Cycle', value: `${circle.currentCycle}/${circle.config.maxMembers}` },
          { label: 'Next Payout', value: isActive ? countdown : '--' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-500">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Current Recipient Banner ── */}
      {isActive && circle.nextRecipient && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            <span className="font-medium">Payout recipient this cycle:</span>{' '}
            <span className="font-mono">{truncateAddress(circle.nextRecipient)}</span>
            {circle.nextRecipient === user.addr && (
              <span className="ml-2 rounded bg-emerald-200 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200">
                You!
              </span>
            )}
          </p>
        </div>
      )}

      {/* ── Action Buttons ── */}
      <div className="mt-6 flex gap-3">
        {canJoin && (
          <button
            onClick={handleJoin}
            disabled={actionLoading}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {actionLoading ? 'Joining...' : `Join Circle (${parseFloat(circle.config.contributionAmount).toFixed(2)} FLOW deposit)`}
          </button>
        )}

        {canContribute && (
          <button
            onClick={handleContribute}
            disabled={actionLoading}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {actionLoading ? 'Contributing...' : `Contribute ${parseFloat(circle.config.contributionAmount).toFixed(2)} FLOW`}
          </button>
        )}

        {isMember && hasContributed && isActive && (
          <div className="flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Contributed this cycle
          </div>
        )}

        {isCompleted && (
          <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Circle completed — deposits returned
          </div>
        )}
      </div>

      {/* ── Members List ── */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Members ({circle.members.length}/{circle.config.maxMembers})
        </h2>

        <div className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {circle.members.map((member, i) => (
            <div key={member.address} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Position number */}
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {i + 1}
                </span>

                {/* Address + status indicators */}
                <div>
                  <p className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                    {truncateAddress(member.address)}
                    {member.address === user.addr && (
                      <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Total: {parseFloat(member.totalContributed).toFixed(2)} FLOW
                    {member.isDelinquent && (
                      <span className="ml-2 text-red-500">
                        {parseInt(member.delinquencyCount)}x missed
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Contribution status for current cycle */}
              <div>
                {isActive && (
                  member.hasContributed ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                      Paid
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                      Pending
                    </span>
                  )
                )}
                {member.isDelinquent && (
                  <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                    Delinquent
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Empty slots for forming circles */}
          {isForming &&
            Array.from({ length: parseInt(circle.config.maxMembers) - circle.members.length }).map((_, i) => (
              <div key={`empty-${i}`} className="flex items-center gap-3 px-4 py-3 text-zinc-400 dark:text-zinc-600">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-zinc-300 text-xs dark:border-zinc-700">
                  {circle.members.length + i + 1}
                </span>
                <span className="text-sm italic">Waiting for member...</span>
              </div>
            ))}
        </div>
      </div>

      {/* ── Circle Config Details ── */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Configuration</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <div className="text-zinc-500">Penalty per miss:</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-100">{circle.config.penaltyPercent}%</div>
          <div className="text-zinc-500">Cycle duration:</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-100">{parseFloat(circle.config.cycleDuration).toFixed(0)}s</div>
          <div className="text-zinc-500">Each payout:</div>
          <div className="font-medium text-emerald-700 dark:text-emerald-400">
            {(parseFloat(circle.config.contributionAmount) * parseInt(circle.config.maxMembers)).toFixed(2)} FLOW
          </div>
          {circle.latestReceiptCID && (
            <>
              <div className="text-zinc-500">Latest receipt:</div>
              <a
                href={`https://${circle.latestReceiptCID}.ipfs.w3s.link`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-emerald-600 underline hover:text-emerald-700 dark:text-emerald-400"
              >
                {circle.latestReceiptCID.slice(0, 20)}...
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
