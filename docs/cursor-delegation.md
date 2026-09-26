# Codex → Cursor delegation policy

## Roles

- **Codex CLI**: supervisor. Requirements, task decomposition, architecture decisions, escalation handling, and selective review.
- **Cursor CLI**: implementation worker. Investigation, code edits, tests, browser verification, and completion report.

## Cursor model tiers

| Tier | Model | Typical work |
|---|---|---|
| `light` | `composer-2.5` | CSS tweaks, lint fixes, docs, simple tests, small local edits |
| `normal` | `grok-4.7-medium` | Default. Normal feature work, multi-file fixes, ordinary bug investigation |
| `hard` | `grok-4.7-high` | Complex bugs, larger refactors, broad implementation work |

Use `normal` by default. Do not use xhigh/fast models by default.

## Supervisor-only / supervisor-first areas

Codex should make the design decision before implementation when work involves:

- database schema or migrations
- authentication / authorization / security boundaries
- public API contract changes
- CI/CD, Docker, nginx, deployment, or production infrastructure
- cross-repository changes
- product-boundary or undocumented architecture decisions

After the decision, bounded implementation pieces may still be delegated to Cursor.

## Worktree policy

Do **not** use a worktree for every task.

Use direct checkout when:
- one Cursor worker is running
- the checkout is clean
- no concurrent implementation is touching the same repo

Use `--worktree` when:
- multiple Cursor workers run in parallel
- Codex or the user is concurrently editing the repo
- the current checkout has uncommitted work that should be isolated
- a risky/large implementation should be kept separate until reviewed

## Retry / escalation

- Environment/tooling failure: fix the environment; do not escalate model just because setup failed.
- `light` struggles with implementation: retry as `normal`.
- `normal` struggles after a clarified work order: retry as `hard`.
- `hard` still cannot complete safely: return to Codex for deeper investigation/design.
- High-risk areas listed above should receive Codex review even if Cursor succeeds.
