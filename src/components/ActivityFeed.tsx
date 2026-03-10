// =============================================================================
// ActivityFeed.tsx — Circle activity timeline from IPFS receipt chain
// =============================================================================
//
// PURPOSE:
//   Renders a social-style event feed for a circle by walking the IPFS receipt
//   chain. Each receipt becomes a timeline entry with an icon, description,
//   timestamp, and optional details. This gives circles a "living" feel —
//   members can see everything that's happened in chronological order.
//
// HOW IT WORKS:
//   1. Takes the latestReceiptCID from the circle's on-chain state
//   2. Fetches that receipt from IPFS via the Storacha gateway
//   3. Follows the previousReceiptCID links to build the full chain
//   4. Renders each receipt as a timeline entry (newest first)
//
// WHY CLIENT-SIDE CHAIN WALKING (not a single API call)?
//   The receipt chain IS the data source — there's no centralized database.
//   Each receipt lives at its own CID on IPFS. Walking the chain is the
//   only way to reconstruct history from decentralized storage. We limit
//   to MAX_EVENTS to avoid fetching ancient history on long-running circles.
//
// DESIGN:
//   - Left-aligned timeline with a vertical line and colored dots
//   - Each action type has its own icon and color scheme
//   - Relative timestamps ("2 min ago") for recent, absolute for older
//   - Expandable details for receipts with extra data (amounts, cycles)
// =============================================================================

'use client';

import { useState, useEffect } from 'react';

// =============================================================================
// Types — mirrors ReceiptData from receipt-service.ts
// =============================================================================

interface Receipt {
  circleId: string;
  action: string;
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
  previousReceiptCID?: string | null;
  transactionId?: string;
  receiptVersion?: number;
  uploadedAt?: string;
}

interface FeedEvent {
  cid: string;
  receipt: Receipt;
}

// =============================================================================
// Action Configuration — icon, color, and label for each action type
// =============================================================================
//
// Each action type from the receipt chain maps to a visual treatment.
// The dot color and icon create instant visual scanning — green for positive
// actions (joins, contributions), amber for cycle events, red for penalties.

const ACTION_CONFIG: Record<string, {
  icon: string;    // SVG path for the timeline dot icon
  label: string;   // Human-readable action name
  color: string;   // Tailwind text color for the dot/icon
  bgColor: string; // Tailwind background for the dot
  ringColor: string; // Ring color around the dot
}> = {
  circle_created: {
    icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6', // Plus icon
    label: 'Circle Created',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/15',
    ringColor: 'ring-sky-500/30',
  },
  member_joined: {
    icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z', // User plus
    label: 'Member Joined',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    ringColor: 'ring-emerald-500/30',
  },
  circle_sealed: {
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', // Shield check
    label: 'Circle Sealed',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/15',
    ringColor: 'ring-violet-500/30',
  },
  contribution: {
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', // Dollar circle
    label: 'Contribution',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    ringColor: 'ring-emerald-500/30',
  },
  payout_executed: {
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6', // Trending up
    label: 'Payout Executed',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/15',
    ringColor: 'ring-amber-500/30',
  },
  member_penalized: {
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', // Warning triangle
    label: 'Member Penalized',
    color: 'text-red-400',
    bgColor: 'bg-red-500/15',
    ringColor: 'ring-red-500/30',
  },
  cycle_advanced: {
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', // Refresh
    label: 'Cycle Advanced',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/15',
    ringColor: 'ring-sky-500/30',
  },
  circle_completed: {
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', // Check circle
    label: 'Circle Completed',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    ringColor: 'ring-emerald-500/30',
  },
  deposit_returned: {
    icon: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6', // Arrow return
    label: 'Deposit Returned',
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-500/15',
    ringColor: 'ring-zinc-500/30',
  },
};

// Fallback for unknown action types (future-proofing)
const DEFAULT_ACTION = {
  icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  label: 'Event',
  color: 'text-zinc-400',
  bgColor: 'bg-zinc-500/15',
  ringColor: 'ring-zinc-500/30',
};

// =============================================================================
// Time Formatting — relative for recent, absolute for older
// =============================================================================
//
// "2 min ago" is more meaningful than "2026-03-09T14:32:00Z" for recent events.
// We switch to absolute dates for anything older than 24 hours, since relative
// times like "3 days ago" become less precise and useful.

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  // Older than 24 hours — show date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// =============================================================================
// Address Truncation — "0xf8d6e0...20c7"
// =============================================================================

