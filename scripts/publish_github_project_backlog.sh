#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-Jeremicarose/Chama}"
OWNER="${OWNER:-Jeremicarose}"
PROJECT_NUMBER="${PROJECT_NUMBER:-}"
BACKLOG_FILE="${BACKLOG_FILE:-project-backlog/issues.json}"
MODE="${MODE:-issues}"

if [[ -z "${PROJECT_NUMBER}" ]]; then
  echo "Set PROJECT_NUMBER to your GitHub Project number."
  echo "Example:"
  echo "  PROJECT_NUMBER=3 ./scripts/publish_github_project_backlog.sh"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required."
  exit 1
fi

echo "Checking GitHub auth..."
if [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]]; then
  echo "Using GitHub token from environment."
elif ! gh auth status >/dev/null 2>&1; then
  echo "GitHub auth is not valid."
  echo "Run:"
  echo "  gh auth login -h github.com"
  echo "  gh auth refresh -s project"
  exit 1
fi

ensure_label() {
  local name="$1"
  local color="$2"
  local desc="$3"
  gh label create "$name" -R "$REPO" --color "$color" --description "$desc" --force >/dev/null
}

echo "Ensuring labels exist..."
ensure_label "priority:P0" "B60205" "Highest priority"
ensure_label "priority:P1" "D93F0B" "High priority"
ensure_label "priority:P2" "FBCA04" "Medium priority"
ensure_label "priority:P3" "0E8A16" "Lower priority"
ensure_label "area:protocol" "5319E7" "Protocol and contracts"
ensure_label "area:app" "1D76DB" "Frontend and app flows"
ensure_label "area:platform" "0052CC" "Infrastructure and operations"
ensure_label "area:growth" "C5DEF5" "Analytics and growth"
ensure_label "area:product" "BFDADC" "Product and strategy"
ensure_label "type:security" "D73A4A" "Security work"
ensure_label "type:testing" "A2EEEF" "Testing work"
ensure_label "type:ops" "7057FF" "Operational work"
ensure_label "type:ux" "F9D0C4" "User experience work"
ensure_label "type:infra" "0366D6" "Infrastructure work"

echo "Publishing backlog from ${BACKLOG_FILE} using mode=${MODE}..."

jq -c '.[]' "$BACKLOG_FILE" | while IFS= read -r item; do
  id="$(jq -r '.id' <<<"$item")"
  title="$(jq -r '.title' <<<"$item")"
  owner_label="$(jq -r '.owner' <<<"$item")"
  priority="$(jq -r '.priority' <<<"$item")"
  area="$(jq -r '.area' <<<"$item")"
  type="$(jq -r '.type' <<<"$item")"
  body="$(jq -r '.body' <<<"$item")"

  full_title="[${id}] ${title}"
  full_body=$'Owner: '"${owner_label}"$'\n\n'"${body}"

  if [[ "$MODE" == "drafts" ]]; then
    echo "Creating draft issue item: ${full_title}"
    gh project item-create "$PROJECT_NUMBER" \
      --owner "$OWNER" \
      --title "$full_title" \
      --body "$full_body" >/dev/null
    continue
  fi

  echo "Ensuring GitHub issue exists: ${full_title}"
  issue_url="$(gh issue list -R "$REPO" --search "\"${full_title}\" in:title" --json url,title --jq '.[] | select(.title == "'"${full_title}"'") | .url' | head -n 1 || true)"

  if [[ -z "$issue_url" ]]; then
    issue_url="$(gh issue create \
      -R "$REPO" \
      --title "$full_title" \
      --body "$full_body" \
      --label "priority:${priority}" \
      --label "area:${area}" \
      --label "type:${type}")"
  fi

  echo "Adding issue to project: ${issue_url}"
  gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$issue_url" >/dev/null || true
done

echo
echo "Done."
echo "Repo: ${REPO}"
echo "Project owner: ${OWNER}"
echo "Project number: ${PROJECT_NUMBER}"
echo "Mode: ${MODE}"
