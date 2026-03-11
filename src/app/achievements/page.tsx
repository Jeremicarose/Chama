// =============================================================================
// achievements/page.tsx — Full achievements gallery
// =============================================================================
//
// PURPOSE:
//   Dedicated page showing all achievements grouped by tier with progress
//   stats. This is the "trophy room" — users come here to see their full
//   collection and plan which badges to pursue next.
//
// LAYOUT:
//   - Progress header: X/12 unlocked, tier breakdown
//   - Tier sections: Bronze → Silver → Gold → Platinum
//   - Each badge is a card with icon, name, description, and lock state
//   - Unlocked cards get tier-colored borders and glow effects
// =============================================================================

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { computeReputation } from '@/lib/reputation';
import {
  checkAchievements,
  TIER_CONFIG,
  type AchievementStatus,
  type AchievementTier,
} from '@/lib/achievements';
import { AchievementBadge } from '@/components/AchievementBadge';

// Tier display order
const TIER_ORDER: AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum'];

export default function AchievementsPage() {
  const { user } = useCurrentUser();
  const [achievements, setAchievements] = useState<AchievementStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user.addr) {
      setLoading(false);
      return;
    }

    computeReputation(user.addr)
      .then((score) => {
        setAchievements(checkAchievements(score));
      })
      .catch(() => setAchievements([]))
      .finally(() => setLoading(false));
  }, [user.addr]);

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const totalCount = achievements.length;

  // Group achievements by tier
  const grouped = TIER_ORDER.map((tier) => ({
    tier,
    config: TIER_CONFIG[tier],
    achievements: achievements.filter((a) => a.tier === tier),
  }));

  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-32 text-center">
        <span className="text-4xl">🏆</span>
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">Achievements</h1>
        <p className="mt-2 text-sm text-zinc-500">Connect your wallet to view your achievements.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Dashboard
      </Link>

      {/* Header */}
      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Achievements</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Earn badges by participating in savings circles. Your progress is tracked on-chain.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-16 flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
          <p className="text-sm text-zinc-500">Loading achievements...</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Progress Summary */}
          <div className="mt-6 rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-zinc-100">
                  {unlockedCount}
                  <span className="text-lg text-zinc-500">/{totalCount}</span>
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">achievements unlocked</p>
              </div>
              {/* Tier breakdown — mini counters */}
              <div className="flex gap-3">
                {grouped.map(({ tier, config, achievements: tierAchievements }) => {
                  const tierUnlocked = tierAchievements.filter((a) => a.unlocked).length;
                  return (
                    <div key={tier} className="text-center">
                      <p className={`text-lg font-bold ${config.textColor}`}>{tierUnlocked}</p>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-600">{config.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Overall progress bar */}
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-600 via-yellow-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Achievement Grid — grouped by tier */}
          {grouped.map(({ tier, config, achievements: tierAchievements }) => (
            <div key={tier} className="mt-8">
              <div className="flex items-center gap-2">
                <h2 className={`text-sm font-semibold ${config.textColor}`}>{config.label}</h2>
                <span className="text-xs text-zinc-600">
                  {tierAchievements.filter((a) => a.unlocked).length}/{tierAchievements.length}
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {tierAchievements.map((achievement) => (
                  <div
                    key={achievement.id}
                    className={`rounded-xl border p-4 transition-all duration-300 ${
                      achievement.unlocked
                        ? `${config.borderColor} ${config.bgColor} shadow-lg ${config.glowColor}`
                        : 'border-zinc-800/60 bg-zinc-900/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <AchievementBadge achievement={achievement} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className={`font-semibold ${achievement.unlocked ? 'text-zinc-100' : 'text-zinc-500'}`}>
                          {achievement.name}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500 leading-relaxed">
                          {achievement.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] text-zinc-600">{achievement.criteria}</span>
                      {achievement.unlocked ? (
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.textColor}`}>
                          Unlocked
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-700">Locked</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
