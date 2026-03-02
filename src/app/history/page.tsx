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
//   1. Fetch user's circle IDs from ChamaManager (same as Dashboard)
//   2. For each circle, get the state (which includes latestReceiptCID)
//   3. When user selects a circle, fetch the receipt chain from IPFS
//   4. Render receipts as a vertical timeline (newest first)
//
// WHY A SEPARATE PAGE (not a tab on Circle Detail)?
//   The receipt chain can be long (one receipt per action per cycle). Mixing
//   it into the Circle Detail page would clutter the primary "contribute now"
//   workflow. A dedicated page lets users focus on auditing when they want to.
//
// IPFS FETCHING:
//   Receipts are fetched client-side from the Storacha gateway (w3s.link).
//   Each receipt JSON includes a previousReceiptCID field — we follow that
//   chain backward until we hit null (the genesis receipt).
//
// PERFORMANCE:
//   We limit chain walking to 50 receipts per load to avoid blocking the UI
//   on circles with hundreds of cycles. A "Load More" button continues from
//   where we left off.
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
// Reused from Dashboard — these query the ChamaManager registry to find
// which circles a user belongs to, then fetch each circle's state.

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

// ── Receipt shape from IPFS ──
// This mirrors the ReceiptData interface from receipt-service.ts, plus the
// extra fields added during upload (receiptVersion, uploadedAt).
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
// Action Label Map
// =============================================================================
//
// Maps receipt action strings to human-readable labels and color classes.
// Each action type gets a distinct visual treatment so users can scan the
// timeline quickly and spot payouts, penalties, etc.

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  circle_created:   { label: 'Circle Created',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',       icon: '+' },
  member_joined:    { label: 'Member Joined',     color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300', icon: '→' },
  circle_sealed:    { label: 'Circle Sealed',     color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300', icon: '●' },
  contribution:     { label: 'Contribution',      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300', icon: '$' },
  payout_executed:  { label: 'Payout Executed',   color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',   icon: '↑' },
  member_penalized: { label: 'Member Penalized',  color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',           icon: '!' },
  cycle_advanced:   { label: 'Cycle Advanced',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',   icon: '»' },
  circle_completed: { label: 'Circle Completed',  color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',       icon: '✓' },
  deposit_returned: { label: 'Deposit Returned',  color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',       icon: '←' },
};

// =============================================================================
// Constants
// =============================================================================

// How many receipts to fetch per batch. Keeps UI responsive for long chains.
const BATCH_SIZE = 50;

// =============================================================================
// Helper: Format timestamp
// =============================================================================
//
// Receipts store ISO 8601 timestamps (e.g., "2026-02-18T14:30:00.000Z").
// We format them as a short, human-readable date+time for the timeline.
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

// =============================================================================
// Helper: Truncate address
// =============================================================================
function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// =============================================================================
// Component
// =============================================================================

export default function HistoryPage() {
  const { user } = useCurrentUser();

  // ── Circle list state ──
  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [loadingCircles, setLoadingCircles] = useState(false);

  // ── Selected circle + receipt chain state ──
  const [selectedCircle, setSelectedCircle] = useState<CircleSummary | null>(null);
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // ── Pagination: track where to continue chain walking ──
  // When the chain has more than BATCH_SIZE receipts, we store the CID
  // of the next receipt to fetch so "Load More" can continue seamlessly.
  const [nextCIDToFetch, setNextCIDToFetch] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // -------------------------------------------------------------------------
  // Fetch user's circles (same pattern as Dashboard)
  // -------------------------------------------------------------------------
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

      const summaries = await Promise.all(
        circleIds.map(async (id) => {
          const host: string | null = await fcl.query({
            cadence: GET_CIRCLE_HOST_SCRIPT,
            args: (arg: any, t: any) => [arg(id, t.UInt64)],
          });
          if (!host) return null;

          const state: any = await fcl.query({
            cadence: GET_CIRCLE_STATE_SCRIPT,
            args: (arg: any, t: any) => [
              arg(host, t.Address),
              arg(id, t.UInt64),
            ],
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
    if (user.loggedIn && user.addr) {
      fetchCircles();
    }
  }, [user.loggedIn, user.addr, fetchCircles]);

  // -------------------------------------------------------------------------
  // Fetch receipt chain from IPFS
  // -------------------------------------------------------------------------
  //
  // ALGORITHM:
  //   Start with the latestReceiptCID from the circle's on-chain state.
  //   Fetch that receipt JSON from the Storacha gateway. Read its
  //   previousReceiptCID field. Fetch that. Repeat until null or BATCH_SIZE.
  //
  // WHY CLIENT-SIDE (not a Next.js API route)?
  //   IPFS gateway requests are public — no secrets needed. Fetching from
  //   the browser avoids an extra server hop and lets us show incremental
  //   progress as each receipt loads.
  //
  // ERROR HANDLING:
  //   If any receipt in the chain fails to fetch, we stop and show what we
  //   have so far plus an error message. Partial chains are still useful.
  const fetchReceiptChain = useCallback(
    async (startCID: string, append: boolean = false) => {
      setLoadingReceipts(true);
      setReceiptError(null);

      const chain: ReceiptEntry[] = append ? [...receipts] : [];
      let currentCID: string | null = startCID;
      let count = 0;

      try {
        while (currentCID && count < BATCH_SIZE) {
          const gatewayUrl = `https://${currentCID}.ipfs.w3s.link`;
          const response = await fetch(gatewayUrl);

          if (!response.ok) {
            setReceiptError(
              `Failed to fetch receipt ${currentCID.slice(0, 12)}... (HTTP ${response.status})`
            );
            break;
          }

          const receipt: Receipt = await response.json();
          chain.push({ cid: currentCID, receipt });
          currentCID = receipt.previousReceiptCID ?? null;
          count++;
        }

        setReceipts(chain);

        // If we stopped because of BATCH_SIZE and there's more to fetch
        if (currentCID && count >= BATCH_SIZE) {
          setNextCIDToFetch(currentCID);
          setHasMore(true);
        } else {
          setNextCIDToFetch(null);
          setHasMore(false);
        }
      } catch (err) {
        console.error('Receipt chain fetch error:', err);
        setReceiptError('Failed to load receipt chain. The IPFS gateway may be temporarily unavailable.');
        setReceipts(chain); // Show whatever we got
      } finally {
        setLoadingReceipts(false);
      }
    },
    [receipts]
  );

  // -------------------------------------------------------------------------
  // Handle circle selection
  // -------------------------------------------------------------------------
  function handleSelectCircle(circle: CircleSummary) {
    setSelectedCircle(circle);
    setReceipts([]);
    setHasMore(false);
    setNextCIDToFetch(null);
    setReceiptError(null);

    if (circle.latestReceiptCID) {
      fetchReceiptChain(circle.latestReceiptCID);
    }
  }

  // =========================================================================
  // RENDER: Not connected
  // =========================================================================
  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Receipt History
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Connect your wallet to view your circle receipt history.
        </p>
      </div>
    );
  }

  // =========================================================================
  // RENDER: Connected
  // =========================================================================
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Receipt History
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Tamper-proof audit trail for all circle actions, stored on IPFS via Storacha.
        Each receipt links to the previous one by CID, forming a verifiable chain.
      </p>

      {/* ── Circle Selector ── */}
      {/* Horizontal scrollable list of circle chips. Selecting one loads its  */}
      {/* receipt chain. Active circle gets a highlighted border.              */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Select a Circle
        </h2>

        {loadingCircles && (
          <div className="mt-3 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
          </div>
        )}

        {!loadingCircles && circles.length === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No circles found.{' '}
            <Link href="/create" className="text-emerald-600 underline hover:text-emerald-700">
              Create one
            </Link>{' '}
            to get started.
          </div>
        )}

        {!loadingCircles && circles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {circles.map((circle) => (
              <button
                key={circle.circleId}
                onClick={() => handleSelectCircle(circle)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  selectedCircle?.circleId === circle.circleId
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900'
                }`}
              >
                {circle.name}
                <span className="ml-2 text-xs text-zinc-400">#{circle.circleId}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Receipt Chain ── */}
      {selectedCircle && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {selectedCircle.name} — Receipts
            </h2>
            {selectedCircle.latestReceiptCID && (
              <a
                href={`https://${selectedCircle.latestReceiptCID}.ipfs.w3s.link`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-emerald-600 underline hover:text-emerald-700 dark:text-emerald-400"
              >
                Latest CID: {selectedCircle.latestReceiptCID.slice(0, 16)}...
              </a>
            )}
          </div>

          {/* No receipts yet */}
          {!loadingReceipts && !receiptError && receipts.length === 0 && !selectedCircle.latestReceiptCID && (
            <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              No receipts recorded yet. Receipts are created when actions
              occur on-chain (contributions, payouts, penalties).
            </div>
          )}

          {/* Loading indicator */}
          {loadingReceipts && receipts.length === 0 && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
              <p className="text-sm text-zinc-500">Fetching receipts from IPFS...</p>
            </div>
          )}

          {/* Error display */}
          {receiptError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              {receiptError}
            </div>
          )}

          {/* ── Timeline ── */}
          {/* Vertical timeline with a left border line connecting entries.    */}
          {/* Each entry shows: action badge, timestamp, actor, details.       */}
          {/* WHY A TIMELINE (not a table)?                                    */}
          {/*   Receipts are sequential events — a timeline is the natural     */}
          {/*   visual metaphor. Tables work for sortable columnar data;       */}
          {/*   timelines work for ordered event streams.                      */}
          {receipts.length > 0 && (
            <div className="relative mt-6">
              {/* Vertical connecting line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-700" />

              <div className="space-y-0">
                {receipts.map((entry, index) => {
                  const config = ACTION_CONFIG[entry.receipt.action] || {
                    label: entry.receipt.action,
                    color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
                    icon: '?',
                  };

                  return (
                    <div key={entry.cid} className="relative flex gap-4 pb-6 pl-10">
                      {/* ── Timeline dot ── */}
                      {/* Positioned on the vertical line. The icon inside       */}
                      {/* gives a quick visual cue of the action type.           */}
                      <div className="absolute left-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-zinc-100 text-[10px] font-bold text-zinc-600 dark:border-zinc-950 dark:bg-zinc-800 dark:text-zinc-400">
                        {config.icon}
                      </div>

                      {/* ── Receipt card ── */}
                      <div className="flex-1 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                        {/* Top row: action badge + timestamp */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                            {config.label}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-500">
                            {formatTimestamp(entry.receipt.timestamp)}
                          </span>
                          {index === 0 && (
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                              Latest
                            </span>
                          )}
                        </div>

                        {/* Actor address */}
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                          <span className="text-zinc-500">By:</span>{' '}
                          <span className="font-mono">
                            {truncateAddress(entry.receipt.actor)}
                          </span>
                          {entry.receipt.actor === user.addr && (
                            <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">(you)</span>
                          )}
                        </p>

                        {/* Details — render key-value pairs from the details object */}
                        {/* WHY Object.entries (not a predefined set of fields)?     */}
                        {/*   Different actions have different detail shapes. Using   */}
                        {/*   Object.entries makes this renderer action-agnostic.     */}
                        {entry.receipt.details && Object.keys(entry.receipt.details).length > 0 && (
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                            {Object.entries(entry.receipt.details).map(([key, value]) => (
                              <div key={key}>
                                <span className="text-zinc-400">{key}: </span>
                                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                  {String(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* CID + Transaction ID footer */}
                        <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-zinc-800">
                          <a
                            href={`https://${entry.cid}.ipfs.w3s.link`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono hover:text-emerald-600 dark:hover:text-emerald-400"
                          >
                            CID: {entry.cid.slice(0, 16)}...
                          </a>
                          {entry.receipt.transactionId && (
                            <a
                              href={`https://testnet.flowscan.io/transaction/${entry.receipt.transactionId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono hover:text-emerald-600 dark:hover:text-emerald-400"
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

              {/* ── Load More button ── */}
              {/* When the chain has more than BATCH_SIZE receipts, this button  */}
              {/* continues fetching from where we stopped. We store the next    */}
              {/* CID in state so we don't re-fetch already-loaded receipts.     */}
              {hasMore && nextCIDToFetch && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => fetchReceiptChain(nextCIDToFetch, true)}
                    disabled={loadingReceipts}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {loadingReceipts ? 'Loading...' : `Load More Receipts`}
                  </button>
                </div>
              )}

              {/* Chain end marker */}
              {!hasMore && receipts.length > 0 && (
                <div className="relative flex items-center gap-4 pl-10">
                  <div className="absolute left-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-100 text-[10px] font-bold text-emerald-600 dark:border-zinc-950 dark:bg-emerald-900 dark:text-emerald-400">
                    ◆
                  </div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    Genesis — start of receipt chain ({receipts.length} receipt{receipts.length !== 1 ? 's' : ''} total)
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Inline loading for "Load More" */}
          {loadingReceipts && receipts.length > 0 && (
            <div className="mt-4 flex justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
