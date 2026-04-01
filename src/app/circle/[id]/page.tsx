// =============================================================================
// circle/[id]/page.tsx — Circle detail page with members, contributions, actions
// =============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { sponsoredMutate } from '@/lib/flow-transaction';
import { useTransactionToast } from '@/components/TransactionToast';
import { ReputationBadge } from '@/components/ReputationCard';
import { ActivityFeed } from '@/components/ActivityFeed';
import { PotGrowth } from '@/components/PotGrowth';
import { recordReceiptClient } from '@/lib/receipt-client';
import { fetchCircleEvents, type CircleActivity } from '@/lib/flow-events';
import { computeReputation } from '@/lib/reputation';
import { checkAchievements, type AchievementStatus } from '@/lib/achievements';
import { MiniBadge } from '@/components/AchievementBadge';
import { fmtFlow, useFlowPrice } from '@/lib/currency';

// =============================================================================
// Cadence Scripts
// =============================================================================

const GET_CIRCLE_HOST_SCRIPT = `
import ChamaManager from 0xChamaManager

access(all) fun main(circleId: UInt64): Address? {
    return ChamaManager.getCircleHost(circleId: circleId)
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

// =============================================================================
// Cadence Transactions
// =============================================================================

const JOIN_CIRCLE_TX = `
import ChamaCircle from 0xChamaCircle
import ChamaManager from 0xChamaManager
import FungibleToken from 0xFungibleToken
import FlowToken from 0xFlowToken

transaction(hostAddress: Address, circleId: UInt64) {
    prepare(signer: auth(Storage) &Account) {
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")
        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle")

        let state = circleRef.getState()
        let depositAmount = state.config.contributionAmount

        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault")
        let deposit <- vaultRef.withdraw(amount: depositAmount) as! @FlowToken.Vault

        circleRef.join(member: signer.address, deposit: <- deposit)
        ChamaManager.registerMember(circleId: circleId, member: signer.address)
    }
}
`;

const CONTRIBUTE_TX = `
import ChamaCircle from 0xChamaCircle
import FungibleToken from 0xFungibleToken
import FlowToken from 0xFlowToken

transaction(hostAddress: Address, circleId: UInt64) {
    prepare(signer: auth(Storage) &Account) {
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")
        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle")

        let state = circleRef.getState()
        let amount = state.config.contributionAmount

        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault")
        let payment <- vaultRef.withdraw(amount: amount) as! @FlowToken.Vault

        circleRef.contribute(member: signer.address, payment: <- payment)
    }
}
`;

// Called by the HOST after the circle seals (all members joined, status = ACTIVE)
// Creates the scheduler handler with a pre-authorized capability to the circle
const INIT_HANDLER_TX = `
import ChamaCircle from 0xChamaCircle
import ChamaScheduler from 0xChamaScheduler
import FlowTransactionScheduler from 0xFlowTransactionScheduler

transaction(circleId: UInt64) {
    prepare(signer: auth(Storage, Capabilities) &Account) {
        let circlePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create circle storage path")
        let handlerPath = StoragePath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler storage path")
        let handlerPublicPath = PublicPath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler public path")

        if signer.storage.borrow<&AnyResource>(from: handlerPath) != nil {
            return
        }

        let circleCap = signer.capabilities.storage
            .issue<&ChamaCircle.Circle>(circlePath)
        let handler <- ChamaScheduler.createHandler(
            circleCap: circleCap,
            storagePath: handlerPath,
            publicPath: handlerPublicPath
        )
        signer.storage.save(<- handler, to: handlerPath)

        let _ = signer.capabilities.storage
            .issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(handlerPath)
        let publicCap = signer.capabilities.storage
            .issue<&{FlowTransactionScheduler.TransactionHandler}>(handlerPath)
        signer.capabilities.publish(publicCap, at: handlerPublicPath)
    }
}
`;

// Called after InitHandler and after each cycle to schedule the next on-chain execution
const SCHEDULE_NEXT_CYCLE_TX = `
import FlowTransactionScheduler from 0xFlowTransactionScheduler
import ChamaScheduler from 0xChamaScheduler
import ChamaCircle from 0xChamaCircle
import FlowToken from 0xFlowToken
import FungibleToken from 0xFungibleToken

