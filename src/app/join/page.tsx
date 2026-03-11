// =============================================================================
// join/page.tsx — Circle Marketplace & Discovery
// =============================================================================
//
// PURPOSE:
//   The marketplace where users discover and join circles. Two entry points:
//   1. Search by ID — for when someone shared a specific circle ID with you
//   2. Browse all — fetches every registered circle from ChamaManager and
//      displays them as browsable cards with stats and reputation
//
// WHY A MARKETPLACE?
//   Traditional chamas rely on word-of-mouth to find groups. A browsable
//   marketplace with trust scores creates a "financial social network" where
//   strangers can form trusted savings groups based on reputation, not just
//   personal connections. This is the feature that turns Chama from a tool
//   into a platform.
//
// DATA FLOW:
//   1. On page load, query ChamaManager.getAllCircleIds() for every circle
//   2. For each circle, fetch host address then full CircleState
//   3. Filter to show "Forming" circles (open for new members) prominently
//   4. Show "Active" and "Completed" circles in a separate section
//   5. User can still search by exact ID for direct joins
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { useTransactionToast } from '@/components/TransactionToast';
import { ReputationBadge } from '@/components/ReputationCard';
import { recordReceiptClient } from '@/lib/receipt-client';

// =============================================================================
// Cadence Scripts & Transactions
// =============================================================================

