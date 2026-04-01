// =============================================================================
// flow-events.ts — Fetch on-chain events from ChamaCircle contract
// =============================================================================
//
// PURPOSE:
//   Queries Flow's REST API for ChamaCircle contract events. This replaces the
//   IPFS receipt chain approach for Activity Feed and History pages — events
//   are always available (no Storacha config needed) and provide the same data.
//
// HOW IT WORKS:
//   Flow's Access API exposes events via REST:
//     GET /v1/events?type=A.{addr}.ChamaCircle.{EventName}&start_height=...&end_height=...
//
//   We query all relevant event types, filter by circleId, merge, and sort by
//   block height (newest first). Each event includes the block height and
//   transaction ID for linking to Flowscan.
//
// RATE LIMITING:
//   Flow's REST API returns 429 when too many requests are sent. We handle
//   this with: in-memory cache (60s TTL), retry with exponential backoff,
//   sequential fetching per event type, and reduced search depth (10,000 blocks).
// =============================================================================

const CONTRACT_ADDRESS = '4648c731f1777d9d'; // testnet (no 0x prefix for API)
const ACCESS_NODE = 'https://rest-testnet.onflow.org';

// =============================================================================
// Types
// =============================================================================

export interface FlowEvent {
  type: string;
  transactionId: string;
  blockHeight: number;
  blockTimestamp: string;
  data: Record<string, unknown>;
}

export interface CircleActivity {
  action: string;
  timestamp: string;
  transactionId: string;
  blockHeight: number;
  data: Record<string, unknown>;
}

// =============================================================================
// Event Type Map — maps contract event names to UI-friendly action labels
// =============================================================================

const EVENT_TYPES = [
  'CircleCreated',
  'MemberJoined',
  'CircleSealed',
  'ContributionReceived',
  'PayoutExecuted',
  'MemberPenalized',
  'CycleAdvanced',
  'CircleCompleted',
  'DepositReturned',
  'DepositSlashed',
] as const;

const EVENT_TO_ACTION: Record<string, string> = {
  CircleCreated: 'circle_created',
  MemberJoined: 'member_joined',
  CircleSealed: 'circle_sealed',
  ContributionReceived: 'contribution',
  PayoutExecuted: 'payout_executed',
  MemberPenalized: 'member_penalized',
  CycleAdvanced: 'cycle_advanced',
  CircleCompleted: 'circle_completed',
  DepositReturned: 'deposit_returned',
  DepositSlashed: 'deposit_slashed',
};

// =============================================================================
// In-Memory Cache — prevents re-fetching the same events on every poll
// =============================================================================
// Key: circleId or "all:{ids}", Value: { data, timestamp }
// TTL: 60 seconds — events only change when a new transaction is confirmed

const CACHE_TTL_MS = 300_000; // 5 minutes — events only change on new transactions
const cache = new Map<string, { data: CircleActivity[]; timestamp: number }>();

function getCached(key: string): CircleActivity[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: CircleActivity[]) {
  cache.set(key, { data, timestamp: Date.now() });
}

// =============================================================================
// Core Fetch with Retry
// =============================================================================

/**
 * Fetches the latest block height from Flow's REST API.
 * Retries up to 3 times on 429 with exponential backoff.
 */
async function getLatestBlockHeight(): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ACCESS_NODE}/v1/blocks?height=sealed&expand=`);
    if (res.ok) {
      const blocks = await res.json();
      return blocks[0]?.header?.height || 0;
    }
    if (res.status === 429) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Failed to fetch latest block: ${res.status}`);
  }
  throw new Error('Failed to fetch latest block after retries (rate limited)');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches events of a specific type within a block range.
 * Flow REST API limits to 250 blocks per request.
 * Retries on 429 with exponential backoff.
 */
