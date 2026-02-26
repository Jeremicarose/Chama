// =============================================================================
// create/page.tsx — Create a new savings circle
// =============================================================================
//
// PURPOSE:
//   Form page where users configure and launch a new Chama circle.
//   Submitting the form sends a CreateCircle transaction to Flow.
//
// FORM FIELDS:
//   - Circle Name: display name (e.g., "Office Lunch Fund")
//   - Contribution Amount: FLOW per cycle per member
//   - Cycle Duration: seconds between payouts (60s for demo, days for real)
//   - Max Members: circle size = number of cycles (2–20)
//   - Penalty Percent: % of deposit forfeited per missed contribution
//
// VALIDATION:
//   Client-side validation mirrors the Cadence pre-conditions in CircleConfig.
//   This gives instant feedback without waiting for a blockchain error.
//   The contract still enforces its own rules — client validation is UX only.
//
// TRANSACTION FLOW:
//   1. User fills form → clicks "Create Circle"
//   2. We call fcl.mutate() with the CreateCircle.cdc transaction
//   3. FCL opens the wallet for signing approval
//   4. Transaction is sent to Flow → sealed in ~5-10 seconds (testnet)
//   5. We parse the CircleCreated event to get the new circle ID
//   6. Redirect to /circle/[id] to view the new circle
// =============================================================================

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fcl } from '@/lib/flow-config';

// =============================================================================
// CreateCircle Transaction (Cadence template)
// =============================================================================
//
// This is the same Cadence code as cadence/transactions/CreateCircle.cdc,
// but with 0xChamaCircle/0xChamaManager placeholders that FCL substitutes
// at runtime using the config from flow-config.ts.
//
// WHY INLINE (not reading the .cdc file)?
//   Next.js client components can't read the filesystem. We'd need a build
//   step to embed .cdc files as strings. For now, inline is simpler.
//   If the contract ABI changes, update both the .cdc file and this string.

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

        ChamaManager.registerCircle(circleId: circleId, host: signer.address, name: name)

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
// Component
// =============================================================================

