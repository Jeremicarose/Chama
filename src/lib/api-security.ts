import { NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function now() {
  return Date.now();
}

function cleanupExpiredBuckets() {
  const current = now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= current) {
      rateLimitBuckets.delete(key);
    }
  }
}

export function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

export function rateLimit(key: string, limit: number, windowMs = FIVE_MINUTES_MS) {
  cleanupExpiredBuckets();

  const bucket = rateLimitBuckets.get(key);
  const current = now();

  if (!bucket || bucket.resetAt <= current) {
    rateLimitBuckets.set(key, { count: 1, resetAt: current + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count };
}

function getAllowedOrigins() {
  const origins = new Set<string>();

  if (process.env.NEXT_PUBLIC_APP_ORIGIN) {
    origins.add(process.env.NEXT_PUBLIC_APP_ORIGIN);
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  origins.add('http://localhost:3000');
  origins.add('http://127.0.0.1:3000');

  return origins;
}

export function assertAllowedOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) {
    throw new Error('Missing origin or host header.');
  }

  const allowedOrigins = getAllowedOrigins();
  const requestUrl = new URL(origin);
  const normalizedHost = host.toLowerCase();

  const sameHost = requestUrl.host.toLowerCase() === normalizedHost;
  const explicitlyAllowed = allowedOrigins.has(origin);

  if (!sameHost && !explicitlyAllowed) {
    throw new Error(`Origin ${origin} is not allowed.`);
  }
}

export function assertFlowNetworkAllowedForSponsorship() {
  if (publicEnv.flowNetwork === 'mainnet' && !process.env.ENABLE_MAINNET_SPONSORSHIP) {
    throw new Error(
      'Mainnet sponsorship is disabled. Set ENABLE_MAINNET_SPONSORSHIP to enable sponsored transactions on mainnet.',
    );
  }
}
