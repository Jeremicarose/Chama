// =============================================================================
// join/page.tsx — Join an existing circle by ID
// =============================================================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { useTransactionToast } from '@/components/TransactionToast';

// =============================================================================
// Cadence
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
// Types & Helpers
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

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  '0': { label: 'Forming', color: 'bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20' },
  '1': { label: 'Active', color: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20' },
  '2': { label: 'Completed', color: 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20' },
  '3': { label: 'Cancelled', color: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20' },
};

function fmtFlow(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDuration(seconds: string): string {
  const s = parseFloat(seconds);
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(0)} min`;
  return `${(s / 3600).toFixed(1)} hr`;
}

// =============================================================================
// Component
// =============================================================================

export default function JoinCirclePage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const { showToast, ToastComponent } = useTransactionToast();

  const [circleIdInput, setCircleIdInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [preview, setPreview] = useState<CirclePreview | null>(null);
  const [hostAddress, setHostAddress] = useState<string | null>(null);

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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
        args: (arg: any, t: any) => [arg(host, t.Address), arg(id, t.UInt64)],
      });
      setPreview(state);
    } catch (err) {
      console.error('Circle search failed:', err);
      setSearchError('Failed to look up circle. Check your connection.');
    } finally {
      setSearching(false);
    }
  }

  async function handleJoin() {
    if (!hostAddress || !preview) return;
    setJoining(true);
    setJoinError(null);
    try {
      showToast({ status: 'pending', message: 'Approve the join transaction in your wallet...' });
      const txId = await fcl.mutate({
        cadence: JOIN_CIRCLE_TX,
        args: (arg: any, t: any) => [arg(hostAddress, t.Address), arg(preview.circleId, t.UInt64)],
        proposer: fcl.currentUser, payer: fcl.currentUser,
        authorizations: [fcl.currentUser], limit: 9999,
      });
      showToast({ status: 'sealing', message: 'Joining circle — confirming on-chain...', txId });
      await fcl.tx(txId).onceSealed();
      showToast({ status: 'sealed', message: 'Successfully joined the circle!', txId });
      setTimeout(() => router.push(`/circle/${preview.circleId}`), 1500);
    } catch (err: any) {
      console.error('Join failed:', err);
      showToast({ status: 'error', message: err?.message || 'Failed to join circle.' });
      setJoinError(err?.message || 'Failed to join circle.');
    } finally {
      setJoining(false);
    }
  }

  const isForming = preview?.status.rawValue === '0';
  const isMember = preview?.members.some((m) => m.address === user.addr) ?? false;
  const isFull = preview ? preview.members.length >= parseInt(preview.config.maxMembers) : false;
  const canJoin = isForming && !isMember && !isFull && user.loggedIn;

  // =========================================================================
  // RENDER
  // =========================================================================

  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-32 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/50 ring-1 ring-zinc-700/50">
          <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">Join a Circle</h1>
        <p className="mt-2 text-sm text-zinc-500">Connect your wallet to search for and join circles.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-16">
      <ToastComponent />

      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-50">
        Join a Circle
      </h1>
      <p className="mt-1.5 text-sm text-zinc-500">
        Enter a circle ID shared by the creator to view details and join.
      </p>

      {/* ── Search ── */}
      <form onSubmit={handleSearch} className="mt-8 flex gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={circleIdInput}
            onChange={(e) => setCircleIdInput(e.target.value)}
            placeholder="Circle ID (e.g., 2)"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
            disabled={searching}
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="rounded-xl bg-zinc-800 px-5 py-3 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700/50 transition-all hover:bg-zinc-700 disabled:opacity-50"
        >
          {searching ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-200" />
              Searching
            </span>
          ) : 'Search'}
        </button>
      </form>

      {/* ── Search Error ── */}
      {searchError && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {searchError}
        </div>
      )}

      {/* ── Circle Preview ── */}
      {preview && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60">
          {/* Header */}
          <div className="border-b border-zinc-800/60 p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">{preview.config.name}</h2>
                <p className="mt-0.5 font-mono text-xs text-zinc-500">Circle #{preview.circleId}</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CONFIG[preview.status.rawValue]?.color || ''}`}>
                {STATUS_CONFIG[preview.status.rawValue]?.label || 'Unknown'}
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 divide-x divide-zinc-800/40 border-b border-zinc-800/60 sm:grid-cols-2">
            {[
              { label: 'Contribution', value: `${fmtFlow(preview.config.contributionAmount)} FLOW` },
              { label: 'Members', value: `${preview.members.length}/${preview.config.maxMembers}` },
              { label: 'Cycle Duration', value: fmtDuration(preview.config.cycleDuration) },
              { label: 'Penalty', value: `${parseFloat(preview.config.penaltyPercent).toFixed(0)}%` },
            ].map((stat, i) => (
              <div key={stat.label} className={`px-5 py-3 ${i >= 2 ? 'border-t border-zinc-800/40' : ''}`}>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600">{stat.label}</p>
                <p className="mt-0.5 text-sm font-medium text-zinc-200">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Deposit info */}
          <div className="flex items-center gap-3 border-b border-zinc-800/60 bg-amber-500/[0.03] px-5 py-3">
            <svg className="h-4 w-4 flex-shrink-0 text-amber-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-amber-400/80">
              Security deposit of <span className="font-semibold text-amber-300">{fmtFlow(preview.config.contributionAmount)} FLOW</span> required. Returned when circle completes.
            </p>
          </div>

          {/* Join Error */}
          {joinError && (
            <div className="border-b border-zinc-800/60 px-5 py-3">
              <p className="text-sm text-red-400">{joinError}</p>
            </div>
          )}

          {/* Action */}
          <div className="p-5">
            {canJoin && (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="group relative w-full overflow-hidden rounded-2xl bg-emerald-600 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {joining ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Joining...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Join Circle
                    <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs">
                      {fmtFlow(preview.config.contributionAmount)} FLOW deposit
                    </span>
                  </span>
                )}
              </button>
            )}

            {isMember && (
              <Link
                href={`/circle/${preview.circleId}`}
                className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] py-4 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/[0.08]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                You&apos;re already a member — View Circle
              </Link>
            )}

            {!isForming && !isMember && (
              <p className="py-2 text-center text-sm text-zinc-500">
                This circle is no longer accepting members ({STATUS_CONFIG[preview.status.rawValue]?.label}).
              </p>
            )}

            {isForming && isFull && !isMember && (
              <p className="py-2 text-center text-sm text-zinc-500">
                This circle is full ({preview.members.length}/{preview.config.maxMembers}).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
