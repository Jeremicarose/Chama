// =============================================================================
// FlowProvider.tsx — Client-side wrapper that initializes FCL configuration
// =============================================================================
//
// PURPOSE:
//   In Next.js App Router, the root layout (layout.tsx) is a Server Component.
//   Server Components can't run browser-side code like FCL configuration.
//   This wrapper is a Client Component that:
//   1. Imports flow-config.ts (which calls fcl.config() with our settings)
//   2. Provides a boundary where all child components can use FCL hooks
//
// WHY NOT JUST 'use client' IN layout.tsx?
//   Making the entire layout a Client Component would disable Server Component
//   optimizations (streaming, zero-JS for static parts, etc.) for the whole app.
//   Instead, we keep layout.tsx as a Server Component and wrap only the parts
//   that need client-side behavior in this provider.
//
// WHY NOT React Context?
//   FCL manages its own global state internally. We don't need to thread
//   values through React Context — any component can import fcl directly
//   or use our useCurrentUser hook. This provider just ensures the config
//   module is loaded before any FCL calls happen.
//
// ALTERNATIVE CONSIDERED:
//   @onflow/fcl-react's <FclProvider> — adds dependency for something we
//   can do in 10 lines. If we later need FCL's React-specific features
//   (transaction status hooks, etc.), we'd switch.
// =============================================================================

'use client';

// This import has a side effect: it runs fcl.config() which sets up
// the access node, discovery wallet, and contract address aliases.
// Just importing the module is enough — no need to use the exports here.
import '@/lib/flow-config';

export default function FlowProvider({ children }: { children: React.ReactNode }) {
  // -------------------------------------------------------------------------
  // This component is intentionally minimal — it's just a Client Component
  // boundary that ensures flow-config.ts is loaded. The children render
  // as-is without any wrapping DOM elements (no extra <div>).
  //
  // Using a Fragment (<>) would also work, but returning children directly
  // is even simpler. TypeScript accepts this because children is ReactNode.
  // -------------------------------------------------------------------------
  return <>{children}</>;
}
