// =============================================================================
// history/page.tsx — Receipt history and audit trail viewer
// =============================================================================
//
// PURPOSE:
//   Displays the full receipt chain for each circle the user belongs to.
//   Each on-chain action (join, contribute, payout, penalty) produces an IPFS
//   receipt linked to the previous one via CID. This page walks that chain
//   and renders it as a timeline, giving users a tamper-proof audit trail.
//
// DATA FLOW:
//   1. Fetch user's circle IDs from ChamaManager (on-chain registry)
//   2. For each circle, get the state (includes latestReceiptCID)
//   3. When user selects a circle, fetch the receipt chain from IPFS
//   4. Render receipts as a vertical timeline (newest first)
//
// WHY A SEPARATE PAGE?
//   The receipt chain can grow long (one receipt per action per cycle). Mixing
//   it into Circle Detail would clutter the "contribute now" workflow. A
//   dedicated page lets users focus on auditing when they choose to.
//
// IPFS CHAIN WALKING:
//   Each receipt JSON on IPFS includes a `previousReceiptCID` field pointing
//   to the prior receipt. We follow this linked list backward until we hit
//   null (the genesis receipt). This creates a verifiable, tamper-proof chain
//   — changing any receipt would break the CID links downstream.
//
// PERFORMANCE:
//   We cap chain walking at 50 receipts per load to keep the UI responsive.
//   A "Load More" button continues from where we stopped.
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';

// =============================================================================
// Cadence Scripts
// =============================================================================
//
// These query the ChamaManager contract (the global registry) to discover
// which circles a user belongs to, then fetch each circle's on-chain state.
// The state includes `latestReceiptCID` — our entry point into the IPFS chain.

