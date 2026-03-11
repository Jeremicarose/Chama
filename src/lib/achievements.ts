// =============================================================================
// achievements.ts — Gamification layer for Chama
// =============================================================================
//
// PURPOSE:
//   Defines achievements (badges) that users unlock through participation.
//   Achievements are computed client-side from the same ReputationScore data
//   already being fetched — zero additional on-chain queries needed.
//
// WHY GAMIFICATION?
//   ROSCAs are inherently social, but most Web3 implementations feel like
//   cold ledgers. Achievements create emotional engagement:
//   - "I'm 2 contributions away from Gold tier!"
//   - "Only 3 people have Diamond Hands in this circle"
//   - Competition drives consistent participation (which is the whole point)
//
// DESIGN DECISIONS:
//   - 12 achievements across 4 tiers (bronze/silver/gold/platinum)
//   - All computed from existing ReputationScore data (no new state)
//   - Stored in localStorage for unlock tracking (hackathon-practical)
//   - Emoji icons — universally understood, zero bundle size impact
//   - Pure functions — easy to test, no side effects
// =============================================================================

import type { ReputationScore } from './reputation';

// =============================================================================
// Types
// =============================================================================

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;         // Emoji — zero-cost, universally rendered
  tier: AchievementTier;
  criteria: string;     // Human-readable unlock condition
}

export interface AchievementStatus extends Achievement {
  unlocked: boolean;
}

// =============================================================================
// Tier Configuration — visual styling per tier
// =============================================================================
//
// Colors follow the traditional medal hierarchy. The glow/ring colors
// create a "premium" feel for higher tiers — platinum literally glows.

export const TIER_CONFIG: Record<AchievementTier, {
  label: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  glowColor: string;
}> = {
  bronze: {
    label: 'Bronze',
    borderColor: 'border-amber-700/50',
    bgColor: 'bg-amber-900/20',
    textColor: 'text-amber-600',
    glowColor: 'shadow-amber-700/20',
  },
  silver: {
    label: 'Silver',
    borderColor: 'border-zinc-400/40',
    bgColor: 'bg-zinc-500/10',
    textColor: 'text-zinc-400',
    glowColor: 'shadow-zinc-400/20',
  },
  gold: {
    label: 'Gold',
    borderColor: 'border-yellow-500/50',
    bgColor: 'bg-yellow-500/10',
    textColor: 'text-yellow-500',
    glowColor: 'shadow-yellow-500/30',
  },
  platinum: {
    label: 'Platinum',
    borderColor: 'border-emerald-400/50',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-400',
    glowColor: 'shadow-emerald-400/30',
  },
};

// =============================================================================
// Achievement Definitions — 12 badges across 4 tiers
// =============================================================================
//
// Each achievement maps to a specific behavior we want to encourage.
// The tier reflects difficulty — bronze for showing up, platinum for mastery.

