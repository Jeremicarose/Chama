// =============================================================================
// ActivityFeed.tsx — Circle activity timeline from on-chain events
// =============================================================================
//
// PURPOSE:
//   Renders a social-style event feed for a circle by querying on-chain events
//   from the ChamaCircle contract. Each event becomes a timeline entry with an
//   icon, description, timestamp, and optional details.
//
// WHY ON-CHAIN EVENTS (not IPFS receipts)?
//   The previous IPFS approach required Storacha configuration (env vars) and
//   produced extra wallet popups. On-chain events are always available — every
//   ChamaCircle action emits events automatically. No configuration needed.
//
// DATA FLOW:
//   1. Takes circleId as prop
//   2. Calls fetchCircleEvents() which queries Flow's REST API
//   3. Gets all events for this circle (joins, contributions, payouts, etc.)
//   4. Renders as a vertical timeline (newest first)
// =============================================================================

'use client';

import { useState, useEffect } from 'react';
import { fetchCircleEvents, type CircleActivity } from '@/lib/flow-events';

// =============================================================================
// Action Configuration — icon, color, and label for each action type
// =============================================================================

const ACTION_CONFIG: Record<string, {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
  ringColor: string;
}> = {
  circle_created: {
    icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6',
    label: 'Circle Created',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/15',
    ringColor: 'ring-sky-500/30',
  },
  member_joined: {
    icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z',
    label: 'Member Joined',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    ringColor: 'ring-emerald-500/30',
  },
  circle_sealed: {
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    label: 'Circle Sealed',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/15',
    ringColor: 'ring-violet-500/30',
  },
  contribution: {
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Contribution',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    ringColor: 'ring-emerald-500/30',
  },
  payout_executed: {
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    label: 'Payout Executed',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/15',
    ringColor: 'ring-amber-500/30',
  },
  member_penalized: {
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    label: 'Member Penalized',
    color: 'text-red-400',
    bgColor: 'bg-red-500/15',
    ringColor: 'ring-red-500/30',
  },
  cycle_advanced: {
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    label: 'Cycle Advanced',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/15',
    ringColor: 'ring-sky-500/30',
  },
  circle_completed: {
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Circle Completed',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    ringColor: 'ring-emerald-500/30',
  },
  deposit_returned: {
    icon: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
    label: 'Deposit Returned',
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/15',
    ringColor: 'ring-teal-500/30',
  },
  deposit_slashed: {
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    label: 'Deposit Slashed',
    color: 'text-red-400',
    bgColor: 'bg-red-500/15',
    ringColor: 'ring-red-500/30',
  },
};

const DEFAULT_ACTION = {
  icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  label: 'Event',
  color: 'text-zinc-400',
  bgColor: 'bg-zinc-500/15',
  ringColor: 'ring-zinc-500/30',
};

// =============================================================================
// Helpers
// =============================================================================

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function truncAddr(addr: string): string {
  if (!addr || addr.length <= 10) return addr || 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function buildDescription(event: CircleActivity): string {
  const d = event.data;

  switch (event.action) {
    case 'circle_created':
      return `Circle "${d.name || ''}" created with ${d.contributionAmount || '?'} FLOW contribution`;
    case 'member_joined':
      return `${truncAddr(String(d.member || ''))} joined the circle`;
    case 'circle_sealed':
      return 'Circle sealed — all members joined, cycles starting';
    case 'contribution':
      return `${truncAddr(String(d.member || ''))} contributed ${d.amount || '?'} FLOW (cycle ${d.cycle || '?'})`;
    case 'payout_executed':
      return `Payout of ${d.amount || '?'} FLOW sent to ${truncAddr(String(d.recipient || ''))}`;
    case 'member_penalized':
      return `${truncAddr(String(d.member || ''))} penalized for missing cycle ${d.cycle || '?'}`;
    case 'cycle_advanced':
      return `Cycle advanced to ${d.newCycle || '?'}`;
    case 'circle_completed':
      return 'Circle completed — all cycles finished, deposits returned';
    case 'deposit_returned':
      return `${d.amount || '?'} FLOW deposit returned to ${truncAddr(String(d.member || ''))}`;
    case 'deposit_slashed':
      return `${d.penaltyAmount || '?'} FLOW slashed from ${truncAddr(String(d.member || ''))}`;
    default:
      return 'Event occurred';
  }
}

// =============================================================================
// ActivityFeed Component
// =============================================================================

export function ActivityFeed({ circleId }: { circleId: string }) {
  const [events, setEvents] = useState<CircleActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!circleId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchCircleEvents(circleId)
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load events');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [circleId]);

  // ── Empty state ──
  if (!loading && events.length === 0 && !error) {
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-zinc-100">Activity</h3>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-400" />
              Loading...
            </span>
          )}
          {events.length > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
              {events.length} event{events.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && events.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-zinc-500">{error}</div>
      )}

      {/* Timeline */}
      {events.length > 0 && (
        <div className="relative px-5 py-4">
          <div className="absolute left-[29px] top-4 bottom-4 w-px bg-gradient-to-b from-zinc-700/60 via-zinc-800/40 to-transparent" />

          <div className="space-y-0">
            {events.map((event, i) => {
              const config = ACTION_CONFIG[event.action] || DEFAULT_ACTION;
              return (
                <TimelineEntry
                  key={`${event.transactionId}-${event.action}-${i}`}
                  event={event}
                  config={config}
                  isFirst={i === 0}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
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
// TimelineEntry
// =============================================================================

function TimelineEntry({
  event,
  config,
  isFirst,
}: {
  event: CircleActivity;
  config: typeof DEFAULT_ACTION;
  isFirst: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const description = buildDescription(event);
  const hasDetails = Object.keys(event.data).length > 0;

  return (
    <div
      className={`group relative flex items-start gap-3 py-2.5 ${
        isFirst ? 'opacity-100' : 'opacity-80 hover:opacity-100'
      } transition-opacity`}
    >
      {/* Timeline dot */}
      <div
        className={`relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${config.bgColor} ring-1 ${config.ringColor} ${
          isFirst ? 'ring-2' : ''
        }`}
      >
        <svg className={`h-3.5 w-3.5 ${config.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
        </svg>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
              {config.label}
            </span>
            <p className="mt-0.5 text-sm text-zinc-300 leading-snug">{description}</p>
          </div>
          <span className="flex-shrink-0 text-[11px] text-zinc-600">
            {formatTime(event.timestamp)}
          </span>
        </div>

        {/* Expandable details */}
        {hasDetails && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-1 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? 'Hide details' : 'View details'}
          </button>
        )}

        {expanded && (
          <div className="mt-2 rounded-lg bg-zinc-800/40 px-3 py-2 text-[11px] space-y-1">
            {Object.entries(event.data).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-zinc-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                <span className="font-mono text-zinc-300">{String(value)}</span>
              </div>
            ))}
            {event.transactionId && (
              <div className="flex items-center justify-between border-t border-zinc-700/40 pt-1 mt-1">
                <span className="text-zinc-500">Transaction</span>
                <a
                  href={`https://testnet.flowscan.io/transaction/${event.transactionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  {event.transactionId.slice(0, 12)}...
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
