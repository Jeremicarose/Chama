// =============================================================================
// AchievementBanner.tsx — Dashboard achievement strip
// =============================================================================
//
// PURPOSE:
//   Shows a compact, horizontally scrollable row of all achievements on the
//   dashboard. Unlocked badges are colored and glowing, locked ones are dimmed.
//   This is the primary gamification touchpoint — users see their progress
//   every time they open the app.
//
// WHY SHOW LOCKED BADGES TOO?
//   Showing what you HAVEN'T unlocked is key to engagement. It creates a
//   "completion urge" — the same psychology that makes game achievement lists
//   addictive. "I have 4/12... what do I need to get the next one?"
//
// PROPS:
//   achievements: AchievementStatus[] — pre-computed from checkAchievements()
//   The parent (dashboard) owns the data fetching so we don't duplicate queries.
// =============================================================================

'use client';

import Link from 'next/link';
import { type AchievementStatus } from '@/lib/achievements';
import { AchievementBadge } from './AchievementBadge';

export function AchievementBanner({ achievements }: { achievements: AchievementStatus[] }) {
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const totalCount = achievements.length;

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏆</span>
          <h3 className="text-sm font-semibold text-zinc-100">Achievements</h3>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
            {unlockedCount}/{totalCount}
          </span>
        </div>
        <Link
          href="/achievements"
          className="text-[11px] font-medium text-emerald-500 transition-colors hover:text-emerald-400"
        >
          View All
        </Link>
      </div>

      {/* Scrollable badge row */}
      <div className="flex items-center gap-3 overflow-x-auto px-5 py-4 scrollbar-thin scrollbar-thumb-zinc-700">
        {/* Show unlocked first, then locked — unlocked badges are more rewarding to see */}
        {[...achievements]
          .sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? -1 : 1))
          .map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} size="md" />
          ))}
      </div>

      {/* Progress bar — visual fill showing completion percentage */}
      <div className="px-5 pb-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-600 via-yellow-500 to-emerald-400 transition-all duration-700"
            style={{ width: `${totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}
