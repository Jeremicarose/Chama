// =============================================================================
// not-found.tsx — Custom 404 page
// =============================================================================
//
// PURPOSE:
//   Replaces the default Next.js 404 page with a branded one that guides
//   users back to the dashboard. Shown when a route doesn't match any page.
//
// WHY A CUSTOM 404?
//   The default Next.js 404 is plain white with "404 | This page could not
//   be found." — it breaks the visual flow of the app. A custom page keeps
//   users within the brand experience and offers a clear next step.
// =============================================================================

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-6xl font-bold text-zinc-200 dark:text-zinc-800">404</p>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
