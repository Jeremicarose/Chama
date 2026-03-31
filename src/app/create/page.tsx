// =============================================================================
// create/page.tsx — Create a new savings circle
// =============================================================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';
import { sponsoredMutate } from '@/lib/flow-transaction';
import { useTransactionToast } from '@/components/TransactionToast';
import { recordReceiptClient } from '@/lib/receipt-client';
import { fmtFlow, useFlowPrice } from '@/lib/currency';

// =============================================================================
// Cadence Transaction
// =============================================================================

const CREATE_CIRCLE_TX = `
import ChamaCircle from 0xChamaCircle
import ChamaManager from 0xChamaManager
import FungibleToken from 0xFungibleToken
import FlowToken from 0xFlowToken

transaction(
    name: String,
    contributionAmount: UFix64,
    cycleDuration: UFix64,
    maxMembers: UInt64,
    penaltyPercent: UFix64
) {
    prepare(signer: auth(Storage, Capabilities) &Account) {
        let config = ChamaCircle.CircleConfig(
            name: name,
            contributionAmount: contributionAmount,
            cycleDuration: cycleDuration,
            maxMembers: maxMembers,
            penaltyPercent: penaltyPercent
        )

        let circle <- ChamaCircle.createCircle(config: config, creator: signer.address)
        let circleId = circle.circleId

        let storagePath = StoragePath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create storage path")
        let publicPath = PublicPath(identifier: "chamaCircle_".concat(circleId.toString()))
            ?? panic("Could not create public path")

        signer.storage.save(<- circle, to: storagePath)

        let cap = signer.capabilities.storage.issue<&ChamaCircle.Circle>(storagePath)
        signer.capabilities.publish(cap, at: publicPath)

        ChamaManager.registerCircle(circleId: circleId, name: name, host: signer.address)

        let circleRef = signer.storage.borrow<&ChamaCircle.Circle>(from: storagePath)
            ?? panic("Could not borrow circle")

        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("Could not borrow FlowToken vault")

        let deposit <- vaultRef.withdraw(amount: contributionAmount) as! @FlowToken.Vault
        circleRef.join(member: signer.address, deposit: <- deposit)

        ChamaManager.registerMember(circleId: circleId, member: signer.address)
    }
}
`;

// =============================================================================
// Input styling constants
// =============================================================================

const INPUT_CLASSES =
  'w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50';

const LABEL_CLASSES = 'block text-sm font-medium text-zinc-300';
const HINT_CLASSES = 'mt-1.5 text-xs text-zinc-600';

// =============================================================================
// Component
// =============================================================================

