// =============================================================================
// join/page.tsx — Join an existing circle by ID
// =============================================================================
//
// PURPOSE:
//   Allows users to join a circle they don't own. The creator shares the
//   circle ID (e.g., "Circle #3") and this page lets others search for it,
//   see its details, and join with a single button click.
//
// WHY A SEPARATE PAGE (not just the Detail page Join button)?
//   The Detail page requires knowing the URL (/circle/3). This page provides
//   a dedicated entry point where users type an ID or paste a link. It's the
//   "I got invited to a circle" flow.
//
// FLOW:
//   1. User types a circle ID → clicks "Search"
//   2. We query ChamaManager for the host + circle state
//   3. Show circle info: name, contribution, members, status
//   4. If FORMING and user not already a member → show Join button
//   5. Join sends the JoinCircle transaction (same as Detail page)
//   6. On success → redirect to /circle/[id]
// =============================================================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';

// =============================================================================
// Cadence Scripts & Transactions
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

// =============================================================================
// Types
// =============================================================================

interface CirclePreview {
  circleId: string;
  config: {
    name: string;
    contributionAmount: string;
    cycleDuration: string;
    maxMembers: string;
    penaltyPercent: string;
  };
  status: { rawValue: string };
  members: Array<{ address: string }>;
  poolBalance: string;
}

const STATUS_LABELS: Record<string, string> = {
  '0': 'Forming', '1': 'Active', '2': 'Completed', '3': 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  '0': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  '1': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  '2': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  '3': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

// =============================================================================
// Component
// =============================================================================

export default function JoinCirclePage() {
  const router = useRouter();
  const { user } = useCurrentUser();

  // ── Search state ──
  const [circleIdInput, setCircleIdInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Found circle preview ──
  const [preview, setPreview] = useState<CirclePreview | null>(null);
  const [hostAddress, setHostAddress] = useState<string | null>(null);

  // ── Join transaction state ──
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Search for a circle by ID
  // -------------------------------------------------------------------------
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    setPreview(null);
    setHostAddress(null);
    setJoinError(null);

    const id = circleIdInput.trim();
    if (!id || isNaN(parseInt(id))) {
      setSearchError('Please enter a valid circle ID (a number).');
      return;
    }

    setSearching(true);
    try {
      const host: string | null = await fcl.query({
        cadence: GET_CIRCLE_HOST_SCRIPT,
        args: (arg: any, t: any) => [arg(id, t.UInt64)],
      });

      if (!host) {
        setSearchError(`Circle #${id} not found. Check the ID and try again.`);
        setSearching(false);
        return;
      }

      setHostAddress(host);

      const state: CirclePreview = await fcl.query({
        cadence: GET_CIRCLE_STATE_SCRIPT,
        args: (arg: any, t: any) => [
          arg(host, t.Address),
          arg(id, t.UInt64),
        ],
      });

      setPreview(state);
    } catch (err) {
      console.error('Circle search failed:', err);
      setSearchError('Failed to look up circle. Check your connection.');
    } finally {
      setSearching(false);
    }
  }

  // -------------------------------------------------------------------------
  // Join the found circle
  // -------------------------------------------------------------------------
  async function handleJoin() {
    if (!hostAddress || !preview) return;
    setJoining(true);
    setJoinError(null);

    try {
      const txId = await fcl.mutate({
        cadence: JOIN_CIRCLE_TX,
        args: (arg: any, t: any) => [
          arg(hostAddress, t.Address),
          arg(preview.circleId, t.UInt64),
        ],
        proposer: fcl.currentUser,
        payer: fcl.currentUser,
        authorizations: [fcl.currentUser],
        limit: 9999,
      });
      await fcl.tx(txId).onceSealed();
      router.push(`/circle/${preview.circleId}`);
    } catch (err: any) {
      console.error('Join failed:', err);
      setJoinError(err?.message || 'Failed to join circle.');
    } finally {
      setJoining(false);
    }
  }

  // =========================================================================
  // Derived state
  // =========================================================================
  const isForming = preview?.status.rawValue === '0';
  const isMember = preview?.members.some((m) => m.address === user.addr) ?? false;
  const isFull = preview
    ? preview.members.length >= parseInt(preview.config.maxMembers)
    : false;
  const canJoin = isForming && !isMember && !isFull && user.loggedIn;

  // =========================================================================
  // RENDER
  // =========================================================================

  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Join a Circle
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Connect your wallet to search for and join savings circles.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Join a Circle
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Enter a circle ID shared by the creator to view its details and join.
      </p>

      {/* ── Search Form ── */}
      <form onSubmit={handleSearch} className="mt-6 flex gap-3">
        <input
          type="text"
          value={circleIdInput}
          onChange={(e) => setCircleIdInput(e.target.value)}
          placeholder="Circle ID (e.g., 1)"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600"
          disabled={searching}
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* ── Search Error ── */}
      {searchError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {searchError}
        </div>
      )}

      {/* ── Circle Preview Card ── */}
      {preview && (
        <div className="mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          {/* Name + Status */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {preview.config.name}
              </h2>
              <p className="text-sm text-zinc-500">Circle #{preview.circleId}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[preview.status.rawValue]}`}>
              {STATUS_LABELS[preview.status.rawValue]}
            </span>
          </div>

          {/* Stats */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-zinc-500">Contribution</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                {parseFloat(preview.config.contributionAmount).toFixed(2)} FLOW
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Members</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                {preview.members.length}/{preview.config.maxMembers}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Cycle Duration</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                {parseFloat(preview.config.cycleDuration).toFixed(0)}s
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Penalty</p>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                {preview.config.penaltyPercent}%
              </p>
            </div>
          </div>

          {/* Security deposit info */}
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Joining requires a security deposit of{' '}
            <span className="font-semibold">
              {parseFloat(preview.config.contributionAmount).toFixed(2)} FLOW
            </span>{' '}
            (equal to one contribution). This is returned when the circle completes.
          </div>

          {/* Join Error */}
          {joinError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              {joinError}
            </div>
          )}

          {/* Action area */}
          <div className="mt-4">
            {canJoin && (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {joining ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Joining...
                  </span>
                ) : (
                  `Join Circle & Pay ${parseFloat(preview.config.contributionAmount).toFixed(2)} FLOW Deposit`
                )}
              </button>
            )}

            {isMember && (
              <Link
                href={`/circle/${preview.circleId}`}
                className="block w-full rounded-lg border border-emerald-300 py-3 text-center text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
              >
                You&apos;re already a member — View Circle
              </Link>
            )}

            {!isForming && !isMember && (
              <p className="text-center text-sm text-zinc-500">
                This circle is no longer accepting members ({STATUS_LABELS[preview.status.rawValue]}).
              </p>
            )}

            {isForming && isFull && !isMember && (
              <p className="text-center text-sm text-zinc-500">
                This circle is full ({preview.members.length}/{preview.config.maxMembers} members).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
