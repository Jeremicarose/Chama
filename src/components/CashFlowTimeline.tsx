// =============================================================================
// CashFlowTimeline.tsx — Upcoming payouts across all circles
// =============================================================================
//
// PURPOSE:
//   Gives users a "financial planning" view of their Chama participation.
//   Shows upcoming payouts and contributions across ALL their circles in
//   chronological order, so they can see at a glance:
//   - When they'll receive a payout (and from which circle)
//   - When they need to contribute next (and how much)
//   - Their net cash flow position (in vs out)
//
// WHY THIS MATTERS FOR HACKATHON:
//   Most ROSCA apps show individual circles in isolation. This cross-circle
//   view is unique — it treats Chama as a financial tool, not just a group
//   savings app. Judges will see this as a "product" feature, not just "tech."
//
// DATA SOURCE:
//   Takes the same circle state data already fetched on the dashboard.
//   No additional on-chain queries needed — we derive the timeline from:
//   - nextDeadline: When the current cycle ends
//   - nextRecipient: Who receives the payout
//   - contributionAmount: How much each member must pay
//   - currentCycle + maxMembers: To predict future cycles
//
// DESIGN:
//   Horizontal scrollable timeline with cards for each event.
//   Green cards = incoming payouts (you're the recipient)
//   Amber cards = outgoing contributions (you need to pay)
//   Each card shows: circle name, amount, time until event
// =============================================================================

'use client';

// =============================================================================
// Types
// =============================================================================

interface CircleData {
  circleId: string;
  config: {
    name: string;
    contributionAmount: string;
    cycleDuration: string;
    maxMembers: string;
  };
  status: { rawValue: string };
  currentCycle: string;
  members: Array<{
    address: string;
    hasContributed: boolean;
    rotationPosition: string;
  }>;
  nextDeadline: string;
  nextRecipient: string | null;
}

interface TimelineEvent {
  circleId: string;
  circleName: string;
  type: 'payout' | 'contribution';
  amount: number;
  timestamp: number; // Unix seconds
  isYou: boolean;    // true if you're the recipient (for payouts)
  cycle: number;
  hasContributed: boolean; // for contribution events — have you already paid?
}

// =============================================================================
// Time Formatting
// =============================================================================