transaction(circleId: UInt64, cycleDuration: UFix64) {
    prepare(signer: auth(Storage, Capabilities) &Account) {
        let circlePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create circle storage path")
        let handlerPath = StoragePath(identifier: "chamaHandler_".concat(circleId.toString()))
            ?? panic("Could not create handler storage path")

        let circleRef = signer.storage.borrow<&ChamaCircle.Circle>(from: circlePath)
            ?? panic("Could not borrow circle")
        let state = circleRef.getState()
        if state.status != ChamaCircle.CircleStatus.ACTIVE {
            return
        }

        let handlerCap = signer.capabilities.storage
            .issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(handlerPath)
        let targetTimestamp = getCurrentBlock().timestamp + cycleDuration
        let estimate = FlowTransactionScheduler.estimate(
            data: nil,
            timestamp: targetTimestamp,
            priority: FlowTransactionScheduler.Priority.Medium,
            executionEffort: 5000
        )
        let feeAmount = estimate.flowFee ?? 0.001
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault for fee")
        let fees <- vaultRef.withdraw(amount: feeAmount) as! @FlowToken.Vault

        let scheduledTx <- FlowTransactionScheduler.schedule(
            handlerCap: handlerCap,
            data: nil,
            timestamp: targetTimestamp,
            priority: FlowTransactionScheduler.Priority.Medium,
            executionEffort: 5000,
            fees: <- fees
        )

        let scheduledTxPath = StoragePath(identifier: "chamaScheduledTx_".concat(circleId.toString()))
            ?? panic("Could not create scheduled tx path")
        if let oldTx <- signer.storage.load<@FlowTransactionScheduler.ScheduledTransaction>(from: scheduledTxPath) {
            destroy oldTx
        }
        signer.storage.save(<- scheduledTx, to: scheduledTxPath)
    }
}
`;

const EXECUTE_CYCLE_TX = `
import ChamaCircle from 0xChamaCircle

transaction(hostAddress: Address, circleId: UInt64) {
    prepare(signer: auth(Storage) &Account) {
        let host = getAccount(hostAddress)
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not construct public path")
        let circleRef = host.capabilities
            .borrow<&ChamaCircle.Circle>(publicPath)
            ?? panic("Could not borrow Circle")

        circleRef.executeCycle()
    }
}
`;

// =============================================================================
// Types
// =============================================================================

interface MemberData {
  address: string;
  hasContributed: boolean;
  totalContributed: string;
  isDelinquent: boolean;
  delinquencyCount: string;
  rotationPosition: string;
}

interface CircleData {
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
  members: MemberData[];
  poolBalance: string;
  nextDeadline: string;
  nextRecipient: string | null;
  latestReceiptCID: string;
}

// =============================================================================
// Helpers
// =============================================================================

const STATUS_CONFIG: Record<string, { label: string; color: string; glow: string }> = {
  '0': {
    label: 'Forming',
    color: 'bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20',
    glow: 'shadow-sky-500/5',
  },
  '1': {
    label: 'Active',
    color: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
    glow: 'shadow-emerald-500/5',
  },
  '2': {
    label: 'Completed',
    color: 'bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20',
    glow: '',
  },
  '3': {
    label: 'Cancelled',
    color: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',
    glow: '',
  },
};

function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// fmtFlow imported from @/lib/currency

function fmtPercent(val: string): string {
  return `${parseFloat(val).toFixed(0)}%`;
}

function fmtDuration(seconds: string): string {
  const s = parseFloat(seconds);
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(0)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} hr`;
  return `${(s / 86400).toFixed(1)} days`;
}

// =============================================================================
// Countdown Hook
// =============================================================================

function useCountdown(deadlineTimestamp: number): string {
  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(interval);
  }, []);

  if (deadlineTimestamp <= 0) return '--';
  const remaining = deadlineTimestamp - now;
  if (remaining <= 0) return 'EXPIRED';
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

// =============================================================================
// Sub-components
// =============================================================================

function StatCard({ label, value, accent, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-sm transition-all duration-300 hover:border-zinc-700/80 hover:bg-zinc-900/80">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
      <p className="relative text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className={`relative mt-2 text-xl font-semibold tracking-tight ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>
        {value}
      </p>
      {hint && (
        <p className="relative mt-1 text-[10px] text-zinc-600">{hint}</p>
      )}
    </div>
  );
}

