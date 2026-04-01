// =============================================================================
// reputation.ts — On-chain reputation score computation
// =============================================================================
//
// PURPOSE:
//   Computes a Trust Score (0-100) for any Flow address by aggregating their
//   behavior across all Chama circles. This creates a "Web3 credit history"
//   for community savings groups — members with high scores can be trusted
//   in new circles, while low scores signal risk.
//
// HOW IT WORKS:
//   1. Query ChamaManager to find all circles a member belongs to
//   2. For each circle, fetch the CircleState and find the member's MemberInfo
//   3. Aggregate metrics across all circles
//   4. Compute weighted score using four pillars:
//
//      CONSISTENCY (40pts) — What % of cycles did they actually contribute?
//        Formula: (totalCyclesContributed / totalPossibleCycles) * 40
//        Why 40%: This is the core behavior — did you pay when you were
//        supposed to? It's the single strongest signal of reliability.
//
//      RELIABILITY (30pts) — How many payments did they miss?
//        Formula: max(0, 30 - (totalDelinquencies * 5))
//        Why 30%: Missing payments directly harms other members. Each miss
//        costs 5 points — harsh, because the impact on others is real.
//        6+ misses = 0 reliability points.
//
//      EXPERIENCE (20pts) — How many circles have they participated in?
//        Formula: min(circleCount, 10) * 2
//        Why 20%: More circles = more track record. Capped at 10 circles
//        (20pts) so veterans can't coast on history while being currently
//        unreliable. 2 points per circle participated.
//
//      STANDING (10pts) — Are they currently in good standing everywhere?
//        Formula: 10 if not delinquent in any circle, 0 otherwise
//        Why 10%: Binary — you're either clean right now or you're not.
//        This catches members who had a good history but are currently
//        defaulting. It's a "right now" signal vs historical metrics.
//
// WHY CLIENT-SIDE (not a new contract)?
//   Deploying a new contract takes time and risks breaking existing state.
//   Computing the score client-side from existing public data is:
//   - Zero deployment risk
//   - Instantly available
//   - Easily tunable (change weights without redeploying)
//   - Hackathon-practical (ship fast)
//
// PERFORMANCE:
//   For a user in N circles, this makes 1 + N + N = 2N+1 on-chain queries.
//   Typical user: 1-5 circles → 3-11 queries → <2 seconds total.
//   Results are cached for 60 seconds to avoid hammering the access node.
// =============================================================================

import { fcl } from '@/lib/flow-config';

// =============================================================================
// Cadence Scripts
// =============================================================================

// Gets all circle IDs a member has joined — entry point for reputation calc
const GET_MEMBER_CIRCLES = `
import ChamaManager from 0xChamaManager

access(all) fun main(member: Address): [UInt64] {
    return ChamaManager.getMemberCircles(member: member)
}
`;

// Finds which account hosts a given circle (needed to construct public path)
const GET_CIRCLE_HOST = `
import ChamaManager from 0xChamaManager

access(all) fun main(circleId: UInt64): Address? {
    return ChamaManager.getCircleHost(circleId: circleId)
}
`;

