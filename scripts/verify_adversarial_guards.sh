#!/usr/bin/env bash
set -euo pipefail

NETWORK="${NETWORK:-emulator}"
HOST_ADDRESS="0xf8d6e0586b0a20c7"
CIRCLE_NAME="${CIRCLE_NAME:-Guard Test}"
SLEEP_AFTER_SCHEDULE="${SLEEP_AFTER_SCHEDULE:-2}"
MEMBER2_ADDRESS="0x179b6b1cb6755e31"
MEMBER2_PUBLIC_KEY="915dff77a7ad891b4a42152022dc57505e2ea9cf8b067e13f5aa3557659eb0846bd51c7cfee5904e978926fb4d9f05e94391d1c906e4dd7d54b5d570dee6a122"

run_flow() {
  flow "$@" --network "$NETWORK" --output json
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

assert_has_error() {
  local json="$1"
  local message="$2"
  local err
  err="$(printf '%s' "$json" | jq -r '.error // empty')"
  if [[ -z "$err" ]]; then
    printf '%s\n' "$json"
    echo "Expected failure but transaction succeeded: $message"
    exit 1
  fi
}

assert_no_error() {
  local json="$1"
  local message="$2"
  local err
  err="$(printf '%s' "$json" | jq -r '.error // empty')"
  if [[ -n "$err" ]]; then
    printf '%s\n' "$json"
    echo "Unexpected failure: $message"
    exit 1
  fi
}

account_exists() {
  local address="$1"
  local output
  output="$(run_flow accounts get "$address" 2>/dev/null || true)"
  if [[ -z "$output" ]]; then
    return 1
  fi
  local err
  err="$(printf '%s' "$output" | jq -r '.error // empty' 2>/dev/null || true)"
  [[ -z "$err" ]]
}

log "Checking current circle count"
COUNT_JSON="$(run_flow scripts execute cadence/scripts/GetCircleCount.cdc)"
COUNT="$(printf '%s' "$COUNT_JSON" | jq -r '.value')"

log "Ensuring member2 exists and is funded"
if ! account_exists "$MEMBER2_ADDRESS"; then
  run_flow accounts create \
    --key "$MEMBER2_PUBLIC_KEY" \
    --signer emulator-account >/dev/null
fi
run_flow transactions send cadence/transactions/FundAccount.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"Address\",\"value\":\"${MEMBER2_ADDRESS}\"},{\"type\":\"UFix64\",\"value\":\"20.0\"}]" >/dev/null

log "Creating guard test circle"
CREATE_JSON="$(run_flow transactions send cadence/transactions/CreateCircle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"String\",\"value\":\"${CIRCLE_NAME}\"},{\"type\":\"UFix64\",\"value\":\"1.0\"},{\"type\":\"UFix64\",\"value\":\"10.0\"},{\"type\":\"UInt64\",\"value\":\"2\"},{\"type\":\"UFix64\",\"value\":\"50.0\"}]")"
assert_no_error "$CREATE_JSON" "create guard circle"

ACTUAL_CIRCLE_ID="$(printf '%s' "$CREATE_JSON" | jq -r '.events[] | select(.type | endswith("ChamaCircle.CircleCreated")) | .values.value.fields[] | select(.name=="circleId") | .value.value' | tail -n 1)"
if [[ -z "$ACTUAL_CIRCLE_ID" || "$ACTUAL_CIRCLE_ID" == "null" ]]; then
  echo "Could not determine guard circle id"
  printf '%s\n' "$CREATE_JSON"
  exit 1
fi
log "Guard circle id: $ACTUAL_CIRCLE_ID"

log "Attempting invalid circle registration with wrong name"
BAD_REGISTER_CIRCLE_JSON="$(run_flow transactions send cadence/transactions/RegisterCircle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"},{\"type\":\"String\",\"value\":\"Wrong Name\"}]")"
assert_has_error "$BAD_REGISTER_CIRCLE_JSON" "registerCircle should reject mismatched name"

log "Registering circle with correct data"
REGISTER_CIRCLE_JSON="$(run_flow transactions send cadence/transactions/RegisterCircle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"},{\"type\":\"String\",\"value\":\"${CIRCLE_NAME}\"}]")"
assert_no_error "$REGISTER_CIRCLE_JSON" "register circle with correct data"

log "Attempting invalid member registration before member joins"
BAD_REGISTER_MEMBER_JSON="$(run_flow transactions send cadence/transactions/RegisterMember.cdc \
  --signer member2 \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_has_error "$BAD_REGISTER_MEMBER_JSON" "registerMember should reject non-member signer"

log "Joining member2"
JOIN_JSON="$(run_flow transactions send cadence/transactions/JoinCircle.cdc \
  --signer member2 \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$JOIN_JSON" "member2 join"

log "Registering member2 after join"
REGISTER_MEMBER_JSON="$(run_flow transactions send cadence/transactions/RegisterMember.cdc \
  --signer member2 \
  --args-json "[{\"type\":\"Address\",\"value\":\"${HOST_ADDRESS}\"},{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$REGISTER_MEMBER_JSON" "register member after join"

log "Attempting schedule recovery before handler initialization"
BAD_RECOVER_JSON="$(run_flow transactions send cadence/transactions/RecoverSchedule.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_has_error "$BAD_RECOVER_JSON" "recoverSchedule should fail before handler init"

log "Initializing scheduler handler"
INIT_JSON="$(run_flow transactions send cadence/transactions/InitHandler.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"},{\"type\":\"UFix64\",\"value\":\"1.00000000\"}]")"
assert_no_error "$INIT_JSON" "init handler"

log "Scheduling first cycle"
SCHEDULE_JSON="$(run_flow transactions send cadence/transactions/ScheduleNextCycle.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$SCHEDULE_JSON" "schedule next cycle"

log "Waiting ${SLEEP_AFTER_SCHEDULE}s before testing recovery after schedule exists"
sleep "$SLEEP_AFTER_SCHEDULE"

log "Attempting schedule recovery while schedule already exists"
RECOVER_JSON="$(run_flow transactions send cadence/transactions/RecoverSchedule.cdc \
  --signer emulator-account \
  --args-json "[{\"type\":\"UInt64\",\"value\":\"${ACTUAL_CIRCLE_ID}\"}]")"
assert_no_error "$RECOVER_JSON" "recover schedule after initialization"

echo "Adversarial guard verification completed for circle ${ACTUAL_CIRCLE_ID}."