export const ACHIEVEMENTS: Achievement[] = [
  // ── Bronze Tier — Getting started (everyone should unlock these) ──
  {
    id: 'first_step',
    name: 'First Step',
    description: 'Made your first contribution to a circle',
    icon: '🌱',
    tier: 'bronze',
    criteria: '1+ contribution',
  },
  {
    id: 'circle_joiner',
    name: 'Circle Joiner',
    description: 'Joined your first savings circle',
    icon: '🤝',
    tier: 'bronze',
    criteria: '1+ circle joined',
  },
  {
    id: 'team_player',
    name: 'Team Player',
    description: 'Contributed to 5 cycles across all circles',
    icon: '⚡',
    tier: 'bronze',
    criteria: '5+ cycles contributed',
  },

  // ── Silver Tier — Building habits ──
  {
    id: 'consistent',
    name: 'Consistent',
    description: 'Made 10 or more contributions across all circles',
    icon: '🔄',
    tier: 'silver',
    criteria: '10+ contributions',
  },
  {
    id: 'reliable',
    name: 'Reliable',
    description: 'Participated in 3+ circles with zero missed payments',
    icon: '🛡️',
    tier: 'silver',
    criteria: '3+ circles, 0 delinquencies',
  },
  {
    id: 'high_roller',
    name: 'High Roller',
    description: 'Contributed 50+ FLOW across all circles',
    icon: '💎',
    tier: 'silver',
    criteria: '50+ FLOW contributed',
  },

  // ── Gold Tier — Mastery ──
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Participated in 5 or more circles',
    icon: '🏅',
    tier: 'gold',
    criteria: '5+ circles',
  },
  {
    id: 'perfect_record',
    name: 'Perfect Record',
    description: 'Made 10+ contributions with zero missed payments ever',
    icon: '🎯',
    tier: 'gold',
    criteria: '10+ contributions, 0 delinquencies',
  },
  {
    id: 'trusted',
    name: 'Trusted',
    description: 'Achieved a Trust Score of 90 or higher',
    icon: '⭐',
    tier: 'gold',
    criteria: 'Trust Score ≥ 90',
  },

  // ── Platinum Tier — Legend status ──
  {
    id: 'og',
    name: 'OG',
    description: 'Participated in 10 or more circles',
    icon: '👑',
    tier: 'platinum',
    criteria: '10+ circles',
  },
  {
    id: 'diamond_hands',
    name: 'Diamond Hands',
    description: 'Contributed 100+ FLOW total across all circles',
    icon: '💰',
    tier: 'platinum',
    criteria: '100+ FLOW contributed',
  },
  {
    id: 'unblemished',
    name: 'Unblemished',
    description: 'Perfect Trust Score of 100',
    icon: '🏆',
    tier: 'platinum',
    criteria: 'Trust Score = 100',
  },
];

// =============================================================================
// Check Achievements — Pure function, no side effects
// =============================================================================
//
// Takes a ReputationScore and returns which achievements are unlocked.
// This is deliberately a pure function so it's easy to test and reason about.
// The UI layer handles persistence (localStorage) and notifications (toasts).

export function checkAchievements(score: ReputationScore): AchievementStatus[] {
  return ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    unlocked: isUnlocked(achievement.id, score),
  }));
}

function isUnlocked(id: string, s: ReputationScore): boolean {
  switch (id) {
    // Bronze
    case 'first_step':
      return s.totalCyclesContributed >= 1;
    case 'circle_joiner':
      return s.circleCount >= 1;
    case 'team_player':
      return s.totalCyclesContributed >= 5;

    // Silver
    case 'consistent':
      return s.totalCyclesContributed >= 10;
    case 'reliable':
      return s.circleCount >= 3 && s.totalDelinquencies === 0;
    case 'high_roller':
      return s.totalContributed >= 50;

    // Gold
    case 'veteran':
      return s.circleCount >= 5;
    case 'perfect_record':
      return s.totalCyclesContributed >= 10 && s.totalDelinquencies === 0;
    case 'trusted':
      return s.total >= 90;

    // Platinum
    case 'og':
      return s.circleCount >= 10;
    case 'diamond_hands':
      return s.totalContributed >= 100;
    case 'unblemished':
      return s.total >= 100;

    default:
      return false;
  }
}

// =============================================================================
// LocalStorage Helpers — Track which achievements the user has seen
// =============================================================================
//
// We store previously-seen achievement IDs so we can detect NEW unlocks
// and show toast notifications only for fresh ones.

const STORAGE_KEY = 'chama_achievements_seen';

export function getSeenAchievements(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function markAchievementsSeen(ids: string[]): void {
  if (typeof window === 'undefined') return;
  const existing = getSeenAchievements();
  const merged = [...new Set([...existing, ...ids])];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

/**
 * Returns achievement IDs that are unlocked but haven't been seen yet.
 * Used to trigger toast notifications for fresh unlocks.
 */
export function getNewUnlocks(statuses: AchievementStatus[]): AchievementStatus[] {
  const seen = getSeenAchievements();
  return statuses.filter((a) => a.unlocked && !seen.includes(a.id));
}