const GET_MEMBER_CIRCLES_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(member: Address): [UInt64] {
    return ChamaManager.getMemberCircles(member: member)
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

// =============================================================================
// Types
// =============================================================================

interface CircleSummary {
  circleId: string;
  name: string;
  status: string;
  latestReceiptCID: string;
}

// Receipt shape from IPFS — mirrors the ReceiptData interface from
// receipt-service.ts. Each receipt is a JSON object stored on IPFS via
// Storacha. The `previousReceiptCID` field forms the linked list.
interface Receipt {
  circleId: string;
  action: string;
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
  previousReceiptCID: string | null;
  transactionId?: string;
  receiptVersion?: number;
  uploadedAt?: string;
}

interface ReceiptEntry {
  cid: string;
  receipt: Receipt;
}

// =============================================================================
// Action Config
// =============================================================================
//
// Maps receipt action strings to display properties. Each action type gets
// a distinct color and icon so users can visually scan the timeline and
// quickly spot payouts, penalties, contributions, etc.
//
// WHY SEPARATE COLORS PER ACTION?
//   In financial audit trails, quick visual differentiation matters. A user
//   scanning for "was I penalized?" should spot red immediately without
//   reading every entry.

const ACTION_CONFIG: Record<string, { label: string; color: string; dotColor: string; icon: string }> = {
  circle_created:   { label: 'Circle Created',   color: 'bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20',         dotColor: 'bg-sky-500',     icon: '+' },
  member_joined:    { label: 'Member Joined',     color: 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20', dotColor: 'bg-indigo-500',  icon: '→' },
  circle_sealed:    { label: 'Circle Sealed',     color: 'bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20', dotColor: 'bg-purple-500',  icon: '●' },
  contribution:     { label: 'Contribution',      color: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20', dotColor: 'bg-emerald-500', icon: '$' },
  payout_executed:  { label: 'Payout Executed',   color: 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20',   dotColor: 'bg-green-500',   icon: '↑' },
  member_penalized: { label: 'Member Penalized',  color: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',         dotColor: 'bg-red-500',     icon: '!' },
  cycle_advanced:   { label: 'Cycle Advanced',    color: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',   dotColor: 'bg-amber-500',   icon: '»' },
  circle_completed: { label: 'Circle Completed',  color: 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20',      dotColor: 'bg-zinc-500',    icon: '✓' },
  deposit_returned: { label: 'Deposit Returned',  color: 'bg-teal-500/10 text-teal-400 ring-1 ring-teal-500/20',      dotColor: 'bg-teal-500',    icon: '←' },
};

// =============================================================================
// Constants & Helpers
// =============================================================================

const BATCH_SIZE = 50;

// Receipts store ISO 8601 timestamps. We format them as short date+time
// for the timeline. Using toLocaleDateString with specific options ensures
// consistent formatting across browsers.
function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Status label lookup — matches the rawValue from the on-chain enum
const STATUS_LABELS: Record<string, string> = {
  '0': 'Forming',
  '1': 'Active',
  '2': 'Completed',
  '3': 'Cancelled',
};

// =============================================================================
// Component
// =============================================================================

export default function HistoryPage() {
  const { user } = useCurrentUser();

  // ── Circle list ──
  // We fetch all circles the user belongs to so they can pick which one
  // to view receipts for. This is the same query pattern as the Dashboard.
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [loadingCircles, setLoadingCircles] = useState(false);

  // ── Selected circle + receipt chain ──
  const [selectedCircle, setSelectedCircle] = useState<CircleSummary | null>(null);
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // ── Pagination ──
  // When the chain exceeds BATCH_SIZE, we store the CID of the next
  // unfetched receipt so "Load More" can continue without re-fetching.
  const [nextCIDToFetch, setNextCIDToFetch] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // ── Fetch user's circles from on-chain registry ──
  const fetchCircles = useCallback(async () => {
    if (!user.addr) return;
    setLoadingCircles(true);
    try {
      const circleIds: string[] = await fcl.query({
        cadence: GET_MEMBER_CIRCLES_SCRIPT,
        args: (arg: any, t: any) => [arg(user.addr, t.Address)],
      });

      if (!circleIds || circleIds.length === 0) {
        setCircles([]);
        setLoadingCircles(false);
        return;
      }

      // For each circle ID, look up the host address then fetch state.
      // We do this in parallel (Promise.all) for speed.
      const summaries = await Promise.all(
        circleIds.map(async (id) => {
          const host: string | null = await fcl.query({
            cadence: GET_CIRCLE_HOST_SCRIPT,
            args: (arg: any, t: any) => [arg(id, t.UInt64)],
          });
          if (!host) return null;
          const state: any = await fcl.query({
            cadence: GET_CIRCLE_STATE_SCRIPT,
            args: (arg: any, t: any) => [arg(host, t.Address), arg(id, t.UInt64)],
          });
          return {
            circleId: state.circleId,
            name: state.config.name,
            status: state.status.rawValue,
            latestReceiptCID: state.latestReceiptCID || '',
          } as CircleSummary;
        })
      );
      setCircles(summaries.filter((s): s is CircleSummary => s !== null));
    } catch (err) {
      console.error('Failed to fetch circles for history:', err);
    } finally {
      setLoadingCircles(false);
    }
  }, [user.addr]);

  useEffect(() => {
    if (user.loggedIn && user.addr) fetchCircles();
  }, [user.loggedIn, user.addr, fetchCircles]);

  // ── Walk the IPFS receipt chain ──
  //
  // ALGORITHM:
  //   1. Start with a CID (either latestReceiptCID or the continuation CID)
  //   2. Fetch the JSON from Storacha gateway: https://{cid}.ipfs.w3s.link
  //   3. Read `previousReceiptCID` from the JSON
  //   4. Repeat until null (genesis) or we hit BATCH_SIZE
  //
  // WHY CLIENT-SIDE?
  //   IPFS gateway requests are public (no API keys). Fetching from the
  //   browser avoids an extra server hop and lets us show progress as
  //   each receipt loads incrementally.
  const fetchReceiptChain = useCallback(
    async (startCID: string, append: boolean = false) => {
      setLoadingReceipts(true);
      setReceiptError(null);
      const chain: ReceiptEntry[] = append ? [...receipts] : [];
      let currentCID: string | null = startCID;
      let count = 0;

      try {
        while (currentCID && count < BATCH_SIZE) {
          const response = await fetch(`https://${currentCID}.ipfs.w3s.link`);
          if (!response.ok) {
            setReceiptError(`Failed to fetch receipt ${currentCID.slice(0, 12)}... (HTTP ${response.status})`);
            break;
          }
          const receipt: Receipt = await response.json();
          chain.push({ cid: currentCID, receipt });
          currentCID = receipt.previousReceiptCID ?? null;
          count++;
        }
        setReceipts(chain);

        // If we stopped at BATCH_SIZE and there's more chain to walk
        if (currentCID && count >= BATCH_SIZE) {
          setNextCIDToFetch(currentCID);
          setHasMore(true);
        } else {
          setNextCIDToFetch(null);
          setHasMore(false);
        }
      } catch (err) {
        console.error('Receipt chain fetch error:', err);
        setReceiptError('Failed to load receipt chain. IPFS gateway may be temporarily unavailable.');
        setReceipts(chain); // Show partial chain
      } finally {
        setLoadingReceipts(false);
      }
    },
    [receipts]
  );

  function handleSelectCircle(circle: CircleSummary) {
    setSelectedCircle(circle);
    setReceipts([]);
    setHasMore(false);
    setNextCIDToFetch(null);
    setReceiptError(null);
    if (circle.latestReceiptCID) fetchReceiptChain(circle.latestReceiptCID);
  }

  // =========================================================================
  // RENDER: Not connected
  // =========================================================================
  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-32 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
          <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-bold text-zinc-100">Receipt History</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Connect your wallet to view your circle receipt history.
        </p>
      </div>
    );
  }

  // =========================================================================
  // RENDER: Connected
  // =========================================================================
  return (
    <div className="mx-auto max-w-3xl pb-16">
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

      {/* ── Page Header ── */}
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Receipt History</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Tamper-proof audit trail stored on IPFS via Storacha. Each receipt links
          to the previous one by CID, forming a verifiable chain.
        </p>
      </div>

      {/* ── Circle Selector ── */}
      {/* Horizontal chip list — selecting a circle loads its receipt chain.    */}
      {/* WHY CHIPS (not a dropdown)?                                           */}
      {/*   Users typically have 1-5 circles. Chips show all options at a       */}
      {/*   glance without requiring a click to expand. For 10+ circles,        */}
      {/*   we'd switch to a searchable dropdown.                               */}
      <div className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Select a Circle
        </h2>

        {loadingCircles && (
          <div className="mt-4 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
          </div>
        )}

        {!loadingCircles && circles.length === 0 && (
          <div className="mt-3 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No circles found.{' '}
            <Link href="/create" className="text-emerald-500 hover:text-emerald-400 transition-colors">
              Create one
            </Link>{' '}
            or{' '}
            <Link href="/join" className="text-emerald-500 hover:text-emerald-400 transition-colors">
              join one
            </Link>{' '}
            to get started.
          </div>
        )}

        {!loadingCircles && circles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {circles.map((circle) => {
              const isSelected = selectedCircle?.circleId === circle.circleId;
              return (
                <button
                  key={circle.circleId}
                  onClick={() => handleSelectCircle(circle)}
                  className={`group rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
                    isSelected
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-lg shadow-emerald-500/5'
                      : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                  }`}
                >
                  <span>{circle.name}</span>
                  <span className="ml-2 text-xs text-zinc-600">#{circle.circleId}</span>
                  <span className={`ml-2 text-[10px] uppercase tracking-wider ${
                    isSelected ? 'text-emerald-500/60' : 'text-zinc-600'
                  }`}>
                    {STATUS_LABELS[circle.status] || 'Unknown'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Receipt Chain ── */}
      {selectedCircle && (
        <div className="mt-8">
          {/* Section header with latest CID link */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-100">
              {selectedCircle.name}
              <span className="ml-2 text-sm font-normal text-zinc-500">receipts</span>
            </h2>
            {selectedCircle.latestReceiptCID && (
              <a
                href={`https://${selectedCircle.latestReceiptCID}.ipfs.w3s.link`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 font-mono text-xs text-emerald-500 transition-colors hover:text-emerald-400"
              >
                {selectedCircle.latestReceiptCID.slice(0, 16)}...
                <svg className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>

          {/* Empty state — no receipts yet */}
          {!loadingReceipts && !receiptError && receipts.length === 0 && !selectedCircle.latestReceiptCID && (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
              No receipts recorded yet. Receipts are created when actions
              occur on-chain (contributions, payouts, penalties).
            </div>
          )}

          {/* Initial loading spinner */}
          {loadingReceipts && receipts.length === 0 && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
              <p className="text-sm text-zinc-500">Fetching receipts from IPFS...</p>
            </div>
          )}

          {/* Error banner */}
          {receiptError && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {receiptError}
            </div>
          )}

          {/* ── Timeline ── */}
          {/* Vertical timeline with a left border connecting entries.           */}
          {/* WHY A TIMELINE (not a table)?                                      */}
          {/*   Receipts are sequential events — a timeline is the natural       */}
          {/*   metaphor. Tables work for sortable columnar data; timelines      */}
          {/*   work for ordered event streams. The visual flow helps users      */}
          {/*   trace the chain of actions chronologically.                      */}
          {receipts.length > 0 && (
            <div className="relative mt-6">
              {/* Vertical connecting line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-zinc-700 via-zinc-800 to-transparent" />

              <div className="space-y-0">
                {receipts.map((entry, index) => {
                  const config = ACTION_CONFIG[entry.receipt.action] || {
                    label: entry.receipt.action,
                    color: 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20',
                    dotColor: 'bg-zinc-500',
                    icon: '?',
                  };

                  return (
                    <div key={entry.cid} className="relative flex gap-4 pb-6 pl-9">
                      {/* Timeline dot — color-coded by action type */}
                      <div className={`absolute left-1 top-1.5 h-[9px] w-[9px] rounded-full ring-2 ring-zinc-950 ${config.dotColor}`} />

                      {/* Receipt card */}
                      <div className="flex-1 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700/80 hover:bg-zinc-900/60">
                        {/* Top row: action badge + timestamp + "Latest" tag */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${config.color}`}>
                            {config.label}
                          </span>
                          <span className="text-xs text-zinc-600">
                            {formatTimestamp(entry.receipt.timestamp)}
                          </span>
                          {index === 0 && (
                            <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                              Latest
                            </span>
                          )}
                        </div>

                        {/* Actor address */}
                        <p className="mt-2 text-sm text-zinc-400">
                          <span className="text-zinc-600">By </span>
                          <span className="font-mono text-zinc-300">{truncAddr(entry.receipt.actor)}</span>
                          {entry.receipt.actor === user.addr && (
                            <span className="ml-1.5 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                              You
                            </span>
                          )}
                        </p>

                        {/* Details key-value grid */}
                        {/* WHY Object.entries (not predefined fields)?              */}
                        {/*   Different actions have different detail shapes.         */}
                        {/*   Object.entries makes this renderer action-agnostic —    */}
                        {/*   it'll display any data the receipt contains.            */}
                        {entry.receipt.details && Object.keys(entry.receipt.details).length > 0 && (
                          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl bg-zinc-800/30 px-3 py-2.5 text-xs sm:grid-cols-2 md:grid-cols-3">
                            {Object.entries(entry.receipt.details).map(([key, value]) => (
                              <div key={key}>
                                <span className="text-zinc-600">{key}: </span>
                                <span className="font-medium text-zinc-300">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* CID + Transaction ID footer */}
                        {/* Both are links — CID goes to IPFS, TX goes to Flowscan. */}
                        {/* This lets users independently verify any receipt.         */}
                        <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-800/60 pt-2.5 text-[11px] text-zinc-600">
                          <a
                            href={`https://${entry.cid}.ipfs.w3s.link`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono transition-colors hover:text-emerald-500"
                          >
                            CID: {entry.cid.slice(0, 16)}...
                          </a>
                          {entry.receipt.transactionId && (
                            <a
                              href={`https://testnet.flowscan.io/transaction/${entry.receipt.transactionId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono transition-colors hover:text-emerald-500"
                            >
                              TX: {entry.receipt.transactionId.slice(0, 16)}...
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More button */}
              {/* Continues chain walking from where we stopped at BATCH_SIZE.   */}
              {hasMore && nextCIDToFetch && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => fetchReceiptChain(nextCIDToFetch, true)}
                    disabled={loadingReceipts}
                    className="rounded-xl border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-50"
                  >
                    {loadingReceipts ? 'Loading...' : 'Load More Receipts'}
                  </button>
                </div>
              )}

              {/* Chain end marker — the genesis receipt */}
              {!hasMore && receipts.length > 0 && (
                <div className="relative flex items-center gap-4 pl-9">
                  <div className="absolute left-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
                  <p className="text-xs text-zinc-600">
                    Genesis — start of receipt chain ({receipts.length} receipt{receipts.length !== 1 ? 's' : ''} total)
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Inline loading spinner for "Load More" */}
          {loadingReceipts && receipts.length > 0 && (
            <div className="mt-4 flex justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
