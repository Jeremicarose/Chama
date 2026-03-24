// =============================================================================
// currency.ts — FLOW price fetching + fiat conversion (USD, KES)
// =============================================================================
//
// PURPOSE:
//   Fetches the current FLOW/USD price from CoinGecko's free API and provides
//   helper functions to display FLOW amounts with fiat equivalents. This makes
//   amounts meaningful to users who think in KES (Kenyan Shilling) or USD
//   rather than raw FLOW tokens.
//
// HOW IT WORKS:
//   1. `useFlowPrice()` hook fetches FLOW/USD price on mount, caches for 5 min
//   2. `formatWithFiat()` converts a FLOW amount to a display string like:
//      "10.00 FLOW (~$4.20 / KSh 643)"
//   3. `fmtFlow()` is the shared FLOW formatting function (replaces duplicates)
//
// CACHING:
//   CoinGecko free tier allows 10-30 calls/minute. We cache aggressively:
//   - In-memory cache with 5-minute TTL
//   - Falls back to last known price if API fails
//   - Returns null price (FLOW-only display) if never fetched
//
// KES RATE:
//   We use a fixed USD→KES rate since CoinGecko free API doesn't provide KES.
//   This is acceptable for a hackathon demo. In production, you'd fetch the
//   live forex rate from an API like exchangerate-api.com.
// =============================================================================

'use client';

import { useState, useEffect } from 'react';

// =============================================================================
// Constants
// =============================================================================

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=flow&vs_currencies=usd';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const USD_TO_KES = 153; // Approximate USD/KES rate (March 2026)

// =============================================================================
// Cache
// =============================================================================

let cachedPrice: number | null = null;
let cacheTimestamp = 0;

async function fetchFlowPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedPrice !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPrice;
  }

  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) return cachedPrice;
    const data = await res.json();
    const price = data?.flow?.usd;
    if (typeof price === 'number' && price > 0) {
      cachedPrice = price;
      cacheTimestamp = now;
      return price;
    }
    return cachedPrice;
  } catch {
    return cachedPrice;
  }
}

// =============================================================================
// React Hook
// =============================================================================

interface FlowPriceData {
  usdPrice: number | null;
  kesRate: number;
  loading: boolean;
  toUSD: (flow: number) => number | null;
  toKES: (flow: number) => number | null;
  formatFiat: (flow: number) => string;
}

export function useFlowPrice(): FlowPriceData {
  const [usdPrice, setUsdPrice] = useState<number | null>(cachedPrice);
  const [loading, setLoading] = useState(cachedPrice === null);

  useEffect(() => {
    fetchFlowPrice().then((price) => {
      setUsdPrice(price);
      setLoading(false);
    });
  }, []);

  const toUSD = (flow: number): number | null =>
    usdPrice !== null ? flow * usdPrice : null;

  const toKES = (flow: number): number | null =>
    usdPrice !== null ? flow * usdPrice * USD_TO_KES : null;

  const formatFiat = (flow: number): string => {
    if (usdPrice === null) return '';
    const usd = flow * usdPrice;
    const kes = usd * USD_TO_KES;
    return `~$${usd.toFixed(2)} / KSh ${kes.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  return { usdPrice, kesRate: USD_TO_KES, loading, toUSD, toKES, formatFiat };
}

// =============================================================================
// Shared Formatting
// =============================================================================

/**
 * Formats a FLOW amount string to a human-readable display value.
 * Replaces the 3 duplicate `fmtFlow` functions across the codebase.
 */
export function fmtFlow(val: string | number): string {
  const n = typeof val === 'number' ? val : parseFloat(val || '0');
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formats a FLOW amount with fiat equivalents inline.
 * Returns: "10.00 FLOW (~$4.20 / KSh 643)" or "10.00 FLOW" if price unavailable.
 */
export function formatFlowWithFiat(flowAmount: number | string, usdPrice: number | null): string {
  const n = typeof flowAmount === 'number' ? flowAmount : parseFloat(flowAmount || '0');
  if (isNaN(n)) return '0.00 FLOW';
  const flowStr = fmtFlow(n);
  if (usdPrice === null) return `${flowStr} FLOW`;
  const usd = n * usdPrice;
  const kes = usd * USD_TO_KES;
  return `${flowStr} FLOW (~$${usd.toFixed(2)} / KSh ${kes.toLocaleString('en-US', { maximumFractionDigits: 0 })})`;
}
