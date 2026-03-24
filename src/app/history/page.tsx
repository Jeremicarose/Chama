// =============================================================================
// history/page.tsx — Circle event history from on-chain events
// =============================================================================
//
// PURPOSE:
//   Displays the full event history for each circle the user belongs to.
//   Uses on-chain events from Flow's REST API instead of IPFS receipts,
//   so it works without any Storacha configuration.
//
// DATA FLOW:
//   1. Fetch user's circle IDs from ChamaManager
//   2. User selects a circle
//   3. Fetch all on-chain events for that circleId via Flow REST API
//   4. Render events as a vertical timeline
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { fetchCircleEvents, type CircleActivity } from '@/lib/flow-events';
import { fmtFlow, useFlowPrice } from '@/lib/currency';

// =============================================================================
// Cadence Scripts
// =============================================================================

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
}

// =============================================================================
// Action Config
// =============================================================================

const ACTION_CONFIG: Record<string, { label: string; color: string; dotColor: string; icon: string }> = {
  circle_created:   { label: 'Circle Created',   color: 'bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20',         dotColor: 'bg-sky-500',     icon: '+' },
  member_joined:    { label: 'Member Joined',     color: 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20', dotColor: 'bg-indigo-500',  icon: '\u2192' },
  circle_sealed:    { label: 'Circle Sealed',     color: 'bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20', dotColor: 'bg-purple-500',  icon: '\u25CF' },
  contribution:     { label: 'Contribution',      color: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20', dotColor: 'bg-emerald-500', icon: '$' },
  payout_executed:  { label: 'Payout Executed',   color: 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20',   dotColor: 'bg-green-500',   icon: '\u2191' },
  member_penalized: { label: 'Member Penalized',  color: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',         dotColor: 'bg-red-500',     icon: '!' },
  cycle_advanced:   { label: 'Cycle Advanced',    color: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',   dotColor: 'bg-amber-500',   icon: '\u00BB' },
  circle_completed: { label: 'Circle Completed',  color: 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20',      dotColor: 'bg-zinc-500',    icon: '\u2713' },
  deposit_returned: { label: 'Deposit Returned',  color: 'bg-teal-500/10 text-teal-400 ring-1 ring-teal-500/20',      dotColor: 'bg-teal-500',    icon: '\u2190' },
  deposit_slashed:  { label: 'Deposit Slashed',   color: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',         dotColor: 'bg-red-500',     icon: '\u2717' },
};

// =============================================================================
// Helpers
// =============================================================================

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function truncAddr(addr: string): string {
  if (!addr || addr.length <= 10) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const STATUS_LABELS: Record<string, string> = {
  '0': 'Forming', '1': 'Active', '2': 'Completed', '3': 'Cancelled',
};

function buildDescription(event: CircleActivity): string {
  const d = event.data;
  switch (event.action) {
    case 'circle_created':
      return `Circle "${d.name || ''}" created`;
    case 'member_joined':
      return `${truncAddr(String(d.member || ''))} joined`;
    case 'circle_sealed':
      return 'All members joined — cycles started';
    case 'contribution':
      return `${truncAddr(String(d.member || ''))} contributed ${d.amount || '?'} FLOW`;
    case 'payout_executed':
      return `${d.amount || '?'} FLOW paid to ${truncAddr(String(d.recipient || ''))}`;
    case 'member_penalized':
      return `${truncAddr(String(d.member || ''))} penalized (cycle ${d.cycle || '?'})`;
    case 'cycle_advanced':
      return `Advanced to cycle ${d.newCycle || '?'}`;
    case 'circle_completed':
      return 'All cycles finished — deposits returned';
    case 'deposit_returned':
      return `${d.amount || '?'} FLOW returned to ${truncAddr(String(d.member || ''))}`;
    case 'deposit_slashed':
      return `${d.penaltyAmount || '?'} FLOW slashed from ${truncAddr(String(d.member || ''))}`;
    default:
      return 'Event occurred';
  }
}

// =============================================================================
// Component
// =============================================================================

export default function HistoryPage() {
  const { user } = useCurrentUser();
  const { formatFiat } = useFlowPrice();

  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [loadingCircles, setLoadingCircles] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<CircleSummary | null>(null);
  const [events, setEvents] = useState<CircleActivity[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  // ── Fetch user's circles ──
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
            args: (arg: any, t: any) => [arg(host, t.Address), arg(id, t.UInt64)],
          });
          return {
            circleId: state.circleId,
            name: state.config.name,
            status: state.status.rawValue,
          } as CircleSummary;
        })
      );
      setCircles(summaries.filter((s): s is CircleSummary => s !== null));
    } catch (err) {
      console.error('Failed to fetch circles:', err);
    } finally {
      setLoadingCircles(false);
    }
  }, [user.addr]);

  useEffect(() => {
    if (user.loggedIn && user.addr) fetchCircles();
  }, [user.loggedIn, user.addr, fetchCircles]);

  // ── Fetch events for selected circle ──
  async function handleSelectCircle(circle: CircleSummary) {
    setSelectedCircle(circle);
    setEvents([]);
    setEventError(null);
    setLoadingEvents(true);

    try {
      const result = await fetchCircleEvents(circle.circleId);
      setEvents(result);
    } catch (err: any) {
      setEventError(err.message || 'Failed to load events');
    } finally {
      setLoadingEvents(false);
    }
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
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Dashboard
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Receipt History</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          On-chain event history for your savings circles. Every action is recorded
          on the Flow blockchain and verifiable on Flowscan.
        </p>
      </div>

      {/* ── Circle Selector ── */}
      <div className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Select a Circle</h2>

        {loadingCircles && (
          <div className="mt-4 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
          </div>
        )}

        {!loadingCircles && circles.length === 0 && (
          <div className="mt-3 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No circles found.{' '}
            <Link href="/create" className="text-emerald-500 hover:text-emerald-400 transition-colors">Create one</Link>
            {' '}or{' '}
            <Link href="/join" className="text-emerald-500 hover:text-emerald-400 transition-colors">join one</Link>
            {' '}to get started.
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

      {/* ── Event Timeline ── */}
      {selectedCircle && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-100">
              {selectedCircle.name}
              <span className="ml-2 text-sm font-normal text-zinc-500">events</span>
            </h2>
            {events.length > 0 && (
              <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
                {events.length} event{events.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Loading */}
          {loadingEvents && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
              <p className="text-sm text-zinc-500">Fetching on-chain events...</p>
            </div>
          )}

          {/* Error */}
          {eventError && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {eventError}
            </div>
          )}

          {/* Empty */}
          {!loadingEvents && !eventError && events.length === 0 && (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
              No events recorded yet for this circle.
            </div>
          )}

          {/* Timeline */}
          {events.length > 0 && (
            <div className="relative mt-6">
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-zinc-700 via-zinc-800 to-transparent" />

              <div className="space-y-0">
                {events.map((event, index) => {
                  const config = ACTION_CONFIG[event.action] || {
                    label: event.action, color: 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20',
                    dotColor: 'bg-zinc-500', icon: '?',
                  };

                  const desc = buildDescription(event);
                  const flowAmount = event.data.amount ? parseFloat(String(event.data.amount)) : null;

                  return (
                    <div key={`${event.transactionId}-${event.action}-${index}`} className="relative flex gap-4 pb-6 pl-9">
                      <div className={`absolute left-1 top-1.5 h-[9px] w-[9px] rounded-full ring-2 ring-zinc-950 ${config.dotColor}`} />

                      <div className="flex-1 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700/80 hover:bg-zinc-900/60">
                        {/* Top row */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${config.color}`}>
                            {config.label}
                          </span>
                          <span className="text-xs text-zinc-600">{formatTimestamp(event.timestamp)}</span>
                          {index === 0 && (
                            <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                              Latest
                            </span>
                          )}
                        </div>

                        {/* Description */}
                        <p className="mt-2 text-sm text-zinc-300">{desc}</p>

                        {/* Fiat equivalent for amount events */}
                        {flowAmount !== null && flowAmount > 0 && (
                          <p className="mt-1 text-[11px] text-zinc-600">
                            {fmtFlow(flowAmount)} FLOW {formatFiat(flowAmount) && `(${formatFiat(flowAmount)})`}
                          </p>
                        )}

                        {/* Details grid */}
                        {Object.keys(event.data).length > 0 && (
                          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl bg-zinc-800/30 px-3 py-2.5 text-xs sm:grid-cols-2 md:grid-cols-3">
                            {Object.entries(event.data).map(([key, value]) => (
                              <div key={key}>
                                <span className="text-zinc-600">{key.replace(/([A-Z])/g, ' $1').trim()}: </span>
                                <span className="font-medium text-zinc-300">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Transaction link */}
                        {event.transactionId && (
                          <div className="mt-3 border-t border-zinc-800/60 pt-2.5 text-[11px] text-zinc-600">
                            <a
                              href={`https://testnet.flowscan.io/transaction/${event.transactionId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono transition-colors hover:text-emerald-500"
                            >
                              TX: {event.transactionId.slice(0, 16)}...
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* End marker */}
              {events.length > 0 && (
                <div className="relative flex items-center gap-4 pl-9">
                  <div className="absolute left-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
                  <p className="text-xs text-zinc-600">
                    {events.length} event{events.length !== 1 ? 's' : ''} on-chain
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
