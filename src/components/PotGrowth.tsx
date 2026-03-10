// =============================================================================
// PotGrowth.tsx — Animated pot visualization for circle pool balance
// =============================================================================
//
// PURPOSE:
//   Replaces the static "Pool Balance" number with a visual, animated
//   representation of how full the pot is. Think of a glass filling up
//   with water — members can SEE the pot growing as contributions come in.
//   This creates emotional engagement: "the pot is almost full!"
//
// HOW IT WORKS:
//   - Takes current poolBalance and the target payout amount
//   - Calculates fill percentage (pool / payout)
//   - Renders an SVG "container" with an animated liquid fill
//   - The liquid uses a wave animation (CSS keyframes) for a natural feel
//   - Color transitions from amber (empty) through emerald (filling) to
//     bright green (full) — reinforcing the "growth" metaphor
//
// ANIMATION APPROACH:
//   Two layered sine waves create a realistic liquid surface effect.
//   The fill height transitions smoothly with CSS, while the wave
//   animation runs continuously. When the pot reaches 100%, a subtle
//   glow/pulse effect triggers to celebrate completion.
//
// WHY SVG (not canvas or CSS)?
//   SVG is declarative, accessible, and integrates seamlessly with React's
//   rendering model. The wave effect uses SVG path elements with CSS
//   animations — no requestAnimationFrame loop, no canvas context, no
//   extra dependencies. Pure SVG + CSS = minimal bundle impact.
// =============================================================================

'use client';

import { useState, useEffect } from 'react';

// =============================================================================
// Props
// =============================================================================

interface PotGrowthProps {
  poolBalance: number;   // Current FLOW in the pool
  targetAmount: number;  // Expected payout amount (contribution * members)
  memberCount: number;   // Total members in the circle
  contributedCount: number; // Members who've contributed this cycle
}

// =============================================================================
// Color Interpolation — smooth gradient from empty to full
// =============================================================================
//
// Rather than hard color boundaries, we interpolate between three stops:
//   0% = amber (waiting)    → rgb(251, 191, 36)
//  50% = emerald (growing)  → rgb(52, 211, 153)
// 100% = green (full/ready) → rgb(34, 197, 94)
//
// This gives a natural "warming up" feel as contributions flow in.

function getFillColor(pct: number): string {
  if (pct >= 90) return '#22c55e'; // green-500 — full
  if (pct >= 60) return '#34d399'; // emerald-400 — almost there
  if (pct >= 30) return '#38bdf8'; // sky-400 — building
  return '#fbbf24'; // amber-400 — just started
}

function getGlowColor(pct: number): string {
  if (pct >= 90) return 'rgba(34, 197, 94, 0.3)';
  if (pct >= 60) return 'rgba(52, 211, 153, 0.2)';
  if (pct >= 30) return 'rgba(56, 189, 248, 0.15)';
  return 'rgba(251, 191, 36, 0.1)';
}

// =============================================================================
// PotGrowth Component
// =============================================================================