export default function CreateCirclePage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const { showToast, ToastComponent } = useTransactionToast();

  const [name, setName] = useState('');
  const [contributionAmount, setContributionAmount] = useState('10.0');
  const [cycleDuration, setCycleDuration] = useState('120');
  const [maxMembers, setMaxMembers] = useState('4');
  const [penaltyPercent, setPenaltyPercent] = useState('50');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formatFiat } = useFlowPrice();

  // ── Derived values for summary ──
  const contribution = parseFloat(contributionAmount || '0');
  const members = parseInt(maxMembers || '0');
  const totalPayout = contribution * members;

  function validate(): string | null {
    if (!name.trim()) return 'Circle name is required.';
    if (name.length > 50) return 'Circle name must be under 50 characters.';
    if (isNaN(contribution) || contribution <= 0) return 'Contribution must be a positive number.';
    const duration = parseFloat(cycleDuration);
    if (isNaN(duration) || duration <= 0) return 'Cycle duration must be positive.';
    if (isNaN(members) || members < 2) return 'Need at least 2 members.';
    if (members > 20) return 'Maximum 20 members per circle.';
    const penalty = parseFloat(penaltyPercent);
    if (isNaN(penalty) || penalty < 0 || penalty > 100) return 'Penalty must be 0-100%.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (!user.loggedIn) { setError('Please sign in first.'); return; }

    setSubmitting(true);
    setError(null);

    try {
      showToast({ status: 'pending', message: 'Creating your circle — please confirm...' });
      const txId = await sponsoredMutate({
        cadence: CREATE_CIRCLE_TX,
        args: (arg: any, t: any) => [
          arg(name, t.String),
          arg(parseFloat(contributionAmount).toFixed(8), t.UFix64),
          arg(parseFloat(cycleDuration).toFixed(8), t.UFix64),
          arg(parseInt(maxMembers).toString(), t.UInt64),
          arg(parseFloat(penaltyPercent).toFixed(8), t.UFix64),
        ],
        limit: 9999,
      });

      showToast({ status: 'sealing', message: 'Creating circle — waiting for confirmation...', txId });
      const txResult = await fcl.tx(txId).onceSealed();

      const createdEvent = txResult.events?.find(
        (e: any) => e.type.includes('ChamaCircle.CircleCreated')
      );
      showToast({ status: 'sealed', message: 'Circle created successfully!', txId });

      // Fire-and-forget: record circle_created receipt to IPFS + on-chain
      if (createdEvent && user.addr) {
        const newCircleId = String(createdEvent.data.circleId);
        recordReceiptClient({
          circleId: newCircleId,
          action: 'circle_created',
          actor: user.addr,
          timestamp: new Date().toISOString(),
          details: {
            name,
            contributionAmount: parseFloat(contributionAmount).toFixed(2),
            maxMembers: parseInt(maxMembers),
            cycleDuration: parseFloat(cycleDuration),
            penaltyPercent: parseFloat(penaltyPercent),
          },
          transactionId: txId,
        }).catch(console.warn);
      }

      if (createdEvent) {
        setTimeout(() => router.push(`/circle/${createdEvent.data.circleId}`), 1500);
      } else {
        setTimeout(() => router.push('/'), 1500);
      }
    } catch (err: any) {
      console.error('CreateCircle failed:', err);
      showToast({ status: 'error', message: err?.message || 'Transaction failed.' });
      setError(err?.message || 'Transaction failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-32 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/50 ring-1 ring-zinc-700/50">
          <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">Create a Circle</h1>
        <p className="mt-2 text-sm text-zinc-500">Sign in to create a savings circle.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg pb-16">
      <ToastComponent />

      {/* ── Header ── */}
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-50">
        Create a Circle
      </h1>
      <p className="mt-1.5 text-sm text-zinc-500">
        Configure your rotating savings circle. You&apos;ll join as member #1 and pay the security deposit.
      </p>

      {/* ── Error ── */}
      {error && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Form ── */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        {/* Circle Name */}
        <div>
          <label className={LABEL_CLASSES}>Circle Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Office Lunch Fund"
            className={`mt-2 ${INPUT_CLASSES}`}
            disabled={submitting}
            maxLength={50}
          />
        </div>

        {/* Contribution Amount */}
        <div>
          <label className={LABEL_CLASSES}>Contribution per Cycle</label>
          <div className="relative mt-2">
            <input
              type="number"
              value={contributionAmount}
              onChange={(e) => setContributionAmount(e.target.value)}
              min="0.01"
              step="0.01"
              className={`${INPUT_CLASSES} pr-16`}
              disabled={submitting}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-500">
              FLOW
            </span>
          </div>
          <p className={HINT_CLASSES}>
            Each member pays this every cycle. Also used as the security deposit.
          </p>
        </div>

        {/* Two columns: Members + Duration */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASSES}>Max Members</label>
            <input
              type="number"
              value={maxMembers}
              onChange={(e) => setMaxMembers(e.target.value)}
              min="2"
              max="20"
              className={`mt-2 ${INPUT_CLASSES}`}
              disabled={submitting}
            />
            <p className={HINT_CLASSES}>2 – 20 members</p>
          </div>
          <div>
            <label className={LABEL_CLASSES}>Cycle Duration</label>
            <div className="relative mt-2">
              <input
                type="number"
                value={cycleDuration}
                onChange={(e) => setCycleDuration(e.target.value)}
                min="10"
                className={`${INPUT_CLASSES} pr-8`}
                disabled={submitting}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-500">
                s
              </span>
            </div>
            <p className={HINT_CLASSES}>120 = 2 min (demo)</p>
          </div>
        </div>

        {/* Penalty Percent */}
        <div>
          <div className="flex items-center justify-between">
            <label className={LABEL_CLASSES}>Penalty per Missed Cycle</label>
            <span className="text-sm font-semibold text-zinc-100">{penaltyPercent}%</span>
          </div>
          <div className="mt-3">
            <input
              type="range"
              value={penaltyPercent}
              onChange={(e) => setPenaltyPercent(e.target.value)}
              min="0"
              max="100"
              step="5"
              className="w-full accent-emerald-500"
              disabled={submitting}
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
              <span>0% — No penalty</span>
              <span>100% — Full forfeit</span>
            </div>
          </div>
        </div>

        {/* ── Summary ── */}
        <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60">
          <div className="border-b border-zinc-800/60 px-5 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Summary</h3>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {[
              { label: 'You pay now (deposit)', value: `${fmtFlow(contributionAmount)} FLOW`, hint: formatFiat(contribution) || 'Returned when circle completes' },
              { label: 'You pay each cycle', value: `${fmtFlow(contributionAmount)} FLOW`, hint: formatFiat(contribution) },
              { label: 'Number of cycles', value: `${members}`, hint: 'One cycle per member' },
              { label: 'Your total cost', value: `${fmtFlow(String(contribution * members))} FLOW`, hint: formatFiat(contribution * members) || `${members} cycles × ${fmtFlow(contributionAmount)} FLOW` },
              { label: 'Each payout (pot)', value: `${fmtFlow(String(totalPayout))} FLOW`, accent: true, hint: formatFiat(totalPayout) || `${members} members × ${fmtFlow(contributionAmount)} FLOW` },
            ].map((row) => (
              <div key={row.label} className="flex flex-col px-5 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">{row.label}</span>
                  <span className={`text-sm font-medium ${row.accent ? 'text-emerald-400' : 'text-zinc-200'}`}>
                    {row.value}
                  </span>
                </div>
                {row.hint && (
                  <span className="mt-0.5 text-[11px] text-zinc-600">{row.hint}</span>
                )}
              </div>
            ))}
          </div>

          {/* How it works callout */}
          <div className="border-t border-zinc-800/60 px-5 py-3">
            <p className="text-xs leading-relaxed text-zinc-600">
              Each cycle, all {members} members contribute {fmtFlow(contributionAmount)} FLOW.
              The full pot ({fmtFlow(String(totalPayout))} FLOW) goes to one member on rotation.
              After {members} cycles, everyone has received exactly one payout.
            </p>
          </div>
        </div>

        {/* ── Submit ── */}
        <button
          type="submit"
          disabled={submitting}
          className="group relative w-full overflow-hidden rounded-2xl bg-emerald-600 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating Circle...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              Create Circle & Join as Member #1
              <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs">
                {fmtFlow(contributionAmount)} FLOW
              </span>
            </span>
          )}
        </button>
      </form>
    </div>
  );
}