async function fetchEventsInRange(
  eventType: string,
  startHeight: number,
  endHeight: number,
): Promise<FlowEvent[]> {
  const fullType = `A.${CONTRACT_ADDRESS}.ChamaCircle.${eventType}`;
  const url = `${ACCESS_NODE}/v1/events?type=${fullType}&start_height=${startHeight}&end_height=${endHeight}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const events: FlowEvent[] = [];
      for (const block of data) {
        for (const evt of block.events || []) {
          events.push({
            type: eventType,
            transactionId: evt.transaction_id,
            blockHeight: parseInt(block.block_height),
            blockTimestamp: block.block_timestamp,
            data: evt.payload?.value?.value
              ? parseEventPayload(evt.payload)
              : {},
          });
        }
      }
      return events;
    }
    if (res.status === 400) return []; // Range too old or invalid
    if (res.status === 429) {
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }
    // Other errors — skip this chunk
    return [];
  }
  return []; // All retries exhausted
}

/**
 * Parses a Cadence JSON-CDC event payload into a flat object.
 * Flow event payloads use JSON-CDC encoding with nested {type, value} pairs.
 */
function parseEventPayload(payload: any): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  try {
    const fields = payload?.value?.value?.fields || payload?.value?.fields || [];
    for (const field of fields) {
      const name = field.name;
      const val = field.value;
      if (val?.type === 'UInt64' || val?.type === 'Int') {
        result[name] = val.value;
      } else if (val?.type === 'UFix64') {
        result[name] = val.value;
      } else if (val?.type === 'String') {
        result[name] = val.value;
      } else if (val?.type === 'Address') {
        result[name] = val.value;
      } else if (val?.type === 'Optional') {
        result[name] = val.value?.value ?? null;
      } else {
        result[name] = val?.value ?? String(val);
      }
    }
  } catch {
    // If parsing fails, return empty — graceful degradation
  }
  return result;
}

// =============================================================================
// Internal: fetch all events across types for a block range
// =============================================================================

/**
 * Fetches all event types sequentially (not in parallel) to avoid rate limits.
 * Within each event type, chunks are fetched sequentially with a small delay.
 */
async function fetchAllEventsInRange(
  startHeight: number,
  endHeight: number,
): Promise<FlowEvent[]> {
  const chunkSize = 250;
  const allEvents: FlowEvent[] = [];

  for (const eventType of EVENT_TYPES) {
    for (let h = startHeight; h <= endHeight; h += chunkSize) {
      const end = Math.min(h + chunkSize - 1, endHeight);
      try {
        const chunk = await fetchEventsInRange(eventType, h, end);
        allEvents.push(...chunk);
      } catch {
        // Skip failed chunks silently
      }
    }
    // Small delay between event types to stay under rate limits
    await sleep(100);
  }

  return allEvents;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetches all ChamaCircle events for a specific circleId.
 *
 * Uses a 60s in-memory cache to avoid hammering the Flow REST API.
 * Queries the last ~10,000 blocks (~1.5 days on Flow testnet).
 * Fetches event types sequentially with delays to respect rate limits.
 *
 * @param circleId - The circle ID to filter events for
 * @returns Array of CircleActivity sorted by block height descending
 */
export async function fetchCircleEvents(circleId: string): Promise<CircleActivity[]> {
  // Check cache first
  const cached = getCached(`circle:${circleId}`);
  if (cached) return cached;

  const latestHeight = await getLatestBlockHeight();

  // Search the last 2,000 blocks (~6 hours on testnet)
  // Keeps API requests manageable: 10 types × 8 chunks = 80 calls
  const searchDepth = 2000;
  const startHeight = Math.max(0, latestHeight - searchDepth);

  const allEvents = await fetchAllEventsInRange(startHeight, latestHeight);

  // Filter by circleId and convert to CircleActivity
  const circleEvents = allEvents
    .filter((evt) => String(evt.data.circleId) === circleId)
    .map((evt) => ({
      action: EVENT_TO_ACTION[evt.type] || evt.type,
      timestamp: evt.blockTimestamp,
      transactionId: evt.transactionId,
      blockHeight: evt.blockHeight,
      data: evt.data,
    }))
    .sort((a, b) => b.blockHeight - a.blockHeight); // Newest first

  setCache(`circle:${circleId}`, circleEvents);
  return circleEvents;
}

/**
 * Fetches events for all circles at once (for the History page).
 * Returns events grouped by circleId.
 */
export async function fetchAllCircleEvents(circleIds: string[]): Promise<Record<string, CircleActivity[]>> {
  const cacheKey = `all:${circleIds.sort().join(',')}`;
  const cachedRaw = getCached(cacheKey);
  if (cachedRaw) {
    // Reconstruct grouped format from flat cache
    const grouped: Record<string, CircleActivity[]> = {};
    for (const id of circleIds) grouped[id] = [];
    for (const evt of cachedRaw) {
      const cid = String(evt.data.circleId);
      if (grouped[cid]) grouped[cid].push(evt);
    }
    return grouped;
  }

  const latestHeight = await getLatestBlockHeight();
  const searchDepth = 2000;
  const startHeight = Math.max(0, latestHeight - searchDepth);

  const allEvents = await fetchAllEventsInRange(startHeight, latestHeight);

  // Group by circleId
  const grouped: Record<string, CircleActivity[]> = {};
  for (const id of circleIds) {
    grouped[id] = [];
  }

  for (const evt of allEvents) {
    const cid = String(evt.data.circleId);
    if (circleIds.includes(cid)) {
      if (!grouped[cid]) grouped[cid] = [];
      grouped[cid].push({
        action: EVENT_TO_ACTION[evt.type] || evt.type,
        timestamp: evt.blockTimestamp,
        transactionId: evt.transactionId,
        blockHeight: evt.blockHeight,
        data: evt.data,
      });
    }
  }

  // Sort each group newest first
  for (const id of Object.keys(grouped)) {
    grouped[id].sort((a, b) => b.blockHeight - a.blockHeight);
  }

  // Cache as flat array for reuse
  const flat = Object.values(grouped).flat();
  setCache(cacheKey, flat);

  return grouped;
}