function formatRelativeTime(unixSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = unixSeconds - now;

  if (diff <= 0) return 'Now';

  const minutes = Math.floor(diff / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// =============================================================================
// Build Timeline — derive events from circle states
// =============================================================================
//
// For each active circle, we create two types of events:
//   1. Contribution event: You need to pay contributionAmount by nextDeadline
//   2. Payout event: The nextRecipient gets paid when the cycle executes
//
// We only show events for active circles (status === '1') since forming
// and completed circles don't have upcoming deadlines.

function buildTimeline(circles: CircleData[], userAddr: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const circle of circles) {
    // Only active circles have upcoming events
    if (circle.status.rawValue !== '1') continue;

    const deadline = parseFloat(circle.nextDeadline);
    if (deadline <= 0) continue;

    const contributionAmount = parseFloat(circle.config.contributionAmount);
    const maxMembers = parseInt(circle.config.maxMembers);
    const currentCycle = parseInt(circle.currentCycle);
    const payoutAmount = contributionAmount * maxMembers;

    // Find if current user has contributed this cycle
    const userMember = circle.members.find((m) => m.address === userAddr);
    const hasContributed = userMember?.hasContributed ?? false;

    // Contribution event — user needs to pay
    if (!hasContributed) {
      events.push({
        circleId: circle.circleId,
        circleName: circle.config.name,
        type: 'contribution',
        amount: contributionAmount,
        timestamp: deadline,
        isYou: true,
        cycle: currentCycle,
        hasContributed: false,
      });
    }

    // Payout event — someone receives the pot
    if (circle.nextRecipient) {
      events.push({
        circleId: circle.circleId,
        circleName: circle.config.name,
        type: 'payout',
        amount: payoutAmount,
        timestamp: deadline,
        isYou: circle.nextRecipient === userAddr,
        cycle: currentCycle,
        hasContributed,
      });
    }
  }

  // Sort by timestamp — nearest events first
  events.sort((a, b) => a.timestamp - b.timestamp);

  return events;
}

// =============================================================================
// CashFlowTimeline Component
// =============================================================================
//
// PROPS:
//   circles: Array of circle states (already fetched on dashboard)
//   userAddr: Current user's Flow address
//
// Shows nothing if there are no upcoming events (all circles completed/forming)

export function CashFlowTimeline({
  circles,
  userAddr,
}: {
  circles: CircleData[];
  userAddr: string;
}) {
  const events = buildTimeline(circles, userAddr);

  if (events.length === 0) return null;

  // Calculate net position: incoming payouts minus outgoing contributions
  const netFlow = events.reduce((sum, e) => {
    if (e.type === 'payout' && e.isYou) return sum + e.amount;
    if (e.type === 'contribution') return sum - e.amount;
    return sum;
  }, 0);

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <h3 className="text-sm font-semibold text-zinc-100">Cash Flow</h3>
        </div>
        {/* Net position indicator */}
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
          netFlow > 0
            ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
            : netFlow < 0
              ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
              : 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20'
        }`}>
          {netFlow >= 0 ? '+' : ''}{netFlow.toFixed(2)} FLOW net
        </span>
      </div>

      {/* Scrollable timeline */}
      <div className="flex gap-3 overflow-x-auto px-5 py-4 scrollbar-thin scrollbar-thumb-zinc-700">
        {events.map((event, i) => (
          <TimelineCard key={`${event.circleId}-${event.type}-${i}`} event={event} />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// TimelineCard — Individual event in the cash flow timeline
// =============================================================================
//
// VISUAL LANGUAGE:
//   - Green border + up arrow = incoming payout (money coming TO you)
//   - Amber border + down arrow = outgoing contribution (money going OUT)
//   - Bold "You!" badge if you're the payout recipient
//   - Subtle pulse on urgent events (deadline < 10 minutes)

function TimelineCard({ event }: { event: TimelineEvent }) {
  const isPayout = event.type === 'payout';
  const isUrgent = event.timestamp - Date.now() / 1000 < 600; // < 10 min
  const isYourPayout = isPayout && event.isYou;

  return (
    <a
      href={`/circle/${event.circleId}`}
      className={`group flex-shrink-0 w-48 rounded-xl border p-3.5 transition-all duration-200 hover:shadow-lg ${
        isYourPayout
          ? 'border-emerald-500/30 bg-emerald-500/[0.04] hover:border-emerald-500/50 hover:shadow-emerald-500/10'
          : isPayout
            ? 'border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600/60'
            : 'border-amber-500/20 bg-amber-500/[0.03] hover:border-amber-500/40 hover:shadow-amber-500/10'
      } ${isUrgent ? 'animate-pulse-subtle' : ''}`}
    >
      {/* Event type indicator */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
          isPayout ? 'text-emerald-400' : 'text-amber-400'
        }`}>
          {isPayout ? (
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          ) : (
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
          {isPayout ? 'Payout' : 'Due'}
        </div>
        {isYourPayout && (
          <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300">
            You!
          </span>
        )}
      </div>

      {/* Circle name */}
      <p className="mt-2 truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
        {event.circleName}
      </p>

      {/* Amount */}
      <p className={`mt-1 text-lg font-bold tracking-tight ${
        isYourPayout ? 'text-emerald-400' : isPayout ? 'text-zinc-300' : 'text-amber-400'
      }`}>
        {isPayout ? '+' : '-'}{event.amount.toFixed(2)}
        <span className="ml-1 text-xs font-medium text-zinc-500">FLOW</span>
      </p>

      {/* Time until event */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">
          {formatRelativeTime(event.timestamp)}
        </span>
        <span className="text-[10px] text-zinc-600">
          Cycle {event.cycle}
        </span>
      </div>

      {/* Deadline date */}
      <p className="mt-0.5 text-[10px] text-zinc-600">
        {formatDate(event.timestamp)}
      </p>

      {/* Subtle animation styles */}
      <style jsx>{`
        @keyframes pulse-subtle {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-subtle {
          animation: pulse-subtle 2s ease-in-out infinite;
        }
      `}</style>
    </a>
  );
}