export default function CreateCirclePage() {
  const router = useRouter();
  const { user } = useCurrentUser();

  // ── Form state ──
  // Each field maps to a CircleConfig parameter.
  const [name, setName] = useState('');
  const [contributionAmount, setContributionAmount] = useState('10.0');
  const [cycleDuration, setCycleDuration] = useState('120');
  const [maxMembers, setMaxMembers] = useState('4');
  const [penaltyPercent, setPenaltyPercent] = useState('50');

  // ── Transaction state ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Form validation
  // -------------------------------------------------------------------------
  //
  // Returns an error message if invalid, null if valid.
  // Mirrors the Cadence pre-conditions so users get instant feedback.
  function validate(): string | null {
    if (!name.trim()) return 'Circle name is required.';
    if (name.length > 50) return 'Circle name must be under 50 characters.';

    const amount = parseFloat(contributionAmount);
    if (isNaN(amount) || amount <= 0) return 'Contribution must be a positive number.';

    const duration = parseFloat(cycleDuration);
    if (isNaN(duration) || duration <= 0) return 'Cycle duration must be positive.';

    const members = parseInt(maxMembers);
    if (isNaN(members) || members < 2) return 'Need at least 2 members.';
    if (members > 20) return 'Maximum 20 members per circle.';

    const penalty = parseFloat(penaltyPercent);
    if (isNaN(penalty) || penalty < 0 || penalty > 100) return 'Penalty must be 0–100%.';

    return null;
  }

  // -------------------------------------------------------------------------
  // Submit: send CreateCircle transaction
  // -------------------------------------------------------------------------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!user.loggedIn) {
      setError('Please connect your wallet first.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // ── Send the transaction via FCL ──
      //
      // fcl.mutate() sends a state-changing transaction.
      // It returns a transaction ID (hash) immediately.
      // The wallet will prompt the user to approve and sign.
      //
      // args: FCL uses a builder pattern. arg(value, type) creates
      // typed arguments that match the Cadence transaction parameters.
      // UFix64 values must be strings with decimal points (e.g., "10.0").
      const txId = await fcl.mutate({
        cadence: CREATE_CIRCLE_TX,
        args: (arg: any, t: any) => [
          arg(name, t.String),
          arg(parseFloat(contributionAmount).toFixed(8), t.UFix64),
          arg(parseFloat(cycleDuration).toFixed(8), t.UFix64),
          arg(parseInt(maxMembers).toString(), t.UInt64),
          arg(parseFloat(penaltyPercent).toFixed(8), t.UFix64),
        ],
        proposer: fcl.currentUser,
        payer: fcl.currentUser,
        authorizations: [fcl.currentUser],
        limit: 9999,
      });

      // ── Wait for the transaction to be sealed ──
      //
      // "Sealed" means the transaction is finalized on-chain (irreversible).
      // On testnet this takes ~5-10 seconds. On emulator it's instant.
      // onceSealed() returns the full transaction result including events.
      const txResult = await fcl.tx(txId).onceSealed();

      // ── Extract the circle ID from the CircleCreated event ──
      //
      // Flow transactions emit events. We look for our CircleCreated event
      // to get the new circle's ID for the redirect.
      const createdEvent = txResult.events?.find(
        (e: any) => e.type.includes('ChamaCircle.CircleCreated')
      );

      if (createdEvent) {
        const circleId = createdEvent.data.circleId;
        router.push(`/circle/${circleId}`);
      } else {
        // Fallback: redirect to dashboard if we can't find the event
        router.push('/');
      }
    } catch (err: any) {
      console.error('CreateCircle failed:', err);
      // FCL errors often have a readable message in err.message
      setError(err?.message || 'Transaction failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  // ── Not connected: prompt to connect ──
  if (!user.loggedIn) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Create a Circle
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Connect your wallet to create a savings circle.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Create a Circle
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Configure your rotating savings circle. You&apos;ll automatically join as
        the first member and pay the security deposit.
      </p>

      {/* ── Error display ── */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── Form ── */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* Circle Name */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Circle Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Office Lunch Fund"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-600"
            disabled={submitting}
            maxLength={50}
          />
        </div>

        {/* Contribution Amount */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Contribution per Cycle (FLOW)
          </label>
          <input
            type="number"
            value={contributionAmount}
            onChange={(e) => setContributionAmount(e.target.value)}
            min="0.01"
            step="0.01"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            disabled={submitting}
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Each member pays this amount every cycle. Also used as the security deposit.
          </p>
        </div>

        {/* Two columns: Members + Duration */}
        <div className="grid grid-cols-2 gap-4">
          {/* Max Members */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Max Members
            </label>
            <input
              type="number"
              value={maxMembers}
              onChange={(e) => setMaxMembers(e.target.value)}
              min="2"
              max="20"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-zinc-500">2–20 members</p>
          </div>

          {/* Cycle Duration */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cycle Duration (seconds)
            </label>
            <input
              type="number"
              value={cycleDuration}
              onChange={(e) => setCycleDuration(e.target.value)}
              min="10"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-zinc-500">120 = 2 min (demo)</p>
          </div>
        </div>

        {/* Penalty Percent */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Penalty Percent
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              value={penaltyPercent}
              onChange={(e) => setPenaltyPercent(e.target.value)}
              min="0"
              max="100"
              step="5"
              className="flex-1 accent-emerald-600"
              disabled={submitting}
            />
            <span className="w-12 text-right text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {penaltyPercent}%
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Percentage of deposit forfeited per missed contribution. 0% = no penalty, 100% = full forfeit.
          </p>
        </div>

        {/* ── Summary Box ── */}
        {/* Shows a preview of what the circle will look like before submitting. */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Summary</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="text-zinc-500">Security deposit:</div>
            <div className="font-medium text-zinc-900 dark:text-zinc-100">
              {parseFloat(contributionAmount || '0').toFixed(2)} FLOW
            </div>
            <div className="text-zinc-500">Total cycles:</div>
            <div className="font-medium text-zinc-900 dark:text-zinc-100">
              {maxMembers} cycles
            </div>
            <div className="text-zinc-500">Total per member:</div>
            <div className="font-medium text-zinc-900 dark:text-zinc-100">
              {(parseFloat(contributionAmount || '0') * parseInt(maxMembers || '0')).toFixed(2)} FLOW
            </div>
            <div className="text-zinc-500">Each payout:</div>
            <div className="font-medium text-emerald-700 dark:text-emerald-400">
              {(parseFloat(contributionAmount || '0') * parseInt(maxMembers || '0')).toFixed(2)} FLOW
            </div>
          </div>
        </div>

        {/* ── Submit Button ── */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Creating Circle...
            </span>
          ) : (
            'Create Circle & Join as Member #1'
          )}
        </button>
      </form>
    </div>
  );
}