function truncAddr(addr: string): string {
  if (!addr || addr.length <= 10) return addr || 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// =============================================================================
// Build Description — human-readable summary from receipt data
// =============================================================================
//
// Converts raw receipt data into a sentence a non-technical user understands.
// The details object contains action-specific fields (amount, cycle, recipient)
// that we weave into the description.

function buildDescription(receipt: Receipt): string {
  const actor = truncAddr(receipt.actor);
  const details = receipt.details || {};

  switch (receipt.action) {
    case 'circle_created':
      return `${actor} created this circle`;
    case 'member_joined':
      return `${actor} joined the circle`;
    case 'circle_sealed':
      return `Circle sealed — all members joined`;
    case 'contribution': {
      const amount = details.amount ? `${parseFloat(String(details.amount)).toFixed(2)} FLOW` : '';
      const cycle = details.cycle ? `for cycle ${details.cycle}` : '';
      return `${actor} contributed ${amount} ${cycle}`.trim();
    }
    case 'payout_executed': {
      const recipient = details.recipient ? truncAddr(String(details.recipient)) : 'recipient';
      const amount = details.amount ? `${parseFloat(String(details.amount)).toFixed(2)} FLOW` : '';
      return `Payout of ${amount} sent to ${recipient}`.trim();
    }
    case 'member_penalized': {
      const penalty = details.penaltyAmount ? `${parseFloat(String(details.penaltyAmount)).toFixed(2)} FLOW` : '';
      return `${actor} penalized ${penalty} for missing contribution`.trim();
    }
    case 'cycle_advanced': {
      const cycle = details.newCycle || details.cycle;
      return cycle ? `Cycle advanced to ${cycle}` : 'Cycle advanced';
    }
    case 'circle_completed':
      return 'Circle completed — all cycles finished';
    case 'deposit_returned': {
      const amount = details.amount ? `${parseFloat(String(details.amount)).toFixed(2)} FLOW` : '';
      return `Deposit of ${amount} returned to ${actor}`.trim();
    }
    default:
      return `${actor} performed an action`;
  }
}

// =============================================================================
// ActivityFeed Component
// =============================================================================
//
// PROPS:
//   latestReceiptCID: The CID of the most recent receipt on the chain.
//     Fetched from circle.latestReceiptCID in the circle detail page.
//     If null/empty, shows an empty state.
//
// LOADING STRATEGY:
//   We fetch receipts one-by-one following the chain, up to MAX_EVENTS.
//   Each fetch is a single IPFS gateway request (~100-300ms). For a circle
//   with 10 events, total load time is 1-3 seconds. We show events as they
//   load (streaming UX) rather than waiting for the full chain.

const MAX_EVENTS = 20; // Cap to avoid fetching hundreds of old receipts

export function ActivityFeed({ latestReceiptCID }: { latestReceiptCID?: string | null }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!latestReceiptCID) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]);

    // Walk the receipt chain, adding events as we fetch them
    // This creates a "streaming" effect where events appear one by one
    async function fetchChain() {
      let currentCID: string | null | undefined = latestReceiptCID;
      let depth = 0;
      const collected: FeedEvent[] = [];

      try {
        while (currentCID && depth < MAX_EVENTS) {
          if (cancelled) return;
          depth++;

          const response = await fetch(`https://${currentCID}.ipfs.w3s.link`);
          if (!response.ok) {
            // Don't fail entirely — show what we have so far
            if (collected.length === 0) {
              setError('Could not fetch activity data');
            }
            break;
          }

          const receipt: Receipt = await response.json();
          const event: FeedEvent = { cid: currentCID, receipt };
          collected.push(event);

          // Update state progressively — events appear as they load
          if (!cancelled) {
            setEvents([...collected]);
          }

          currentCID = receipt.previousReceiptCID;
        }
      } catch {
        if (collected.length === 0) {
          setError('Failed to load activity feed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchChain();
    return () => { cancelled = true; };
  }, [latestReceiptCID]);

  // ── Empty state: no receipt CID means no history yet ──
  if (!latestReceiptCID) {
    return (
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h3 className="text-sm font-semibold text-zinc-100">Activity</h3>
        <p className="mt-3 text-center text-sm text-zinc-500">
          No activity yet — events will appear here as the circle progresses.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden">
      {/* Header with loading indicator */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-zinc-100">Activity</h3>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-400" />
              Loading...
            </span>
          )}
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Error state */}
      {error && events.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-zinc-500">
          {error}
        </div>
      )}

      {/* Timeline */}
      {events.length > 0 && (
        <div className="relative px-5 py-4">
          {/* Vertical timeline line — positioned behind the dots */}
          <div className="absolute left-[29px] top-4 bottom-4 w-px bg-gradient-to-b from-zinc-700/60 via-zinc-800/40 to-transparent" />

          <div className="space-y-0">
            {events.map((event, i) => {
              const config = ACTION_CONFIG[event.receipt.action] || DEFAULT_ACTION;
              const isFirst = i === 0;

              return (
                <TimelineEntry
                  key={event.cid}
                  event={event}
                  config={config}
                  isFirst={isFirst}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Loading skeleton when no events yet */}
      {loading && events.length === 0 && (
        <div className="space-y-4 px-5 py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-7 w-7 animate-pulse rounded-full bg-zinc-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
                <div className="h-2.5 w-48 animate-pulse rounded bg-zinc-800/60" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TimelineEntry — Single event in the feed
// =============================================================================
//
// Each entry has:
//   - Colored dot with action icon (left side)
//   - Description text with actor and action details
//   - Relative timestamp (right side)
//   - Optional IPFS link to the raw receipt (on hover/click)
//
// The first entry (most recent) gets a subtle glow to draw attention.

function TimelineEntry({
  event,
  config,
  isFirst,
}: {
  event: FeedEvent;
  config: typeof DEFAULT_ACTION;
  isFirst: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const description = buildDescription(event.receipt);
  const hasDetails = Object.keys(event.receipt.details || {}).length > 0;

  return (
    <div
      className={`group relative flex items-start gap-3 py-2.5 ${
        isFirst ? 'opacity-100' : 'opacity-80 hover:opacity-100'
      } transition-opacity`}
    >
      {/* Timeline dot — the colored circle with an icon inside */}
      <div
        className={`relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${config.bgColor} ring-1 ${config.ringColor} ${
          isFirst ? 'ring-2' : ''
        }`}
      >
        <svg
          className={`h-3.5 w-3.5 ${config.color}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
        </svg>
      </div>

      {/* Event content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* Action label */}
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
              {config.label}
            </span>
            {/* Description */}
            <p className="mt-0.5 text-sm text-zinc-300 leading-snug">
              {description}
            </p>
          </div>
          {/* Timestamp */}
          <span className="flex-shrink-0 text-[11px] text-zinc-600">
            {formatTime(event.receipt.timestamp)}
          </span>
        </div>

        {/* Expandable details — only if the receipt has extra data */}
        {hasDetails && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-1 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            <svg
              className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? 'Hide details' : 'View details'}
          </button>
        )}

        {expanded && (
          <div className="mt-2 rounded-lg bg-zinc-800/40 px-3 py-2 text-[11px] space-y-1">
            {/* Render each detail key-value pair */}
            {Object.entries(event.receipt.details || {}).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-zinc-500 capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="font-mono text-zinc-300">{String(value)}</span>
              </div>
            ))}
            {/* Transaction ID link — if available, links to Flowscan */}
            {event.receipt.transactionId && (
              <div className="flex items-center justify-between border-t border-zinc-700/40 pt-1 mt-1">
                <span className="text-zinc-500">Transaction</span>
                <a
                  href={`https://testnet.flowscan.io/transaction/${event.receipt.transactionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  {event.receipt.transactionId.slice(0, 12)}...
                </a>
              </div>
            )}
            {/* IPFS receipt link */}
            <div className="flex items-center justify-between border-t border-zinc-700/40 pt-1 mt-1">
              <span className="text-zinc-500">Receipt (IPFS)</span>
              <a
                href={`https://${event.cid}.ipfs.w3s.link`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-emerald-500 hover:text-emerald-400 transition-colors"
              >
                {event.cid.slice(0, 12)}...
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
