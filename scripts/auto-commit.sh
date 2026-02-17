#!/bin/bash

# Auto-commit and push script for Chama
# Generates structured commit messages based on what actually changed.
#
# Message format: <type>(<scope>): <description>
#   type  = feat | fix | refactor | style | docs | chore | test
#   scope = contracts | scheduler | manager | transactions | scripts |
#           components | hooks | lib | app | config | project
#
# Examples:
#   feat(contracts): add ChamaCircle core savings circle contract
#   feat(scheduler): add TransactionHandler for scheduled payouts
#   feat(components): add CountdownTimer and PayoutBanner
#   chore(config): update flow.json and dependencies

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/auto-commit.log"
INTERVAL=60  # seconds

mkdir -p "$REPO_ROOT/logs"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# ---------------------------------------------------------------------------
# Determine the conventional-commit type (feat, fix, refactor, …)
# ---------------------------------------------------------------------------
detect_type() {
    local added="$1" modified="$2" deleted="$3"

    # If only deletions → chore
    if [[ -z "$added" && -z "$modified" && -n "$deleted" ]]; then
        echo "chore"; return
    fi

    # New files → feat
    if [[ -n "$added" ]]; then
        echo "feat"; return
    fi

    # Config / dependency changes → chore
    if echo "$modified" | grep -qE "(package\.json|tsconfig|\.env|\.gitignore|flow\.json)"; then
        echo "chore"; return
    fi

    # Test files → test
    if echo "$modified" | grep -qE "(test|_test)\.(ts|tsx|cdc)$"; then
        echo "test"; return
    fi

    # Docs → docs
    if echo "$modified" | grep -qE "\.(md|txt)$" && ! echo "$modified" | grep -qvE "\.(md|txt)$"; then
        echo "docs"; return
    fi

    echo "feat"
}

