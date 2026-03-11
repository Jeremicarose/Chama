// =============================================================================
// AchievementBadge.tsx — Single achievement badge display
// =============================================================================
//
// PURPOSE:
//   Renders one achievement as a circular badge with an emoji icon.
//   Two states: unlocked (colored, glowing) and locked (dim, grayscale).
//   Used in the AchievementBanner (dashboard), achievements page, and
//   as mini badges in member rows.
//
// VISUAL DESIGN:
//   - Unlocked: Tier-colored border, subtle glow, full-color emoji
//   - Locked: Zinc border, no glow, dimmed with lock overlay
//   - Hover: Shows achievement name in a tooltip
//   - The circular shape echoes the ScoreRing from ReputationCard,
//     creating visual consistency across the gamification layer
// =============================================================================

'use client';

import { useState } from 'react';
import { type AchievementStatus, TIER_CONFIG } from '@/lib/achievements';

// =============================================================================
// Full Badge — used in banner and achievements page
// =============================================================================

export function AchievementBadge({
  achievement,
  size = 'md',
}: {
  achievement: AchievementStatus;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tier = TIER_CONFIG[achievement.tier];

  // Size variants — sm for member rows, md for banner, lg for achievements page
  const sizeClasses = {
    sm: 'h-7 w-7 text-sm',
    md: 'h-10 w-10 text-lg',
    lg: 'h-14 w-14 text-2xl',
  }[size];

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Badge circle */}
      <div
        className={`flex items-center justify-center rounded-full border-2 transition-all duration-300 ${
          achievement.unlocked
            ? `${tier.borderColor} ${tier.bgColor} shadow-lg ${tier.glowColor}`
            : 'border-zinc-800 bg-zinc-900/40 opacity-40'
        } ${sizeClasses}`}
      >
        <span className={achievement.unlocked ? '' : 'grayscale'}>
          {achievement.icon}
        </span>
      </div>

      {/* Tooltip — shows on hover */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 shadow-xl">
          <p className="text-xs font-semibold text-zinc-100">{achievement.name}</p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {achievement.unlocked ? achievement.description : achievement.criteria}
          </p>
          {achievement.unlocked && (
            <span className={`mt-1 inline-block text-[9px] font-semibold uppercase tracking-wider ${tier.textColor}`}>
              {tier.label}
            </span>
          )}
          {/* Tooltip arrow */}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Mini Badge — compact version for inline use (member rows)
// =============================================================================
//
// Just the emoji, no border/glow. Used in tight spaces where the full
// badge would be too large. Title attribute provides hover info.

export function MiniBadge({ achievement }: { achievement: AchievementStatus }) {
  if (!achievement.unlocked) return null;
  return (
    <span
      className="cursor-default text-xs"
      title={`${achievement.name}: ${achievement.description}`}
    >
      {achievement.icon}
    </span>
  );
}
