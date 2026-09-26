#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/delegate-cursor.sh --tier <light|normal|hard> --task-file <path> [--worktree <name>]
  scripts/delegate-cursor.sh --tier <light|normal|hard> --prompt <text> [--worktree <name>]

Options:
  --tier        Cursor model tier. Default: normal
  --task-file   Read the work order from a file.
  --prompt      Pass the work order directly.
  --worktree    Run Cursor in an isolated Git worktree.
  --allow-dirty Allow direct execution in a dirty current checkout.
  -h, --help    Show this help.

Model mapping:
  light  -> composer-2.5
  normal -> grok-4.7-medium
  hard   -> grok-4.7-high
EOF
}

tier="normal"
task_file=""
prompt=""
worktree=""
allow_dirty=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier) tier="${2:?missing value for --tier}"; shift 2 ;;
    --task-file) task_file="${2:?missing value for --task-file}"; shift 2 ;;
    --prompt) prompt="${2:?missing value for --prompt}"; shift 2 ;;
    --worktree) worktree="${2:?missing value for --worktree}"; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$tier" in
  light)  model="composer-2.5" ;;
  normal) model="grok-4.7-medium" ;;
  hard)   model="grok-4.7-high" ;;
  *) echo "Invalid tier: $tier (expected light, normal, or hard)" >&2; exit 2 ;;
esac

if [[ -n "$task_file" && -n "$prompt" ]]; then
  echo "Use either --task-file or --prompt, not both." >&2
  exit 2
fi

if [[ -z "$task_file" && -z "$prompt" ]]; then
  echo "A work order is required via --task-file or --prompt." >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Not inside a Git repository." >&2
  exit 2
}
cd "$repo_root"

if [[ -n "$task_file" ]]; then
  if [[ ! -f "$task_file" ]]; then
    echo "Task file not found: $task_file" >&2
    exit 2
  fi
  work_order="$(cat "$task_file")"
else
  work_order="$prompt"
fi

if [[ -z "$worktree" && "$allow_dirty" -ne 1 && -n "$(git status --porcelain)" ]]; then
  cat >&2 <<'EOF'
Current checkout has uncommitted changes.
Refusing to run Cursor directly because its edits could mix with existing work.

Use one of:
  --worktree <name>   (recommended)
  --allow-dirty       (only when mixing changes is intentional)
EOF
  exit 3
fi

read -r -d '' supervisor_prefix <<'EOF' || true
You are a Cursor implementation worker delegated by a supervisor.

Follow AGENTS.md and the repository's .cursor rules.
Stay within the supplied work order.
Do not broaden scope or perform unrelated refactors.
If the task unexpectedly requires database/schema changes, auth/security changes,
public API contract changes, CI/CD or deployment changes, cross-repository changes,
or an undocumented architecture decision, stop that part and report it for supervisor review.

After implementation, run the repository-standard verification (normally `npm run check`).
For UI/browser behavior, use Playwright MCP when it materially verifies the acceptance criteria.

End with:
1. root cause / implementation intent
2. changed files
3. verification performed and results
4. remaining risks
5. supervisor decisions required
EOF

full_prompt="${supervisor_prefix}

WORK ORDER
==========
${work_order}"

cmd=(agent --model "$model")
if [[ -n "$worktree" ]]; then
  cmd+=(--worktree "$worktree")
fi
cmd+=(-p "$full_prompt")

echo "[delegate-cursor] repo: $repo_root" >&2
echo "[delegate-cursor] tier: $tier" >&2
echo "[delegate-cursor] model: $model" >&2
if [[ -n "$worktree" ]]; then
  echo "[delegate-cursor] worktree: $worktree" >&2
else
  echo "[delegate-cursor] worktree: direct checkout" >&2
fi

exec "${cmd[@]}"
