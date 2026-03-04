// =============================================================================
// TransactionToast.tsx — Toast notifications for blockchain transactions
// =============================================================================
//
// PURPOSE:
//   Blockchain transactions take 5-10 seconds on testnet. Users need clear
//   feedback during that wait: "Transaction sent... Waiting for confirmation...
//   Success!" or "Failed: insufficient balance". This component provides that
//   feedback as a floating toast in the bottom-right corner.
//
// WHY A CUSTOM TOAST (not react-hot-toast or sonner)?
//   1. Zero dependencies — important for a hackathon project's bundle size
//   2. We need blockchain-specific states (pending → sealing → sealed → error)
//      that generic toast libs don't model well
//   3. It's ~80 lines of code; adding a library would be heavier
//
// STATES:
//   - pending:  Transaction submitted, waiting for wallet approval
//   - sealing:  Wallet approved, transaction sent to chain, waiting for seal
//   - sealed:   Transaction confirmed on-chain (success)
//   - error:    Transaction failed at any stage
//
// USAGE:
//   import { useTransactionToast } from '@/components/TransactionToast';
//
//   const { showToast, ToastComponent } = useTransactionToast();
//   showToast({ status: 'pending', message: 'Creating circle...' });
//   // later...
//   showToast({ status: 'sealed', message: 'Circle created!' });
//
//   // In JSX:
//   <ToastComponent />
// =============================================================================

'use client';

import { useState, useCallback, useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

type ToastStatus = 'pending' | 'sealing' | 'sealed' | 'error';

interface ToastData {
  status: ToastStatus;
  message: string;
  txId?: string;
}

// =============================================================================
// Visual config per status
// =============================================================================
//
// Each status gets distinct colors and an icon so users can tell at a glance
// whether the transaction is still in progress or has completed.

const STATUS_STYLES: Record<ToastStatus, { bg: string; icon: string }> = {
  pending: {
    bg: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300',
    icon: '⏳',
  },
  sealing: {
    bg: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
    icon: '⛓',
  },
  sealed: {
    bg: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    icon: '✓',
  },
  error: {
    bg: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-300',
    icon: '✗',
  },
};

const STATUS_LABELS: Record<ToastStatus, string> = {
  pending: 'Waiting for wallet...',
  sealing: 'Confirming on-chain...',
  sealed: 'Confirmed!',
  error: 'Transaction failed',
};

// =============================================================================
// Hook: useTransactionToast
// =============================================================================
//
// Returns a showToast function and a ToastComponent to render.
// The toast auto-dismisses after 5 seconds for success/error states.
// Pending/sealing states persist until explicitly updated.

export function useTransactionToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const [visible, setVisible] = useState(false);

  const showToast = useCallback((data: ToastData) => {
    setToast(data);
    setVisible(true);
  }, []);

  const hideToast = useCallback(() => {
    setVisible(false);
    // Delay clearing data so exit animation can play
    setTimeout(() => setToast(null), 300);
  }, []);

  // Auto-dismiss sealed and error toasts after 5 seconds
  useEffect(() => {
    if (!toast) return;
    if (toast.status === 'sealed' || toast.status === 'error') {
      const timer = setTimeout(hideToast, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast, hideToast]);

  // ── Toast Component ──
  // Renders as a fixed-position element in the bottom-right corner.
  // Uses CSS transitions for smooth appear/disappear.
  function ToastComponent() {
    if (!toast) return null;

    const style = STATUS_STYLES[toast.status];

    return (
      <div
        className={`fixed bottom-6 right-6 z-50 max-w-sm transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <div className={`flex items-start gap-3 rounded-lg border p-4 shadow-lg ${style.bg}`}>
          {/* Status icon or spinner */}
          <div className="flex-shrink-0 text-lg">
            {toast.status === 'pending' || toast.status === 'sealing' ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <span>{style.icon}</span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{STATUS_LABELS[toast.status]}</p>
            <p className="mt-0.5 text-xs opacity-80">{toast.message}</p>

            {/* Flowscan link for sealed transactions */}
            {toast.txId && toast.status === 'sealed' && (
              <a
                href={`https://testnet.flowscan.io/transaction/${toast.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs underline opacity-70 hover:opacity-100"
              >
                View on Flowscan
              </a>
            )}
          </div>

          {/* Dismiss button */}
          <button
            onClick={hideToast}
            className="flex-shrink-0 opacity-50 hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return { showToast, hideToast, ToastComponent };
}