function MemberRow({
  member,
  index,
  isYou,
  isActive,
}: {
  member: MemberData;
  index: number;
  isYou: boolean;
  isActive: boolean;
}) {
  // Compute achievements for this member (uses cached reputation data)
  const [badges, setBadges] = useState<AchievementStatus[]>([]);
  useEffect(() => {
    computeReputation(member.address)
      .then((score) => {
        const unlocked = checkAchievements(score).filter((a) => a.unlocked);
        setBadges(unlocked.slice(0, 3)); // Show top 3 badges
      })
      .catch(() => {});
  }, [member.address]);

  return (
    <div className={`flex items-center justify-between px-4 py-3 transition-colors ${isYou ? 'bg-emerald-500/[0.03]' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
          isYou
            ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
            : 'bg-zinc-800 text-zinc-400'
        }`}>
          {index + 1}
        </div>
        <div>
          <p className="flex items-center gap-2 font-mono text-sm text-zinc-200">
            {truncAddr(member.address)}
            {isYou && (
              <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                You
              </span>
            )}
            {/* Mini achievement badges — top 3 unlocked */}
            {badges.length > 0 && (
              <span className="flex items-center gap-0.5">
                {badges.map((b) => (
                  <MiniBadge key={b.id} achievement={b} />
                ))}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {fmtFlow(member.totalContributed)} FLOW contributed
            {member.isDelinquent && parseInt(member.delinquencyCount) > 0 && (
              <span className="ml-2 text-red-400/80">
                {parseInt(member.delinquencyCount)}x missed
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ReputationBadge address={member.address} />
        {isActive && (
          member.hasContributed ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Paid
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 ring-1 ring-amber-500/20">
              Pending
            </span>
          )
        )}
        {member.isDelinquent && (
          <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 ring-1 ring-red-500/20">
            Delinquent
          </span>
        )}
      </div>
    </div>
  );
}

function EmptySlot({ position }: { position: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-zinc-700 text-xs text-zinc-600">
        {position}
      </div>
      <span className="text-sm italic text-zinc-600">Waiting for member...</span>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function CircleDetailPage() {
  const params = useParams();
  const circleId = params.id as string;
  const { user } = useCurrentUser();
  const { showToast, ToastComponent } = useTransactionToast();

  const [circle, setCircle] = useState<CircleData | null>(null);
  const [hostAddress, setHostAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [autoExecuting, setAutoExecuting] = useState(false);
  const [cycleJustExecuted, setCycleJustExecuted] = useState(false);
  const [lastPayout, setLastPayout] = useState<{ recipient: string; amount: string; cycle: string; txId: string } | null>(null);
  const [payoutHistory, setPayoutHistory] = useState<CircleActivity[]>([]);
  const { formatFiat } = useFlowPrice();

  const countdown = useCountdown(circle ? parseFloat(circle.nextDeadline) : 0);

  // ── Fetch circle state ──
  const fetchCircle = useCallback(async () => {
    try {
      const host: string | null = await fcl.query({
        cadence: GET_CIRCLE_HOST_SCRIPT,
        args: (arg: any, t: any) => [arg(circleId, t.UInt64)],
      });
      if (!host) {
        setError('Circle not found.');
        setLoading(false);
        return;
      }
      setHostAddress(host);
      const state: CircleData = await fcl.query({
        cadence: GET_CIRCLE_STATE_SCRIPT,
        args: (arg: any, t: any) => [arg(host, t.Address), arg(circleId, t.UInt64)],
      });
      setCircle(state);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch circle:', err);
      setError('Failed to load circle data.');
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    fetchCircle();
    const interval = setInterval(fetchCircle, 30000);
    return () => clearInterval(interval);
  }, [fetchCircle]);

  // ── Fetch payout history from on-chain events ──
  useEffect(() => {
    if (!circleId) return;
    let cancelled = false;
    fetchCircleEvents(circleId)
      .then((events) => {
        if (!cancelled) {
          setPayoutHistory(events.filter((e) => e.action === 'payout_executed'));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [circleId, circle?.currentCycle]); // refetch when cycle advances

  // ── Auto-execute cycle when ALL members have contributed ──
  const allContributed = circle?.members?.length
    ? circle.members.every((m) => m.hasContributed)
    : false;
  const contributedCount = circle?.members?.filter((m) => m.hasContributed).length ?? 0;

  useEffect(() => {
    if (!circle || !hostAddress || !user.loggedIn) return;
    if (circle.status.rawValue !== '1') return; // only when Active
    if (autoExecuting || actionLoading) return;
    if (!allContributed) return; // wait until everyone has paid

    // All members contributed — auto-trigger executeCycle
    setAutoExecuting(true);
    (async () => {
      try {
        // Capture payout details BEFORE executing (state will change after)
        const payoutRecipient = circle.nextRecipient || 'unknown';
        const payoutAmt = String(parseFloat(circle.config.contributionAmount) * parseInt(circle.config.maxMembers));
        const payoutCycle = circle.currentCycle;

        showToast({ status: 'pending', message: 'All members contributed — executing payout...' });
        const txId = await sponsoredMutate({
          cadence: EXECUTE_CYCLE_TX,
          args: (arg: any, t: any) => [arg(hostAddress, t.Address), arg(circleId, t.UInt64)],
          limit: 9999,
        });
        showToast({ status: 'sealing', message: 'Executing payout — confirming on-chain...', txId });
        await fcl.tx(txId).onceSealed();

        // Show payout-specific toast
        const isYouRecipient = payoutRecipient === user.addr;
        const toastMsg = isYouRecipient
          ? `You received ${fmtFlow(payoutAmt)} FLOW! (Cycle ${payoutCycle})`
          : `${fmtFlow(payoutAmt)} FLOW sent to ${truncAddr(payoutRecipient)} (Cycle ${payoutCycle})`;
        showToast({ status: 'sealed', message: toastMsg, txId });

        setLastPayout({ recipient: payoutRecipient, amount: payoutAmt, cycle: payoutCycle, txId });
        setCycleJustExecuted(true);
        setTimeout(() => setCycleJustExecuted(false), 10000);

        // Fire-and-forget: record payout receipt
        if (hostAddress && user.addr && circle) {
          recordReceiptClient({
            circleId,
            action: 'payout_executed',
            actor: user.addr,
            timestamp: new Date().toISOString(),
            details: {
              cycle: parseInt(circle.currentCycle),
              recipient: circle.nextRecipient || 'unknown',
              amount: String(parseFloat(circle.config.contributionAmount) * parseInt(circle.config.maxMembers)),
              autoExecuted: true,
            },
            transactionId: txId,
            previousReceiptCID: circle.latestReceiptCID || null,
          }).catch(console.warn);
        }

        await fetchCircle();
      } catch (err: any) {
        console.warn('Auto-execute cycle failed:', err?.message);
        await fetchCircle();
      } finally {
        setAutoExecuting(false);
      }
    })();
  }, [circle, hostAddress, user.loggedIn, autoExecuting, actionLoading, allContributed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──
  async function handleExecuteCycle() {
    if (!hostAddress || !circle) return;
    setActionLoading(true);
    setError(null);
    try {
      // Capture payout details BEFORE executing
      const payoutRecipient = circle.nextRecipient || 'unknown';
      const payoutAmt = String(parseFloat(circle.config.contributionAmount) * parseInt(circle.config.maxMembers));
      const payoutCycle = circle.currentCycle;

      showToast({ status: 'pending', message: 'Executing payout — please confirm...' });
      const txId = await sponsoredMutate({
        cadence: EXECUTE_CYCLE_TX,
        args: (arg: any, t: any) => [arg(hostAddress, t.Address), arg(circleId, t.UInt64)],
        limit: 9999,
      });
      showToast({ status: 'sealing', message: 'Executing payout — confirming on-chain...', txId });
      await fcl.tx(txId).onceSealed();

      const isYouRecipient = payoutRecipient === user.addr;
      const toastMsg = isYouRecipient
        ? `You received ${fmtFlow(payoutAmt)} FLOW! (Cycle ${payoutCycle})`
        : `${fmtFlow(payoutAmt)} FLOW sent to ${truncAddr(payoutRecipient)} (Cycle ${payoutCycle})`;
      showToast({ status: 'sealed', message: toastMsg, txId });

      setLastPayout({ recipient: payoutRecipient, amount: payoutAmt, cycle: payoutCycle, txId });
      setCycleJustExecuted(true);
      setTimeout(() => setCycleJustExecuted(false), 10000);

      // Fire-and-forget: record payout receipt to IPFS + on-chain
      if (hostAddress && user.addr && circle) {
        recordReceiptClient({
          circleId,
          action: 'payout_executed',
          actor: user.addr,
          timestamp: new Date().toISOString(),
          details: {
            cycle: parseInt(circle.currentCycle),
            recipient: circle.nextRecipient || 'unknown',
            amount: String(parseFloat(circle.config.contributionAmount) * parseInt(circle.config.maxMembers)),
          },
          transactionId: txId,
          previousReceiptCID: circle.latestReceiptCID || null,
        }).catch(console.warn);
      }

      await fetchCircle();
    } catch (err: any) {
      showToast({ status: 'error', message: err?.message || 'Execute cycle failed.' });
      setError(err?.message || 'Execute cycle failed.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleJoin() {
    if (!hostAddress) return;
    setActionLoading(true);
    setError(null);
    try {
      showToast({ status: 'pending', message: 'Joining circle — please confirm...' });
      const txId = await sponsoredMutate({
        cadence: JOIN_CIRCLE_TX,
        args: (arg: any, t: any) => [arg(hostAddress, t.Address), arg(circleId, t.UInt64)],
        limit: 9999,
      });
      showToast({ status: 'sealing', message: 'Joining circle — confirming on-chain...', txId });
      await fcl.tx(txId).onceSealed();
      showToast({ status: 'sealed', message: 'Successfully joined the circle!', txId });
      await fetchCircle();

      // Fire-and-forget: record join receipt to IPFS + on-chain
      if (hostAddress && user.addr && circle) {
        recordReceiptClient({
          circleId,
          action: 'member_joined',
          actor: user.addr,
          timestamp: new Date().toISOString(),
          details: {
            depositAmount: circle.config.contributionAmount,
          },
          transactionId: txId,
          previousReceiptCID: circle.latestReceiptCID || null,
        }).catch(console.warn);
      }

      // If this join sealed the circle and user is the host, init the on-chain scheduler
      // Re-fetch to get latest state after join
      const freshState: CircleData = await fcl.query({
        cadence: GET_CIRCLE_STATE_SCRIPT,
        args: (arg: any, t: any) => [arg(hostAddress, t.Address), arg(circleId, t.UInt64)],
      });
      if (freshState.status.rawValue === '1' && user.addr === hostAddress) {
        await initScheduler(freshState);
      }
    } catch (err: any) {
      showToast({ status: 'error', message: err?.message || 'Join failed.' });
      setError(err?.message || 'Join failed.');
    } finally {
      setActionLoading(false);
    }
  }

  async function initScheduler(state: CircleData) {
    try {
      showToast({ status: 'pending', message: 'Setting up automatic payouts...' });
      // Step 1: Init handler
      const initTxId = await sponsoredMutate({
        cadence: INIT_HANDLER_TX,
        args: (arg: any, t: any) => [arg(circleId, t.UInt64)],
        limit: 9999,
      });
      await fcl.tx(initTxId).onceSealed();

      // Step 2: Schedule next cycle
      const cycleDuration = state.config.cycleDuration;
      const scheduleTxId = await sponsoredMutate({
        cadence: SCHEDULE_NEXT_CYCLE_TX,
        args: (arg: any, t: any) => [
          arg(circleId, t.UInt64),
          arg(cycleDuration, t.UFix64),
        ],
        limit: 9999,
      });
      await fcl.tx(scheduleTxId).onceSealed();
      showToast({ status: 'sealed', message: 'Automatic payouts scheduled!', txId: scheduleTxId });
    } catch (err: any) {
      // Non-fatal — frontend auto-execute is the fallback
      console.warn('Scheduler init failed (fallback to frontend auto-execute):', err?.message);
    }
  }

  async function handleContribute() {
    if (!hostAddress) return;
    setActionLoading(true);
    setError(null);
    try {
      showToast({ status: 'pending', message: 'Sending your contribution — please confirm...' });
      const txId = await sponsoredMutate({
        cadence: CONTRIBUTE_TX,
        args: (arg: any, t: any) => [arg(hostAddress, t.Address), arg(circleId, t.UInt64)],
        limit: 9999,
      });
      showToast({ status: 'sealing', message: 'Contributing — confirming on-chain...', txId });
      await fcl.tx(txId).onceSealed();
      showToast({ status: 'sealed', message: 'Contribution confirmed!', txId });
      await fetchCircle();

      // Fire-and-forget: record receipt to IPFS + on-chain
      if (hostAddress && user.addr && circle) {
        recordReceiptClient({
          circleId,
          action: 'contribution',
          actor: user.addr,
          timestamp: new Date().toISOString(),
          details: {
            amount: circle.config.contributionAmount,
            cycle: parseInt(circle.currentCycle),
          },
          transactionId: txId,
          previousReceiptCID: circle.latestReceiptCID || null,
        }).catch(console.warn);
      }
    } catch (err: any) {
      showToast({ status: 'error', message: err?.message || 'Contribution failed.' });
      setError(err?.message || 'Contribution failed.');
    } finally {
      setActionLoading(false);
    }
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 sm:py-32">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-500" />
        </div>
        <p className="mt-4 text-sm text-zinc-500">Loading circle...</p>
      </div>
    );
  }

  if (error && !circle) {
    return (
      <div className="flex flex-col items-center py-32 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/20">
          <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <p className="mt-4 text-sm text-red-400">{error}</p>
        <Link href="/" className="mt-4 text-sm text-emerald-500 hover:text-emerald-400 transition-colors">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!circle) return null;

  const statusRaw = circle.status.rawValue;
  const status = STATUS_CONFIG[statusRaw] || STATUS_CONFIG['0'];
  const isForming = statusRaw === '0';
  const isActive = statusRaw === '1';
  const isCompleted = statusRaw === '2';

  const currentMember = circle.members.find((m) => m.address === user.addr);
  const isMember = !!currentMember;
  const hasContributed = currentMember?.hasContributed ?? false;
  const canJoin = isForming && !isMember && user.loggedIn;
  const canContribute = isActive && isMember && !hasContributed;

  const maxMembers = parseInt(circle.config.maxMembers);
  const memberCount = circle.members.length;
  const progressPercent = maxMembers > 0 ? (memberCount / maxMembers) * 100 : 0;
  const payoutAmount = (parseFloat(circle.config.contributionAmount) * maxMembers).toFixed(2);

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <ToastComponent />

      {/* ── Breadcrumb ── */}
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Dashboard
      </Link>

      {/* ── Hero Header ── */}
      <div className="mt-4 relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-900/90 p-6 sm:p-8">
        {/* Subtle gradient orb in background */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-emerald-500/[0.04] blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-sky-500/[0.03] blur-3xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
                {circle.config.name}
              </h1>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.color}`}>
                {status.label}
              </span>
            </div>
            <p className="mt-1.5 flex items-center gap-2 text-sm text-zinc-400">
              <span className="font-mono text-zinc-500">#{circle.circleId}</span>
              <span className="text-zinc-700">|</span>
              <span>{fmtFlow(payoutAmount)} FLOW payout per cycle</span>
            </p>
          </div>

          {/* Share circle ID */}
          <div className="flex items-center gap-2 rounded-xl bg-zinc-800/50 px-3 py-2 ring-1 ring-zinc-700/50">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Share ID</span>
            <span className="font-mono text-sm font-semibold text-zinc-200">{circle.circleId}</span>
          </div>
        </div>

        {/* Member fill progress bar */}
        {isForming && (
          <div className="relative mt-6">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{memberCount} of {maxMembers} members</span>
              <span>{(100 - progressPercent).toFixed(0)}% slots remaining</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Stats Grid ── */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Contribution" value={`${fmtFlow(circle.config.contributionAmount)} FLOW`} hint={formatFiat(parseFloat(circle.config.contributionAmount))} />
        <StatCard label="Pool Balance" value={`${fmtFlow(circle.poolBalance)} FLOW`} accent hint={formatFiat(parseFloat(circle.poolBalance))} />
        <StatCard label="Cycle" value={`${circle.currentCycle} / ${circle.config.maxMembers}`} />
        <StatCard
          label="Next Payout"
          value={isActive ? (countdown === 'EXPIRED' ? 'Executing...' : countdown) : '--'}
          accent={isActive && countdown === 'EXPIRED'}
        />
      </div>

      {/* ── Pot Growth Visualization — animated pool balance ── */}
      {isActive && (
        <div className="mt-6 flex justify-center rounded-2xl border border-zinc-800/80 bg-zinc-900/60 py-6 backdrop-blur-sm">
          <PotGrowth
            poolBalance={parseFloat(circle.poolBalance)}
            targetAmount={parseFloat(payoutAmount)}
            memberCount={memberCount}
            contributedCount={contributedCount}
          />
        </div>
      )}

      {/* ── Recipient Banner ── */}
      {isActive && circle.nextRecipient && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
            <svg className="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-500/70">Payout Recipient</p>
            <p className="mt-0.5 font-mono text-sm text-emerald-300">
              {truncAddr(circle.nextRecipient)}
              {circle.nextRecipient === user.addr && (
                <span className="ml-2 rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                  You!
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Action Area ── */}
      <div className="mt-6">
        {canJoin && (
          <button
            onClick={handleJoin}
            disabled={actionLoading}
            className="group relative w-full overflow-hidden rounded-2xl bg-emerald-600 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {actionLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Joining...
                </>
              ) : (
                <>
                  Join Circle
                  <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs">
                    {fmtFlow(circle.config.contributionAmount)} FLOW deposit
                  </span>
                </>
              )}
            </span>
          </button>
        )}

        {canContribute && (
          <button
            onClick={handleContribute}
            disabled={actionLoading}
            className="group relative w-full overflow-hidden rounded-2xl bg-emerald-600 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {actionLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Contributing...
                </>
              ) : (
                <>
                  Contribute
                  <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs">
                    {fmtFlow(circle.config.contributionAmount)} FLOW
                  </span>
                </>
              )}
            </span>
          </button>
        )}

        {/* Contribution progress — shown when active and not all contributed yet */}
        {isActive && !allContributed && !autoExecuting && (
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Contributions this cycle</span>
              <span className="font-medium text-zinc-200">{contributedCount} / {memberCount}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${memberCount > 0 ? (contributedCount / memberCount) * 100 : 0}%` }}
              />
            </div>
            {isMember && hasContributed && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                You've contributed — waiting for others
              </p>
            )}
            {countdown === 'EXPIRED' && !allContributed && user.loggedIn && (
              <button
                onClick={handleExecuteCycle}
                disabled={actionLoading || autoExecuting}
                className="mt-3 w-full rounded-xl bg-amber-600 py-2.5 text-xs font-semibold text-white transition-all hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? 'Executing...' : 'Execute cycle — deadline passed'}
              </button>
            )}
          </div>
        )}

        {/* Auto-executing banner */}
        {isActive && autoExecuting && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] py-4 text-sm font-medium text-emerald-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-400" />
            All members contributed — executing payout...
          </div>
        )}

        {/* All contributed, waiting for auto-execute to kick in */}
        {isActive && allContributed && !autoExecuting && !cycleJustExecuted && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] py-4 text-sm font-medium text-emerald-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            All members contributed — payout will execute automatically
          </div>
        )}

        {cycleJustExecuted && lastPayout && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {lastPayout.recipient === user.addr
                ? `You received ${fmtFlow(lastPayout.amount)} FLOW!`
                : `${fmtFlow(lastPayout.amount)} FLOW sent to ${truncAddr(lastPayout.recipient)}`}
            </div>
            <p className="mt-1 ml-7 text-xs text-emerald-500/60">
              Cycle {lastPayout.cycle} payout confirmed
              {lastPayout.txId && (
                <>
                  {' — '}
                  <a
                    href={`https://testnet.flowscan.io/transaction/${lastPayout.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-emerald-400"
                  >
                    View on Flowscan
                  </a>
                </>
              )}
            </p>
          </div>
        )}

        {isCompleted && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-zinc-700/50 bg-zinc-800/30 py-4 text-sm text-zinc-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Circle completed — deposits returned
          </div>
        )}
      </div>

      {/* ── "You received" congratulations banner ── */}
      {(() => {
        if (!user.addr || payoutHistory.length === 0) return null;
        const yourPayouts = payoutHistory.filter((e) => String(e.data.recipient) === user.addr);
        if (yourPayouts.length === 0) return null;
        const latest = yourPayouts[0]; // newest first
        return (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/25 text-lg">
                <svg className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  You received {fmtFlow(String(latest.data.amount || '0'))} FLOW in Cycle {String(latest.data.cycle || '?')}
                </p>
                <p className="mt-0.5 text-xs text-amber-400/60">
                  {yourPayouts.length > 1 ? `${yourPayouts.length} total payouts received` : 'Payout confirmed on-chain'}
                  {latest.transactionId && (
                    <>
                      {' — '}
                      <a
                        href={`https://testnet.flowscan.io/transaction/${latest.transactionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-amber-300"
                      >
                        View on Flowscan
                      </a>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Payout History ── */}
      {payoutHistory.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-100">Payout History</h2>
            <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400">
              {payoutHistory.length} payout{payoutHistory.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40 divide-y divide-zinc-800/60">
            {payoutHistory.map((payout, i) => {
              const recipient = String(payout.data.recipient || '');
              const amount = String(payout.data.amount || '0');
              const cycle = String(payout.data.cycle || '?');
              const isYou = recipient === user.addr;
              return (
                <div key={i} className={`flex items-center justify-between px-4 py-3 ${isYou ? 'bg-emerald-500/[0.03]' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      isYou ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                    }`}>
                      {cycle}
                    </div>
                    <div>
                      <p className="text-sm text-zinc-200">
                        <span className="font-semibold text-emerald-400">{fmtFlow(amount)} FLOW</span>
                        <span className="text-zinc-500"> to </span>
                        <span className="font-mono text-zinc-300">{truncAddr(recipient)}</span>
                        {isYou && (
                          <span className="ml-1.5 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                            You
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-600">
                        {payout.timestamp ? new Date(payout.timestamp).toLocaleString() : ''}
                      </p>
                    </div>
                  </div>
                  {payout.transactionId && (
                    <a
                      href={`https://testnet.flowscan.io/transaction/${payout.transactionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-emerald-400 transition-colors"
                    >
                      Flowscan
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Members ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">
            Members
          </h2>
          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400">
            {memberCount}/{maxMembers}
          </span>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40 divide-y divide-zinc-800/60">
          {circle.members.map((member, i) => (
            <MemberRow
              key={member.address}
              member={member}
              index={i}
              isYou={member.address === user.addr}
              isActive={isActive}
            />
          ))}
          {isForming &&
            Array.from({ length: maxMembers - memberCount }).map((_, i) => (
              <EmptySlot key={`empty-${i}`} position={memberCount + i + 1} />
            ))}
        </div>
      </div>

      {/* ── Activity Feed ── */}
      <div className="mt-8">
        <ActivityFeed circleId={circleId} />
      </div>

      {/* ── Configuration ── */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-zinc-100">Configuration</h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
          {[
            { label: 'Penalty per miss', value: fmtPercent(circle.config.penaltyPercent) },
            { label: 'Cycle duration', value: fmtDuration(circle.config.cycleDuration) },
            { label: 'Each payout', value: `${fmtFlow(payoutAmount)} FLOW`, accent: true, hint: formatFiat(parseFloat(payoutAmount)) },
            { label: 'Max members', value: circle.config.maxMembers },
          ].map((row, i) => (
            <div key={row.label} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-zinc-800/60' : ''}`}>
              <span className="text-sm text-zinc-500">{row.label}</span>
              <div className="text-right">
                <span className={`text-sm font-medium ${row.accent ? 'text-emerald-400' : 'text-zinc-200'}`}>
                  {row.value}
                </span>
                {row.hint && <p className="mt-0.5 text-[10px] text-zinc-600">{row.hint}</p>}
              </div>
            </div>
          ))}
          {circle.latestReceiptCID && (
            <div className="flex items-center justify-between border-t border-zinc-800/60 px-4 py-3">
              <span className="text-sm text-zinc-500">Latest receipt</span>
              <a
                href={`https://${circle.latestReceiptCID}.ipfs.w3s.link`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 font-mono text-xs text-emerald-500 transition-colors hover:text-emerald-400"
              >
                {circle.latestReceiptCID.slice(0, 16)}...
                <svg className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