// Fetches the full circle state including all member data
const GET_CIRCLE_STATE = `
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

export interface ReputationScore {
  total: number;         // 0-100 overall score
  consistency: number;   // 0-40 contribution consistency
  reliability: number;   // 0-30 inverse of delinquencies
  experience: number;    // 0-20 circles participated in
  standing: number;      // 0-10 currently in good standing

  // Raw data (useful for displaying detailed stats)
  circleCount: number;
  totalCyclesContributed: number;
  totalPossibleCycles: number;
  totalDelinquencies: number;
  totalContributed: number;     // in FLOW
  isCurrentlyDelinquent: boolean;
}

// Grade labels — maps score ranges to human-readable ratings
// These follow a familiar A-F grading system that users intuitively
// understand. The thresholds are slightly generous (70+ = B) because
// early users in a new system should feel rewarded for participation.
export function getGrade(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Excellent',  color: 'text-emerald-400' };
  if (score >= 70) return { label: 'Good',       color: 'text-sky-400' };
  if (score >= 50) return { label: 'Fair',       color: 'text-amber-400' };
  if (score >= 30) return { label: 'Poor',       color: 'text-orange-400' };
  return                   { label: 'At Risk',    color: 'text-red-400' };
}

// =============================================================================
// Score Computation
// =============================================================================

// Simple in-memory cache to avoid repeated queries within 60 seconds
const scoreCache = new Map<string, { score: ReputationScore; timestamp: number }>();
const CACHE_TTL = 300_000; // 5 minutes — reputation doesn't change often

export async function computeReputation(address: string): Promise<ReputationScore> {
  // Check cache first
  const cached = scoreCache.get(address);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.score;
  }

  // Step 1: Get all circles this address belongs to
  // This queries the ChamaManager contract's memberCircles mapping
  let circleIds: string[] = [];
  try {
    circleIds = await fcl.query({
      cadence: GET_MEMBER_CIRCLES,
      args: (arg: any, t: any) => [arg(address, t.Address)],
    }) || [];
  } catch {
    // If the query fails (e.g., address has never interacted with Chama),
    // return a default "new user" score
    return defaultScore();
  }

  if (circleIds.length === 0) return defaultScore();

  // Step 2: For each circle, fetch the state and extract this member's data
  // We run these in parallel for speed (Promise.allSettled won't fail on
  // individual errors — we just skip circles we can't fetch)
  let totalCyclesContributed = 0;
  let totalPossibleCycles = 0;
  let totalDelinquencies = 0;
  let totalContributed = 0;
  let isCurrentlyDelinquent = false;

  const results = await Promise.allSettled(
    circleIds.map(async (circleId) => {
      // Look up which account hosts this circle
      const host: string | null = await fcl.query({
        cadence: GET_CIRCLE_HOST,
        args: (arg: any, t: any) => [arg(circleId, t.UInt64)],
      });
      if (!host) return null;

      // Fetch the full circle state
      const state: any = await fcl.query({
        cadence: GET_CIRCLE_STATE,
        args: (arg: any, t: any) => [arg(host, t.Address), arg(circleId, t.UInt64)],
      });

      // Find this member's data in the members array
      const member = state.members?.find((m: any) => m.address === address);
      if (!member) return null;

      return {
        currentCycle: parseInt(state.currentCycle),
        status: state.status.rawValue,
        cyclesContributed: parseInt(member.cyclesContributed || '0'),
        delinquencyCount: parseInt(member.delinquencyCount || '0'),
        totalContributed: parseFloat(member.totalContributed || '0'),
        isDelinquent: member.isDelinquent === true,
      };
    })
  );

  // Step 3: Aggregate metrics across all circles
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const data = result.value;

    totalCyclesContributed += data.cyclesContributed;
    // For "possible cycles", use currentCycle (how many cycles have happened)
    // For completed circles, this equals maxMembers
    totalPossibleCycles += data.currentCycle;
    totalDelinquencies += data.delinquencyCount;
    totalContributed += data.totalContributed;
    if (data.isDelinquent) isCurrentlyDelinquent = true;
  }

  // Step 4: Compute weighted score
  //
  // CONSISTENCY (40pts): What fraction of all possible cycles did they pay?
  const consistencyRatio = totalPossibleCycles > 0
    ? totalCyclesContributed / totalPossibleCycles
    : 0;
  const consistency = Math.round(consistencyRatio * 40);

  // RELIABILITY (30pts): Each delinquency costs 5 points (max 6 misses = 0)
  const reliability = Math.max(0, 30 - (totalDelinquencies * 5));

  // EXPERIENCE (20pts): 2 points per circle, capped at 10 circles = 20pts
  const experience = Math.min(circleIds.length, 10) * 2;

  // STANDING (10pts): Binary — clean slate right now or not
  const standing = isCurrentlyDelinquent ? 0 : 10;

  const total = consistency + reliability + experience + standing;

  const score: ReputationScore = {
    total,
    consistency,
    reliability,
    experience,
    standing,
    circleCount: circleIds.length,
    totalCyclesContributed,
    totalPossibleCycles,
    totalDelinquencies,
    totalContributed,
    isCurrentlyDelinquent,
  };

  // Cache the result
  scoreCache.set(address, { score, timestamp: Date.now() });

  return score;
}

// Default score for users with no on-chain history
function defaultScore(): ReputationScore {
  return {
    total: 0,
    consistency: 0,
    reliability: 0,
    experience: 0,
    standing: 0,
    circleCount: 0,
    totalCyclesContributed: 0,
    totalPossibleCycles: 0,
    totalDelinquencies: 0,
    totalContributed: 0,
    isCurrentlyDelinquent: false,
  };
}
