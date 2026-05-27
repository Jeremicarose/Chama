#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${NETWORK:-emulator}"
HOST_ADDRESS="0xf8d6e0586b0a20c7"
CIRCLE_NAME="${CIRCLE_NAME:-Scheduler Test}"
CIRCLE_ID="${CIRCLE_ID:-1}"

run_flow() {
  flow "$@" --network "$NETWORK" --output json
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

assert_no_error() {
  local json="$1"
  local message="$2"
  local err
  err="$(printf '%s' "$json" | jq -r '.error // empty')"
  if [[ -n "$err" ]]; then
    printf '%s\n' "$json"
    echo "Verification failed: $message"
    exit 1
  fi
}

log "Checking current circle count"
COUNT_JSON="$(run_flow scripts execute cadence/scripts/GetCircleCount.cdc)"
COUNT="$(printf '%s' "$COUNT_JSON" | jq -r '.value')"
NEXT_ID=$((COUNT + 1))
log "Current circle count: $COUNT, next expected circle id: $NEXT_ID"

log "Ensuring member2 exists and is funded"
run_flow transactions send cadence/transactions/FundAccount.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"Address\",\"value\":\"0x179b6b1cb6755e31\"},{\"type\":\"UFix64\",\"value\":\"20.0\"}]" >/dev/null

log "Creating circle"
CREATE_JSON="$(run_flow transactions send cadence/transactions/CreateCircle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"String\",\"value\":\"${CIRCLE_NAME}\"},{\"type\":\"UFix64\",\"value\":\"1.0\"},{\"type\":\"UFix64\",\"value\":\"10.0\"},{\"type\":\"UInt64\",\"value\":\"2\"},{\"type\":\"UFix64\",\"value\":\"50.0\"}]")"
assert_no_error "$CREATE_JSON" "create circle transaction errored"

ACTUAL_CIRCLE_ID="$(printf '%s' "$CREATE_JSON" | jq -r '.events[] | select(.type | endswith("ChamaCircle.CircleCreated")) | .values.value.fields[] | select(.name=="circleId") | .value.value' | tail -n 1)"
if [[ -z "$ACTUAL_CIRCLE_ID" || "$ACTUAL_CIRCLE_ID" == "null" ]]; then
  echo "Could not determine created circle id"
  printf '%s\n' "$CREATE_JSON"
  exit 1
fi
log "Created circle id: $ACTUAL_CIRCLE_ID"

log "Registering circle in manager"
REGISTER_CIRCLE_JSON="$(run_flow transactions send cadence/transactions/RegisterCircle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"},{\"type\":\"String\",\"value\":\"${CIRCLE_NAME}\"}]")"
assert_no_error "$REGISTER_CIRCLE_JSON" "register circle transaction errored"

log "Member2 joining circle"
JOIN_JSON="$(run_flow transactions send cadence/transactions/JoinCircle.cdc \
  --signer member2 \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$JOIN_JSON" "join circle transaction errored"

log "Registering member2 in manager"
REGISTER_MEMBER_JSON="$(run_flow transactions send cadence/transactions/RegisterMember.cdc \
  --signer member2 \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$REGISTER_MEMBER_JSON" "register member transaction errored"

log "Inspecting active circle state"
CIRCLE_STATE_JSON="$(run_flow scripts execute cadence/scripts/GetCircleState.cdc \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
STATUS_RAW="$(printf '%s' "$CIRCLE_STATE_JSON" | jq -r '.value.value.fields[] | select(.name=="status") | .value.value.fields[] | select(.name=="rawValue") | .value.value')"
CURRENT_CYCLE="$(printf '%s' "$CIRCLE_STATE_JSON" | jq -r '.value.value.fields[] | select(.name=="currentCycle") | .value.value')"

if [[ "$STATUS_RAW" != "1" || "$CURRENT_CYCLE" != "1" ]]; then
  printf '%s\n' "$CIRCLE_STATE_JSON"
  echo "Expected active circle in cycle 1 after second join"
  exit 1
fi

log "Initializing scheduler handler"
INIT_JSON="$(run_flow transactions send cadence/transactions/InitHandler.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"},{\"type\":\"UFix64\",\"value\":\"1.00000000\"}]")"
assert_no_error "$INIT_JSON" "init handler transaction errored"

log "Scheduling first cycle"
SCHEDULE_JSON="$(run_flow transactions send cadence/transactions/ScheduleNextCycle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$SCHEDULE_JSON" "schedule next cycle transaction errored"

log "Inspecting scheduler state"
SCHEDULER_STATE_JSON="$(run_flow scripts execute cadence/scripts/GetSchedulerState.cdc \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
printf '%s\n' "$SCHEDULER_STATE_JSON"

echo "Sequential scheduler verification completed for circle ${ACTUAL_CIRCLE_ID}."
