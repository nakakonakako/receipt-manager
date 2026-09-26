# Codex → Cursor delegation policy

## Roles

- **Codex CLI / Luna**: supervisor and router. Requirement clarification, initial investigation and classification, Sol escalation decisions, implementation approach and work-order decisions, delegation, and review.
- **Cursor CLI**: bounded implementation worker. Code edits, tests, browser verification, and completion report for assigned work orders.

## Default implementation routing

When Luna is acting as the Codex supervisor, bounded code implementation,
UI fixes, bug fixes, test/lint fixes, and small refactors go to Cursor by
default through `scripts/delegate-cursor.sh`. This applies whether or not Sol
escalation is needed. Routine UI/CSS, understood local bugs, normal features,
lint/test work, and small refactors do not need Sol advice by default, but their
implementation still goes to Cursor. Keeping them off the Sol path means Luna
retains supervisor ownership; it does not mean Luna implements them herself.

Luna primarily clarifies requirements, investigates enough to classify and
bound the task, decides whether Sol advice is needed, chooses the implementation
approach, writes the Cursor work order, and reviews the result and diff. Luna
may directly maintain the delegation infrastructure itself. An explicit user
request to have Luna implement a task overrides the default routing.

Use `normal` by default and select tiers through the delegation script:

| Tier | Model |
|---|---|
| `light` | `composer-2.5` |
| `normal` | `grok-4.7-medium` |
| `hard` | `grok-4.7-high` |

Do not take over implementation merely because the checkout is dirty. Use a
direct checkout only when it is clean and has no concurrent work; otherwise
use `--worktree <name>` to isolate Cursor's work. Do not use `--allow-dirty` as
a shortcut; use it only when mixing changes is intentional and approved.

If Cursor CLI is unavailable, the delegation script is broken, or another
tooling failure prevents delegation, report the concrete failure and repair
the environment or delegation infrastructure, then resume delegation. Do not
silently switch to Luna implementation because delegation is inconvenient.

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

After Luna's decision, bounded implementation pieces are delegated to Cursor
under the default routing rule above, unless the user explicitly assigns the
implementation to Luna or the work is delegation-infrastructure maintenance.

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

- Environment/tooling failure: report and repair the environment; do not escalate model just because setup failed.
- Cursor CLI or delegation-script failure: report the concrete failure, repair the environment or delegation infrastructure, then resume delegation; do not switch to Luna implementation as a shortcut.
- `light` struggles with implementation: retry as `normal`.
- `normal` struggles after a clarified work order: retry as `hard`.
- `hard` still cannot complete safely: return to Codex for deeper investigation/design.
- High-risk areas listed above should receive Codex review even if Cursor succeeds.
