import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-7xl font-bold text-zinc-800">404</p>
      <h1 className="mt-4 text-xl font-semibold text-zinc-100">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
