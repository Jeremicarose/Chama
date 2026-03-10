// =============================================================================
// page.tsx — Dashboard (home page) showing user's savings circles
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { ReputationCard } from '@/components/ReputationCard';
import { CashFlowTimeline } from '@/components/CashFlowTimeline';

// =============================================================================
// Cadence Scripts
// =============================================================================

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
// Types
// =============================================================================

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
// Helpers
// =============================================================================

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

// =============================================================================
// Feature data for hero section
// =============================================================================

const FEATURES = [
  {
    title: 'Automated Payouts',
    desc: 'Scheduled transactions execute payouts at the deadline — no human intervention needed.',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Penalty Enforcement',
    desc: 'Security deposits protect against freeloaders. Miss a payment, lose a portion of your deposit.',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    title: 'Verifiable Receipts',
    desc: 'Every action produces an IPFS receipt. Tamper-proof audit trail powered by Storacha.',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

// =============================================================================
// Component
// =============================================================================

export default function Dashboard() {
  const { user } = useCurrentUser();
  const [circles, setCircles] = useState<CircleStateData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCircles = useCallback(async () => {
    if (!user.addr) return;
    setLoading(true);
    setError(null);
    try {
      const circleIds: string[] = await fcl.query({
        cadence: GET_MEMBER_CIRCLES_SCRIPT,
        args: (arg: any, t: any) => [arg(user.addr, t.Address)],
      });
      if (!circleIds || circleIds.length === 0) {
        setCircles([]);
        setLoading(false);
        return;
      }
      const circleStates = await Promise.all(
        circleIds.map(async (id) => {
          const host: string | null = await fcl.query({
            cadence: GET_CIRCLE_HOST_SCRIPT,
            args: (arg: any, t: any) => [arg(id, t.UInt64)],
          });
          if (!host) return null;
          const state: CircleStateData = await fcl.query({
            cadence: GET_CIRCLE_STATE_SCRIPT,
            args: (arg: any, t: any) => [arg(host, t.Address), arg(id, t.UInt64)],
          });
          return state;
        })
      );
      setCircles(circleStates.filter((s): s is CircleStateData => s !== null));
    } catch (err) {
      console.error('Failed to fetch circles:', err);
      setError('Failed to load circles. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user.addr]);

  useEffect(() => {
    if (user.loggedIn && user.addr) {
      fetchCircles();
    } else {
      setCircles([]);
    }
  }, [user.loggedIn, user.addr, fetchCircles]);

  // =========================================================================
  // RENDER: Not connected — Hero/Landing
  // =========================================================================
  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center">
        {/* Decorative gradient orbs */}
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 h-[500px] w-[500px] rounded-full bg-emerald-500/[0.03] blur-3xl" />

        <p className="relative text-sm font-medium uppercase tracking-widest text-emerald-500">
          Powered by Flow Blockchain
        </p>

        <h1 className="relative mt-4 text-4xl font-bold tracking-tight text-zinc-50 sm:text-6xl">
          Trustless Savings
          <br />
          <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
            Circles
          </span>
        </h1>

        <p className="relative mt-6 max-w-lg text-lg leading-relaxed text-zinc-400">
          Create and join rotating savings circles with automated payouts,
          transparent contributions, and no middleman required.
        </p>

        {/* Feature cards */}
        <div className="relative mt-16 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-6 text-left backdrop-blur-sm transition-all duration-300 hover:border-zinc-700/80 hover:bg-zinc-900/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 transition-colors group-hover:bg-emerald-500/15">
                {feature.icon}
              </div>
              <h3 className="mt-4 font-semibold text-zinc-100">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>

        <p className="relative mt-16 text-sm text-zinc-600">
          Connect your wallet above to get started
        </p>
      </div>
    );
  }

  // =========================================================================
  // RENDER: Connected — Dashboard
  // =========================================================================
  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            My Circles
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {circles.length > 0
              ? `${circles.length} circle${circles.length !== 1 ? 's' : ''} active`
              : 'Your savings circles will appear here'}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/join"
            className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-800/80"
          >
            Join Circle
          </Link>
          <Link
            href="/create"
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30"
          >
            + Create Circle
          </Link>
        </div>
      </div>

      {/* ── Reputation Card ── */}
      {/* Shows the user's Trust Score computed from their on-chain history.  */}
      {/* Positioned prominently because reputation is the "identity layer"  */}
      {/* that makes Chama more than just a savings tool.                    */}
      {user.addr && (
        <div className="mt-6">
          <ReputationCard address={user.addr} />
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="mt-16 flex flex-col items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
          <p className="mt-3 text-sm text-zinc-500">Loading your circles...</p>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
          <button onClick={fetchCircles} className="ml-auto text-red-400/80 underline hover:text-red-300">
            Retry
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && circles.length === 0 && (
        <div className="mt-16 flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/50 ring-1 ring-zinc-700/50">
            <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <p className="mt-4 text-zinc-400">You haven&apos;t joined any circles yet.</p>
          <div className="mt-6 flex gap-3">
            <Link
              href="/join"
              className="rounded-xl border border-zinc-700/80 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-600"
            >
              Join a Circle
            </Link>
            <Link
              href="/create"
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500"
            >
              Create Your First Circle
            </Link>
          </div>
        </div>
      )}

      {/* ── Circle Cards ── */}
      {!loading && circles.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {circles.map((circle) => {
            const statusRaw = circle.status.rawValue;
            const statusConf = STATUS_CONFIG[statusRaw] || STATUS_CONFIG['0'];
            const memberProgress = parseInt(circle.config.maxMembers) > 0
              ? (circle.members.length / parseInt(circle.config.maxMembers)) * 100
              : 0;

            return (
              <Link
                key={circle.circleId}
                href={`/circle/${circle.circleId}`}
                className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-sm transition-all duration-300 hover:border-zinc-700/60 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-emerald-500/[0.03]"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                {/* Name + Status */}
                <div className="relative flex items-start justify-between">
                  <h3 className="font-semibold text-zinc-100 transition-colors group-hover:text-emerald-400">
                    {circle.config.name}
                  </h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusConf.color}`}>
                    {statusConf.label}
                  </span>
                </div>

                {/* Stats */}
                <div className="relative mt-5 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-zinc-600">Contribution</p>
                    <p className="mt-0.5 font-medium text-zinc-200">
                      {fmtFlow(circle.config.contributionAmount)} FLOW
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-zinc-600">Pool</p>
                    <p className="mt-0.5 font-medium text-emerald-400">
                      {fmtFlow(circle.poolBalance)} FLOW
                    </p>
                  </div>
                </div>

                {/* Member progress bar */}
                <div className="relative mt-4">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Members {circle.members.length}/{circle.config.maxMembers}</span>
                    <span>Cycle {circle.currentCycle}/{circle.config.maxMembers}</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${memberProgress}%` }}
                    />
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