# ---------------------------------------------------------------------------
# Determine the scope from file paths (Chama-specific)
# ---------------------------------------------------------------------------
detect_scope() {
    local all_files="$1"
    local has_contracts=false has_transactions=false has_cadence_scripts=false
    local has_cadence_tests=false has_components=false has_hooks=false
    local has_lib=false has_app=false has_config=false has_scripts=false

    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        case "$f" in
            cadence/contracts/ChamaCircle*)    has_contracts=true ;;
            cadence/contracts/ChamaScheduler*) has_contracts=true ;;
            cadence/contracts/ChamaManager*)   has_contracts=true ;;
            cadence/contracts/*)               has_contracts=true ;;
            cadence/transactions/*)            has_transactions=true ;;
            cadence/scripts/*)                 has_cadence_scripts=true ;;
            cadence/tests/*)                   has_cadence_tests=true ;;
            src/components/*)                  has_components=true ;;
            src/hooks/*)                       has_hooks=true ;;
            src/lib/*)                         has_lib=true ;;
            src/app/*)                         has_app=true ;;
            scripts/*)                         has_scripts=true ;;
            *.json|*.config.*|.env*|.gitignore|flow.json)
                                               has_config=true ;;
        esac
    done <<< "$all_files"

    local scopes=()
    $has_contracts       && scopes+=("contracts")
    $has_transactions    && scopes+=("transactions")
    $has_cadence_scripts && scopes+=("cadence-scripts")
    $has_cadence_tests   && scopes+=("tests")
    $has_components      && scopes+=("components")
    $has_hooks           && scopes+=("hooks")
    $has_lib             && scopes+=("lib")
    $has_app             && scopes+=("app")
    $has_scripts         && scopes+=("scripts")
    $has_config          && scopes+=("config")

    if [[ ${#scopes[@]} -eq 0 ]]; then
        echo "project"
    elif [[ ${#scopes[@]} -eq 1 ]]; then
        echo "${scopes[0]}"
    else
        local IFS=","
        echo "${scopes[*]}"
    fi
}

# ---------------------------------------------------------------------------
# Build a human-readable description of the changes
# ---------------------------------------------------------------------------
describe_changes() {
    local added="$1" modified="$2" deleted="$3"
    local all_files="$4"
    local desc=""

    # --- ChamaCircle contract ---
    if echo "$all_files" | grep -q "ChamaCircle"; then
        if echo "$added" | grep -q "ChamaCircle"; then
            desc="${desc:+$desc, }add ChamaCircle core savings circle contract"
        else
            desc="${desc:+$desc, }update ChamaCircle contract"
        fi
    fi

    # --- ChamaScheduler contract ---
    if echo "$all_files" | grep -q "ChamaScheduler"; then
        if echo "$added" | grep -q "ChamaScheduler"; then
            desc="${desc:+$desc, }add ChamaScheduler TransactionHandler"
        else
            desc="${desc:+$desc, }update ChamaScheduler"
        fi
    fi

    # --- ChamaManager contract ---
    if echo "$all_files" | grep -q "ChamaManager"; then
        if echo "$added" | grep -q "ChamaManager"; then
            desc="${desc:+$desc, }add ChamaManager registry"
        else
            desc="${desc:+$desc, }update ChamaManager"
        fi
    fi

    # --- Transactions ---
    if echo "$all_files" | grep -q "cadence/transactions/"; then
        local tx_files=$(echo "$all_files" | grep "cadence/transactions/" | xargs -I{} basename {} .cdc 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
        if echo "$added" | grep -q "cadence/transactions/"; then
            desc="${desc:+$desc, }add ${tx_files} transaction(s)"
        else
            desc="${desc:+$desc, }update ${tx_files} transaction(s)"
        fi
    fi

    # --- Cadence scripts ---
    if echo "$all_files" | grep -q "cadence/scripts/"; then
        if echo "$added" | grep -q "cadence/scripts/"; then
            desc="${desc:+$desc, }add Cadence query scripts"
        else
            desc="${desc:+$desc, }update Cadence scripts"
        fi
    fi

    # --- Cadence tests ---
    if echo "$all_files" | grep -q "cadence/tests/"; then
        if echo "$added" | grep -q "cadence/tests/"; then
            desc="${desc:+$desc, }add Cadence test suite"
        else
            desc="${desc:+$desc, }update Cadence tests"
        fi
    fi

    # --- React Components ---
    if echo "$all_files" | grep -q "src/components/"; then
        local comp_files=$(echo "$all_files" | grep "src/components/" | xargs -I{} basename {} .tsx 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
        if echo "$added" | grep -q "src/components/"; then
            desc="${desc:+$desc, }add ${comp_files} component(s)"
        else
            desc="${desc:+$desc, }update ${comp_files} component(s)"
        fi
    fi

    # --- Hooks ---
    if echo "$all_files" | grep -q "src/hooks/"; then
        if echo "$added" | grep -q "src/hooks/"; then
            desc="${desc:+$desc, }add React hooks for Flow integration"
        else
            desc="${desc:+$desc, }update hooks"
        fi
    fi

    # --- Lib (flow-config, storacha, receipt-service) ---
    if echo "$all_files" | grep -q "src/lib/"; then
        if echo "$added" | grep -q "src/lib/"; then
            desc="${desc:+$desc, }add Flow/Storacha client configuration"
        else
            desc="${desc:+$desc, }update lib configuration"
        fi
    fi

    # --- App pages ---
    if echo "$all_files" | grep -q "src/app/"; then
        if echo "$added" | grep -q "src/app/"; then
            desc="${desc:+$desc, }add Next.js pages"
        else
            desc="${desc:+$desc, }update app pages"
        fi
    fi

    # --- Dependencies ---
    if echo "$all_files" | grep -q "package\.json"; then
        desc="${desc:+$desc, }update dependencies"
    fi

    # --- Flow config ---
    if echo "$all_files" | grep -q "flow\.json"; then
        desc="${desc:+$desc, }update Flow project configuration"
    fi

    # --- Scripts ---
    if echo "$all_files" | grep -q "^scripts/"; then
        desc="${desc:+$desc, }update build/deploy scripts"
    fi

    # --- Deletions ---
    if [[ -n "$deleted" ]]; then
        local del_count=$(echo "$deleted" | wc -l | xargs)
        desc="${desc:+$desc, }remove $del_count file(s)"
    fi

    # Fallback
    if [[ -z "$desc" ]]; then
        local file_count=$(echo "$all_files" | wc -l | xargs)
        local first_file=$(echo "$all_files" | head -1 | xargs basename 2>/dev/null || echo "files")
        if [[ $file_count -eq 1 ]]; then
            desc="update $first_file"
        else
            desc="update $file_count files"
        fi
    fi

    echo "$desc"
}

# ---------------------------------------------------------------------------
# Main: generate full commit message
# ---------------------------------------------------------------------------
generate_commit_message() {
    local added=$(git diff --cached --name-only --diff-filter=A)
    local modified=$(git diff --cached --name-only --diff-filter=M)
    local deleted=$(git diff --cached --name-only --diff-filter=D)
    local all_files=$(git diff --cached --name-only)

    local type=$(detect_type "$added" "$modified" "$deleted")
    local scope=$(detect_scope "$all_files")
    local desc=$(describe_changes "$added" "$modified" "$deleted" "$all_files")

    echo "${type}(${scope}): ${desc}"
}

# ---------------------------------------------------------------------------
# Commit + push
# ---------------------------------------------------------------------------
do_commit() {
    cd "$REPO_ROOT" || { log "Failed to navigate to repo root"; return 1; }

    if [[ -z $(git status -s) ]]; then
        return 0
    fi

    log "Changes detected:"
    git status -s >> "$LOG_FILE"

    git add .

    local commit_msg=$(generate_commit_message)
    log "Commit: $commit_msg"

    git commit -m "$commit_msg"

    log "Pushing to origin/main..."
    if git push origin main 2>&1 | tee -a "$LOG_FILE"; then
        log "Pushed successfully."
    else
        log "Push failed."
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
case "${1:-}" in
    --once)
        log "Running single commit check..."
        do_commit
        ;;
    --watch|"")
        log "Auto-commit started (interval: ${INTERVAL}s)"
        while true; do
            do_commit
            sleep $INTERVAL
        done
        ;;
    --help)
        echo "Usage: $0 [--once|--watch|--help]"
        echo "  --once   Run once and exit"
        echo "  --watch  Run continuously (default)"
        echo "  --help   Show this help"
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use --help for usage"
        exit 1
        ;;
esac