export function PotGrowth({ poolBalance, targetAmount, memberCount, contributedCount }: PotGrowthProps) {
  // Animate the fill on mount and when balance changes
  const [animatedPct, setAnimatedPct] = useState(0);
  const rawPct = targetAmount > 0 ? Math.min((poolBalance / targetAmount) * 100, 100) : 0;

  // Delayed animation — starts at 0 and animates to actual value
  // This creates the "filling up" effect when the page loads
  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPct(rawPct), 100);
    return () => clearTimeout(timer);
  }, [rawPct]);

  const fillColor = getFillColor(animatedPct);
  const glowColor = getGlowColor(animatedPct);
  const isFull = animatedPct >= 100;

  // SVG dimensions — the "container" is a rounded rectangle
  const width = 200;
  const height = 140;
  const containerPadding = 8;
  const innerWidth = width - containerPadding * 2;
  const innerHeight = height - containerPadding * 2 - 20; // 20px for top "opening"

  // Fill height based on percentage
  const fillHeight = (animatedPct / 100) * innerHeight;

  return (
    <div className="relative flex flex-col items-center">
      {/* Glow behind the pot — grows with fill level */}
      <div
        className="absolute inset-0 rounded-3xl blur-2xl transition-all duration-1000"
        style={{ backgroundColor: glowColor }}
      />

      <div className="relative">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="drop-shadow-lg"
        >
          {/* Definitions — wave clip path and gradients */}
          <defs>
            {/* Clip path for the liquid inside the container */}
            <clipPath id="pot-clip">
              <rect
                x={containerPadding + 2}
                y={containerPadding + 20}
                width={innerWidth - 4}
                height={innerHeight}
                rx={12}
              />
            </clipPath>

            {/* Liquid gradient — darker at bottom, lighter at surface */}
            <linearGradient id="liquid-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.9" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* Container outline — the "pot" shape */}
          <rect
            x={containerPadding}
            y={containerPadding}
            width={innerWidth}
            height={innerHeight + 20}
            rx={16}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1.5}
          />

          {/* Container background */}
          <rect
            x={containerPadding + 0.75}
            y={containerPadding + 0.75}
            width={innerWidth - 1.5}
            height={innerHeight + 18.5}
            rx={15}
            fill="rgba(255,255,255,0.02)"
          />

          {/* Liquid fill — clipped to container interior */}
          <g clipPath="url(#pot-clip)">
            {/* Main liquid body */}
            <rect
              x={containerPadding}
              y={height - containerPadding - fillHeight}
              width={innerWidth}
              height={fillHeight + 10}
              fill="url(#liquid-gradient)"
              className="transition-all duration-1000 ease-out"
            />

            {/* Wave layer 1 — slower, larger amplitude */}
            <g
              className="animate-wave-slow"
              style={{
                transform: `translateY(${height - containerPadding - fillHeight}px)`,
                transition: 'transform 1s ease-out',
              }}
            >
              <path
                d={`M ${containerPadding} 0
                    Q ${containerPadding + innerWidth * 0.25} -6, ${containerPadding + innerWidth * 0.5} 0
                    Q ${containerPadding + innerWidth * 0.75} 6, ${containerPadding + innerWidth} 0
                    L ${containerPadding + innerWidth} 10
                    L ${containerPadding} 10 Z`}
                fill={fillColor}
                opacity={0.6}
              />
            </g>

            {/* Wave layer 2 — faster, smaller amplitude, offset phase */}
            <g
              className="animate-wave-fast"
              style={{
                transform: `translateY(${height - containerPadding - fillHeight + 2}px)`,
                transition: 'transform 1s ease-out',
              }}
            >
              <path
                d={`M ${containerPadding} 0
                    Q ${containerPadding + innerWidth * 0.25} 4, ${containerPadding + innerWidth * 0.5} 0
                    Q ${containerPadding + innerWidth * 0.75} -4, ${containerPadding + innerWidth} 0
                    L ${containerPadding + innerWidth} 10
                    L ${containerPadding} 10 Z`}
                fill={fillColor}
                opacity={0.3}
              />
            </g>
          </g>

          {/* Bubble particles — small circles that float up when filling */}
          {animatedPct > 0 && animatedPct < 100 && (
            <>
              <circle cx={width * 0.3} cy={height - 30} r={2} fill={fillColor} opacity={0.4} className="animate-bubble-1" />
              <circle cx={width * 0.5} cy={height - 25} r={1.5} fill={fillColor} opacity={0.3} className="animate-bubble-2" />
              <circle cx={width * 0.7} cy={height - 35} r={2.5} fill={fillColor} opacity={0.35} className="animate-bubble-3" />
            </>
          )}

          {/* Full indicator — checkmark when pot is complete */}
          {isFull && (
            <g className="animate-fade-in">
              <circle cx={width / 2} cy={height / 2} r={20} fill={fillColor} opacity={0.2} />
              <path
                d={`M ${width / 2 - 8} ${height / 2} l 6 6 l 10 -12`}
                fill="none"
                stroke={fillColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Balance text below the pot */}
      <div className="relative mt-3 text-center">
        <p className="text-2xl font-bold tracking-tight text-zinc-100">
          {poolBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="ml-1 text-sm font-medium text-zinc-500">FLOW</span>
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {animatedPct.toFixed(0)}% of {targetAmount.toFixed(2)} FLOW target
        </p>
      </div>

      {/* Member contribution dots — visual indicator of who's paid */}
      <div className="relative mt-3 flex items-center gap-1.5">
        {Array.from({ length: memberCount }).map((_, i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full transition-all duration-500 ${
              i < contributedCount
                ? 'bg-emerald-400 shadow-sm shadow-emerald-400/40'
                : 'bg-zinc-700'
            }`}
            title={i < contributedCount ? 'Contributed' : 'Pending'}
          />
        ))}
      </div>

      {/* Inline CSS for wave animations */}
      {/* Using <style> tag because Tailwind doesn't have built-in wave keyframes.
          These animations create the liquid surface effect by translating
          the wave SVG paths left/right on a loop. */}
      <style jsx>{`
        @keyframes wave-slow {
          0%, 100% { transform: translateX(-5px) translateY(var(--wave-y, 0)); }
          50% { transform: translateX(5px) translateY(var(--wave-y, 0)); }
        }
        @keyframes wave-fast {
          0%, 100% { transform: translateX(4px) translateY(var(--wave-y, 0)); }
          50% { transform: translateX(-4px) translateY(var(--wave-y, 0)); }
        }
        @keyframes bubble-rise {
          0% { opacity: 0.4; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-40px); }
        }
        @keyframes fade-in {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1); }
        }
        .animate-wave-slow { animation: wave-slow 3s ease-in-out infinite; }
        .animate-wave-fast { animation: wave-fast 2s ease-in-out infinite; }
        .animate-bubble-1 { animation: bubble-rise 3s ease-out infinite; }
        .animate-bubble-2 { animation: bubble-rise 2.5s ease-out infinite 0.5s; }
        .animate-bubble-3 { animation: bubble-rise 3.5s ease-out infinite 1s; }
        .animate-fade-in { animation: fade-in 0.5s ease-out forwards; }
      `}</style>
    </div>
  );
}
