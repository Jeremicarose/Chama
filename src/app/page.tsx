// =============================================================================
// page.tsx — Dashboard (home page) showing user's savings circles
// =============================================================================
//
// PURPOSE:
//   The main landing page after wallet connection. Shows:
//   - Hero section when not connected (explains what Chama is)
//   - User's circles when connected (cards with status, members, balance)
//   - Quick actions: Create Circle, Join Circle
//
// DATA FLOW:
//   1. User connects wallet → useCurrentUser() gives us their address
//   2. We query ChamaManager.getMemberCircles(addr) → list of circle IDs
//   3. For each ID, query ChamaCircle.getState() → full circle data
//   4. Render circle cards with status badges and action buttons
//
// WHY CLIENT COMPONENT?
//   Reads wallet state (useCurrentUser) and makes FCL queries (useEffect).
//   Server Components can't do either of these.
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';

// =============================================================================
// Cadence Scripts (embedded as template strings for FCL)
// =============================================================================
//
// WHY INLINE SCRIPTS (not .cdc files)?
//   FCL's fcl.query() takes Cadence code as a string. We could read .cdc
//   files at build time, but inline strings are simpler for the frontend
//   and allow FCL's address substitution (0xChamaManager → real address).

const GET_MEMBER_CIRCLES_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(member: Address): [UInt64] {
    return ChamaManager.getMemberCircles(member: member)
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

const GET_CIRCLE_HOST_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(circleId: UInt64): Address? {
    return ChamaManager.getCircleHost(circleId: circleId)
}
`;

// =============================================================================
// Types for the circle state returned by Cadence
// =============================================================================
//
// These mirror the Cadence CircleState struct. FCL returns Cadence structs
// as plain JavaScript objects with string values (UFix64 → string, etc.).

interface CircleStateData {
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
  members: Array<{
    address: string;
    hasContributed: boolean;
    totalContributed: string;
    isDelinquent: boolean;
    delinquencyCount: string;
    rotationPosition: string;
  }>;
  poolBalance: string;
  nextDeadline: string;
  nextRecipient: string | null;
  latestReceiptCID: string;
}

// =============================================================================
// Status helpers
// =============================================================================

// Maps Cadence CircleStatus enum rawValue to display label.
// rawValue is a UInt8: 0=FORMING, 1=ACTIVE, 2=COMPLETED, 3=CANCELLED
const STATUS_LABELS: Record<string, string> = {
  '0': 'Forming',
  '1': 'Active',
  '2': 'Completed',
  '3': 'Cancelled',
};

// Tailwind classes for status badge colors.
// Green = active (in progress), Blue = forming (waiting), Gray = done.
const STATUS_COLORS: Record<string, string> = {
  '0': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  '1': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  '2': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  '3': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

// =============================================================================
// Component
// =============================================================================

export default function Dashboard() {
  const { user } = useCurrentUser();
  const [circles, setCircles] = useState<CircleStateData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Fetch user's circles from the blockchain
  // -------------------------------------------------------------------------
  //
  // FLOW:
  //   1. getMemberCircles(addr) returns [UInt64] — array of circle IDs
  //   2. For each ID, getCircleHost(id) returns the host address
  //   3. getState(host, id) returns the full CircleState struct
  //
  // WHY useCallback?
  //   We call fetchCircles from useEffect and potentially from a refresh
  //   button. useCallback ensures the function reference is stable across
  //   re-renders, preventing infinite useEffect loops.
  const fetchCircles = useCallback(async () => {
    if (!user.addr) return;

    setLoading(true);
    setError(null);

    try {
      // Step 1: Get the list of circle IDs for this user
      const circleIds: string[] = await fcl.query({
        cadence: GET_MEMBER_CIRCLES_SCRIPT,
        args: (arg: any, t: any) => [arg(user.addr, t.Address)],
      });

      if (!circleIds || circleIds.length === 0) {
        setCircles([]);
        setLoading(false);
        return;
      }

      // Step 2 & 3: For each circle ID, get the host and then the state
      // We use Promise.all to fetch all circles in parallel — much faster
      // than sequential fetching for users with many circles.
      const circleStates = await Promise.all(
        circleIds.map(async (id) => {
          // Get the host address for this circle
          const host: string | null = await fcl.query({
            cadence: GET_CIRCLE_HOST_SCRIPT,
            args: (arg: any, t: any) => [arg(id, t.UInt64)],
          });

          if (!host) return null;

          // Get the full circle state
          const state: CircleStateData = await fcl.query({
            cadence: GET_CIRCLE_STATE_SCRIPT,
            args: (arg: any, t: any) => [
              arg(host, t.Address),
              arg(id, t.UInt64),
            ],
          });

          return state;
        })
      );

      // Filter out nulls (circles where host lookup failed)
      setCircles(circleStates.filter((s): s is CircleStateData => s !== null));
    } catch (err) {
      console.error('Failed to fetch circles:', err);
      setError('Failed to load circles. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user.addr]);

  // -------------------------------------------------------------------------
  // Auto-fetch when user connects or address changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (user.loggedIn && user.addr) {
      fetchCircles();
    } else {
      setCircles([]);
    }
  }, [user.loggedIn, user.addr, fetchCircles]);

  // =========================================================================
  // RENDER: Not connected → show hero/landing
  // =========================================================================
  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        {/* Hero heading */}
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          Trustless Savings Circles
        </h1>

        {/* Subtitle explaining the value proposition */}
        <p className="mt-4 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Create and join rotating savings circles powered by Flow blockchain.
          Automated payouts, transparent contributions, no middleman required.
        </p>

        {/* Feature highlights */}
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {[
            {
              title: 'Automated Payouts',
              desc: 'Scheduled transactions execute payouts at the deadline — no human intervention.',
            },
            {
              title: 'Penalty Enforcement',
              desc: 'Security deposits protect against freeloaders. Miss a payment, lose a portion.',
            },
            {
              title: 'Verifiable Receipts',
              desc: 'Every action produces an IPFS receipt. Tamper-proof audit trail via Storacha.',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-zinc-200 p-6 text-left dark:border-zinc-800"
            >
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>

        {/* CTA: Connect wallet to get started */}
        <p className="mt-12 text-sm text-zinc-500 dark:text-zinc-500">
          Connect your wallet above to get started.
        </p>
      </div>
    );
  }

  // =========================================================================
  // RENDER: Connected → show dashboard
  // =========================================================================
  return (
    <div>
      {/* ── Header with title + create button ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          My Circles
        </h1>
        <Link
          href="/create"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          + Create Circle
        </Link>
      </div>

      {/* ── Loading state ── */}
      {loading && (
        <div className="mt-12 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-emerald-600" />
        </div>
      )}

      {/* ── Error state ── */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
          <button
            onClick={fetchCircles}
            className="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && circles.length === 0 && (
        <div className="mt-12 flex flex-col items-center rounded-xl border-2 border-dashed border-zinc-300 py-16 dark:border-zinc-700">
          <p className="text-zinc-500 dark:text-zinc-400">
            You haven&apos;t joined any circles yet.
          </p>
          <Link
            href="/create"
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Create Your First Circle
          </Link>
        </div>
      )}

      {/* ── Circle Cards Grid ── */}
      {/* Responsive: 1 column on mobile, 2 on tablet, 3 on desktop */}
      {!loading && circles.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {circles.map((circle) => {
            const statusRaw = circle.status.rawValue;
            return (
              <Link
                key={circle.circleId}
                href={`/circle/${circle.circleId}`}
                className="group rounded-xl border border-zinc-200 p-5 transition-all hover:border-emerald-300 hover:shadow-md dark:border-zinc-800 dark:hover:border-emerald-700"
              >
                {/* Circle name + status badge */}
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-zinc-900 group-hover:text-emerald-700 dark:text-zinc-50 dark:group-hover:text-emerald-400">
                    {circle.config.name}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[statusRaw] || STATUS_COLORS['0']}`}
                  >
                    {STATUS_LABELS[statusRaw] || 'Unknown'}
                  </span>
                </div>

                {/* Circle stats */}
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-500">Contribution</p>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {parseFloat(circle.config.contributionAmount).toFixed(2)} FLOW
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-500">Members</p>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {circle.members.length}/{circle.config.maxMembers}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-500">Cycle</p>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {circle.currentCycle}/{circle.config.maxMembers}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-500">Pool</p>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {parseFloat(circle.poolBalance).toFixed(2)} FLOW
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
