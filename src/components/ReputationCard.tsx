// =============================================================================
// ReputationCard.tsx — Trust Score display component
// =============================================================================
//
// PURPOSE:
//   Renders a user's Chama Trust Score as a visual card with a circular
//   progress ring, grade label, and breakdown of the four scoring pillars.
//   Used on the Dashboard (for the current user) and Circle Detail page
//   (for any member when you click their address).
//
// DESIGN DECISIONS:
//   - Circular progress ring: Universally understood "score" visualization.
//     The ring fills clockwise from 0-100, colored by grade (green=good, red=bad).
//   - Four-pillar breakdown: Transparent scoring builds trust in the system.
//     Users can see exactly WHY their score is what it is, not just a number.
//   - Compact variant: For inline use (member rows). Full variant for dashboard.
//
// THE RING ANIMATION:
//   Uses SVG stroke-dasharray/dashoffset for the progress ring. The circle
//   has a circumference of 2*PI*r. We set dasharray to the circumference
//   and dashoffset to (1 - progress) * circumference. The CSS transition
//   handles the animation. This is the standard technique for circular
//   progress — no libraries needed.
// =============================================================================

'use client';

import { useState, useEffect } from 'react';
import {
  computeReputation,
  getGrade,
  type ReputationScore,
} from '@/lib/reputation';

// =============================================================================
// Score Ring — SVG circular progress indicator
// =============================================================================
//
// PARAMETERS:
//   score: 0-100 value that determines how much of the ring is filled
//   size: pixel diameter of the ring
//   strokeWidth: thickness of the ring stroke
//
// MATH:
//   radius = (size - strokeWidth) / 2
//   circumference = 2 * PI * radius
//   offset = circumference * (1 - score/100)
//   The offset "hides" the unfilled portion by shifting the dash pattern

function ScoreRing({ score, size = 80, strokeWidth = 6 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const grade = getGrade(score);

  // Map grade colors to SVG stroke colors
  const strokeColor = score >= 90
    ? '#34d399' // emerald-400
    : score >= 70
      ? '#38bdf8' // sky-400
      : score >= 50
        ? '#fbbf24' // amber-400
        : score >= 30
          ? '#fb923c' // orange-400
          : '#f87171'; // red-400

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background ring — the full circle in a muted color */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        {/* Foreground ring — filled portion with grade-based color */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      {/* Score number in the center */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-bold ${grade.color}`}>{score}</span>
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">score</span>
      </div>
    </div>
  );
}

// =============================================================================
// Pillar Bar — Individual scoring pillar with mini progress bar
// =============================================================================
//
// Shows one of the four pillars (consistency, reliability, experience, standing)
// as a labeled bar with current/max values. The bar width is proportional.

function PillarBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-500">{label}</span>
        <span className="font-medium text-zinc-300">{value}/{max}</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/60 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Full Reputation Card — Dashboard / Profile view
// =============================================================================

export function ReputationCard({ address }: { address: string }) {
  const [score, setScore] = useState<ReputationScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    computeReputation(address)
      .then(setScore)
      .catch(() => setScore(null))
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 animate-pulse rounded-full bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
          </div>
        </div>
      </div>
    );
  }

  if (!score) return null;

  const grade = getGrade(score.total);

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-sm">
      {/* Header: ring + grade + stats */}
      <div className="flex items-center gap-5">
        <ScoreRing score={score.total} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">Trust Score</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              score.total >= 70
                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                : score.total >= 50
                  ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
                  : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
            }`}>
              {grade.label}
            </span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-zinc-500">
            <span>{score.circleCount} circle{score.circleCount !== 1 ? 's' : ''}</span>
            <span>{score.totalCyclesContributed} contribution{score.totalCyclesContributed !== 1 ? 's' : ''}</span>
            {score.totalDelinquencies > 0 && (
              <span className="text-red-400/70">{score.totalDelinquencies} missed</span>
            )}
          </div>
        </div>
      </div>

      {/* Pillar breakdown — transparent scoring builds trust */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <PillarBar label="Consistency" value={score.consistency} max={40} />
        <PillarBar label="Reliability" value={score.reliability} max={30} />
        <PillarBar label="Experience" value={score.experience} max={20} />
        <PillarBar label="Standing" value={score.standing} max={10} />
      </div>
    </div>
  );
}

// =============================================================================
// Compact Score Badge — For member rows and inline use
// =============================================================================
//
// Just the ring and grade label, no breakdown. Used in member lists
// where space is limited but trust signals are still valuable.

export function ReputationBadge({ address }: { address: string }) {
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (!address) return;
    computeReputation(address).then((s) => setScore(s.total)).catch(() => {});
  }, [address]);

  if (score === null) return null;

  const grade = getGrade(score);

  return (
    <div className="flex items-center gap-1.5" title={`Trust Score: ${score}/100 (${grade.label})`}>
      <ScoreRing score={score} size={28} strokeWidth={3} />
    </div>
  );
}