// Fetches ALL registered circle IDs and their host addresses in one query.
// Returns a dictionary: {circleId: hostAddress}
// For the hackathon (<20 circles) this is fine. Production would paginate.
const GET_ALL_CIRCLES_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(): {UInt64: Address} {
    let circleIds = ChamaManager.getAllCircleIds()
    let result: {UInt64: Address} = {}
    for id in circleIds {
        if let host = ChamaManager.getCircleHost(circleId: id) {
            result[id] = host
        }
    }
    return result
}
`;

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
  hostAddress: string;
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
  currentCycle: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  '0': { label: 'Forming',   color: 'bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20' },
  '1': { label: 'Active',    color: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20' },
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
  if (s < 86400) return `${(s / 3600).toFixed(1)} hr`;
  return `${(s / 86400).toFixed(1)} days`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// =============================================================================
// Component
// =============================================================================

export default function MarketplacePage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const { showToast, ToastComponent } = useTransactionToast();

  // ── Search by ID state ──
  const [circleIdInput, setCircleIdInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Marketplace state ──
  // All circles fetched from ChamaManager, split into open/other
  const [allCircles, setAllCircles] = useState<CirclePreview[]>([]);
  const [loadingMarketplace, setLoadingMarketplace] = useState(true);
  const [filter, setFilter] = useState<'open' | 'active' | 'all'>('open');

  // ── Join state ──
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // ── Fetch all circles for marketplace ──
  const fetchAllCircles = useCallback(async () => {
    setLoadingMarketplace(true);
    try {
      // Step 1: Get all circle IDs and their host addresses
      const registry: Record<string, string> = await fcl.query({
        cadence: GET_ALL_CIRCLES_SCRIPT,
      });

      if (!registry || Object.keys(registry).length === 0) {
        setAllCircles([]);
        setLoadingMarketplace(false);
        return;
      }

      // Step 2: Fetch full state for each circle in parallel
      const circles = await Promise.allSettled(
        Object.entries(registry).map(async ([id, host]) => {
          const state: any = await fcl.query({
            cadence: GET_CIRCLE_STATE_SCRIPT,
            args: (arg: any, t: any) => [arg(host, t.Address), arg(id, t.UInt64)],
          });
          return { ...state, hostAddress: host } as CirclePreview;
        })
      );

      const loaded = circles
        .filter((r): r is PromiseFulfilledResult<CirclePreview> => r.status === 'fulfilled')
        .map((r) => r.value);

      setAllCircles(loaded);
    } catch (err) {
      console.error('Failed to fetch marketplace:', err);
    } finally {
      setLoadingMarketplace(false);
    }
  }, []);

  useEffect(() => {
    fetchAllCircles();
  }, [fetchAllCircles]);

  // ── Search handler ──
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    const id = circleIdInput.trim();
    if (!id || isNaN(parseInt(id))) {
      setSearchError('Enter a valid circle ID (number).');
      return;
    }
    setSearching(true);
    try {
      const host: string | null = await fcl.query({
        cadence: GET_CIRCLE_HOST_SCRIPT,
        args: (arg: any, t: any) => [arg(id, t.UInt64)],
      });
      if (!host) {
        setSearchError(`Circle #${id} not found.`);
        return;
      }
      router.push(`/circle/${id}`);
    } catch {
      setSearchError('Search failed. Check your connection.');
    } finally {
      setSearching(false);
    }
  }

  // ── Join handler ──
  async function handleJoin(circle: CirclePreview) {
    if (!circle.hostAddress) return;
    setJoiningId(circle.circleId);
    try {
      showToast({ status: 'pending', message: 'Approve the join transaction...' });
      const txId = await fcl.mutate({
        cadence: JOIN_CIRCLE_TX,
        args: (arg: any, t: any) => [arg(circle.hostAddress, t.Address), arg(circle.circleId, t.UInt64)],
        proposer: fcl.currentUser, payer: fcl.currentUser,
        authorizations: [fcl.currentUser], limit: 9999,
      });
      showToast({ status: 'sealing', message: 'Joining — confirming on-chain...', txId });
      await fcl.tx(txId).onceSealed();
      showToast({ status: 'sealed', message: 'Joined successfully!', txId });

      // Fire-and-forget: record join receipt to IPFS + on-chain
      if (user.addr) {
        recordReceiptClient({
          circleId: circle.circleId,
          action: 'member_joined',
          actor: user.addr,
          timestamp: new Date().toISOString(),
          details: {
            depositAmount: circle.config.contributionAmount,
          },
          transactionId: txId,
        }, circle.hostAddress, circle.circleId, null).catch(console.warn);
      }

      setTimeout(() => router.push(`/circle/${circle.circleId}`), 1500);
    } catch (err: any) {
      showToast({ status: 'error', message: err?.message || 'Join failed.' });
    } finally {
      setJoiningId(null);
    }
  }

  // ── Filter circles ──
  const filteredCircles = allCircles.filter((c) => {
    if (filter === 'open') return c.status.rawValue === '0';
    if (filter === 'active') return c.status.rawValue === '1';
    return true;
  });

  const openCount = allCircles.filter((c) => c.status.rawValue === '0').length;
  const activeCount = allCircles.filter((c) => c.status.rawValue === '1').length;

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
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">Circle Marketplace</h1>
        <p className="mt-2 text-sm text-zinc-500">Connect your wallet to discover and join savings circles.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <ToastComponent />

      {/* ── Breadcrumb ── */}
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Dashboard
      </Link>

      {/* ── Header ── */}
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Circle Marketplace</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Browse open circles or search by ID. Join groups based on contribution size, trust scores, and cycle duration.
        </p>
      </div>

      {/* ── Search by ID ── */}
      {/* Quick direct-join when someone shares a circle ID with you */}
      <form onSubmit={handleSearch} className="mt-6 flex gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={circleIdInput}
            onChange={(e) => setCircleIdInput(e.target.value)}
            placeholder="Search by Circle ID..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
            disabled={searching}
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="rounded-xl bg-zinc-800 px-5 py-3 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700/50 transition-all hover:bg-zinc-700 disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Go'}
        </button>
      </form>
      {searchError && (
        <p className="mt-2 text-sm text-red-400">{searchError}</p>
      )}

      {/* ── Filter Tabs ── */}
      {/* Three views: Open (joinable), Active (in progress), All           */}
      {/* WHY TABS (not a dropdown)?                                        */}
      {/*   Three options is the sweet spot for tabs — visible at a glance, */}
      {/*   no extra click needed. The count badges show what's available.  */}
      <div className="mt-8 flex gap-2">
        {[
          { key: 'open' as const, label: 'Open', count: openCount },
          { key: 'active' as const, label: 'Active', count: activeCount },
          { key: 'all' as const, label: 'All', count: allCircles.length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              filter === tab.key
                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── Loading ── */}
      {loadingMarketplace && (
        <div className="mt-12 flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
          <p className="text-sm text-zinc-500">Loading marketplace...</p>
        </div>
      )}

      {/* ── Empty State ── */}
      {!loadingMarketplace && filteredCircles.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
          <p className="text-sm text-zinc-500">
            {filter === 'open'
              ? 'No circles accepting members right now.'
              : filter === 'active'
                ? 'No active circles.'
                : 'No circles found.'}
          </p>
          <Link
            href="/create"
            className="mt-3 inline-block text-sm text-emerald-500 transition-colors hover:text-emerald-400"
          >
            Create the first one →
          </Link>
        </div>
      )}

      {/* ── Circle Cards ── */}
      {/* Each card shows: name, status, contribution amount, member count, */}
      {/* cycle duration, host reputation, and a join/view button.          */}
      {/* The card design emphasizes the "slot fill" progress to create     */}
      {/* urgency ("3/5 slots filled — join before it's full!").            */}
      {!loadingMarketplace && filteredCircles.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {filteredCircles.map((circle) => {
            const status = STATUS_CONFIG[circle.status.rawValue] || STATUS_CONFIG['0'];
            const memberCount = circle.members.length;
            const maxMembers = parseInt(circle.config.maxMembers);
            const slotsLeft = maxMembers - memberCount;
            const isMember = circle.members.some((m) => m.address === user.addr);
            const isOpen = circle.status.rawValue === '0';
            const canJoin = isOpen && !isMember && slotsLeft > 0;
            const payout = (parseFloat(circle.config.contributionAmount) * maxMembers).toFixed(2);

            return (
              <div
                key={circle.circleId}
                className="group overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60 transition-all hover:border-zinc-700/80 hover:bg-zinc-900/80"
              >
                {/* Card header */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-zinc-100">{circle.config.name}</h3>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span className="font-mono">#{circle.circleId}</span>
                        <span className="text-zinc-700">|</span>
                        <span>Host: {truncAddr(circle.hostAddress)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ReputationBadge address={circle.hostAddress} />
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 border-t border-zinc-800/60 divide-x divide-zinc-800/60">
                  <div className="px-4 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600">Contribution</p>
                    <p className="mt-0.5 text-sm font-medium text-zinc-200">{fmtFlow(circle.config.contributionAmount)}</p>
                  </div>
                  <div className="px-4 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600">Payout</p>
                    <p className="mt-0.5 text-sm font-medium text-emerald-400">{fmtFlow(payout)}</p>
                  </div>
                  <div className="px-4 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600">Duration</p>
                    <p className="mt-0.5 text-sm font-medium text-zinc-200">{fmtDuration(circle.config.cycleDuration)}</p>
                  </div>
                </div>

                {/* Member fill bar + action */}
                <div className="border-t border-zinc-800/60 p-4">
                  {/* Progress bar showing how full the circle is */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">{memberCount}/{maxMembers} members</span>
                    {isOpen && slotsLeft > 0 && (
                      <span className="text-sky-400">{slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} left</span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${(memberCount / maxMembers) * 100}%` }}
                    />
                  </div>

                  {/* Action button */}
                  <div className="mt-3">
                    {canJoin && (
                      <button
                        onClick={() => handleJoin(circle)}
                        disabled={joiningId === circle.circleId}
                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {joiningId === circle.circleId ? 'Joining...' : `Join — ${fmtFlow(circle.config.contributionAmount)} FLOW`}
                      </button>
                    )}
                    {isMember && (
                      <Link
                        href={`/circle/${circle.circleId}`}
                        className="block w-full rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] py-2.5 text-center text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/[0.08]"
                      >
                        View Circle →
                      </Link>
                    )}
                    {!canJoin && !isMember && (
                      <Link
                        href={`/circle/${circle.circleId}`}
                        className="block w-full rounded-xl border border-zinc-800 py-2.5 text-center text-xs font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
                      >
                        View Details
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
