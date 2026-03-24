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
// WHY NOT FCL EVENTS?
//   FCL's event subscription is designed for real-time streaming, not historical
//   queries. The REST API is simpler for fetching past events in bulk.
//
// LIMITATIONS:
//   - Flow REST API limits range queries to 250 blocks
//   - We work around this by fetrying from latest block backward in chunks
//   - For hackathon purposes, we fetch the last ~50,000 blocks (~7 days)
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
// Core Fetch
// =============================================================================

/**
 * Fetches the latest block height from Flow's REST API.
 */
async function getLatestBlockHeight(): Promise<number> {
  const res = await fetch(`${ACCESS_NODE}/v1/blocks?height=sealed&expand=`);
  if (!res.ok) throw new Error(`Failed to fetch latest block: ${res.status}`);
  const blocks = await res.json();
  return blocks[0]?.header?.height || 0;
}

/**
 * Fetches events of a specific type within a block range.
 * Flow REST API limits to 250 blocks per request.
 */
async function fetchEventsInRange(
  eventType: string,
  startHeight: number,
  endHeight: number,
): Promise<FlowEvent[]> {
  const fullType = `A.${CONTRACT_ADDRESS}.ChamaCircle.${eventType}`;
  const url = `${ACCESS_NODE}/v1/events?type=${fullType}&start_height=${startHeight}&end_height=${endHeight}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) return []; // Range too old or invalid
    throw new Error(`Event fetch failed: ${res.status}`);
  }

  const data = await res.json();
  const events: FlowEvent[] = [];

  // Response is array of { block_height, block_timestamp, events: [...] }
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
// Public API
// =============================================================================

/**
 * Fetches all ChamaCircle events for a specific circleId.
 *
 * Queries the last ~50,000 blocks (roughly 7 days on Flow testnet) across
 * all event types, filters by circleId, and returns sorted newest-first.
 *
 * @param circleId - The circle ID to filter events for
 * @returns Array of CircleActivity sorted by block height descending
 */
export async function fetchCircleEvents(circleId: string): Promise<CircleActivity[]> {
  const latestHeight = await getLatestBlockHeight();

  // Search the last 50,000 blocks (~7 days on testnet)
  const searchDepth = 50000;
  const startHeight = Math.max(0, latestHeight - searchDepth);

  // Fetch all event types in parallel, chunked into 250-block ranges
  const chunkSize = 250;
  const allEvents: FlowEvent[] = [];

  // For each event type, fetch in chunks
  const fetchPromises = EVENT_TYPES.map(async (eventType) => {
    const events: FlowEvent[] = [];
    for (let h = startHeight; h <= latestHeight; h += chunkSize) {
      const end = Math.min(h + chunkSize - 1, latestHeight);
      try {
        const chunk = await fetchEventsInRange(eventType, h, end);
        events.push(...chunk);
      } catch {
        // Skip failed chunks silently
      }
    }
    return events;
  });

  const results = await Promise.all(fetchPromises);
  for (const events of results) {
    allEvents.push(...events);
  }

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

  return circleEvents;
}

/**
 * Fetches events for all circles at once (for the History page).
 * Returns events grouped by circleId.
 */
export async function fetchAllCircleEvents(circleIds: string[]): Promise<Record<string, CircleActivity[]>> {
  const latestHeight = await getLatestBlockHeight();
  const searchDepth = 50000;
  const startHeight = Math.max(0, latestHeight - searchDepth);
  const chunkSize = 250;

  const allEvents: FlowEvent[] = [];

  const fetchPromises = EVENT_TYPES.map(async (eventType) => {
    const events: FlowEvent[] = [];
    for (let h = startHeight; h <= latestHeight; h += chunkSize) {
      const end = Math.min(h + chunkSize - 1, latestHeight);
      try {
        const chunk = await fetchEventsInRange(eventType, h, end);
        events.push(...chunk);
      } catch {
        // Skip failed chunks
      }
    }
    return events;
  });

  const results = await Promise.all(fetchPromises);
  for (const events of results) {
    allEvents.push(...events);
  }

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

  return grouped;
}
