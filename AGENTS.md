# receipt-manager

## Project source of truth

Before making non-trivial changes, read `docs/project-overview.md`.

When features, environment, architecture, dependencies, or data models change,
update `docs/project-overview.md` and the relevant `docs/spec-*.md`.

## Product boundary

This repository is Feature A: receipt / household expense management.

Responsibilities include:
- receipt and CSV expense recording
- searching and managing expenses
- Gemini-assisted OCR and categorization
- household expense visualization and Q&A

Do NOT introduce Feature B responsibilities here:
- strict unit-price comparison
- weight / volume based price comparison
- price trend comparison for manually selected products
- shopping memo functionality belonging to `price-memo`

`receipt-manager` must not depend on `price-memo`.

## Stack

Frontend:
- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase client

Backend:
- Python
- FastAPI
- Supabase
- Gemini / google-genai
- uv

## Verification

After implementation, run the standard quality check from the repository root as a rule:

    npm run check

If a quality check fails, fix the cause in the code rather than disabling the check or rule.
Run individual checks additionally when needed to investigate a failure.

## Database safety

Do not run:

    npm run db:push

unless the user explicitly requests a database push.

Prefer creating/reviewing migrations separately from applying them to a linked project.

## Implementation rules

- Never introduce TypeScript `any`.
- Follow existing architecture and naming before adding abstractions.
- Prefer small focused changes.
- Do not silently change API contracts.
- When changing an API contract, inspect both frontend and backend consumers.

## UI verification

When changing frontend UI:

- Verify the rendered application when the change can affect layout,
  responsive behavior, styling, or user interaction.
- Choose the most appropriate browser tool for the task.
- Do not use both Computer Use and Playwright unnecessarily.
- Prefer Playwright when DOM structure, element dimensions,
  overflow, responsive behavior, or deterministic interaction needs inspection.
- Prefer Computer Use when visual appearance or behavior is best judged
  from the rendered screen.
- Use both only when one tool alone is insufficient.
- For simple non-visual changes, browser verification is not required
  unless there is a specific reason.
- After fixing a visual or interaction bug, verify the affected screen
  before considering the task complete.
- When changing shared layout, form, or responsive styles,
  check other screens that reuse the affected component or CSS.

## Cursor worker delegation (Codex supervisor only)

### Supervisor escalation (Codex CLI)

Classify the request before broad repository investigation. For the escalation
triggers below, do only the minimum initial check needed to confirm the task
context, then delegate exactly one `sol_supervisor` subagent before design
decisions or implementation. Give it a concise handoff containing only:
`task`, `escalation reason`, `known facts`, and `required decision`.

Escalate early for:

- database schemas or migrations
- authentication, authorization, or security boundaries
- public API contract changes
- CI/CD or deployment
- Docker, nginx, or production infrastructure
- cross-repository changes
- undocumented architecture decisions
- complex bugs spanning multiple areas when the cause is unclear
- a Cursor `hard` implementation attempt that failed due to design or
  implementation difficulty and now needs redesign

Do not escalate routine UI/CSS, local bugs with an understood cause, normal
feature implementation, lint/test work, or small refactors to Sol. Keep those
on the Luna supervisor's normal routing path and delegate their bounded
implementation to Cursor under the rules below. "Handle those in the Luna
supervisor" means Luna owns classification, scope, routing, and review; it does
not mean Luna implements them herself.

The `sol_supervisor` is a design and investigation adviser. It returns evidence,
the required decision, tradeoffs, and a bounded implementation plan to the Luna
supervisor. It must not implement routine changes or spawn agents. The Luna
supervisor owns final decisions and delegates only the bounded implementation
work to Cursor with `scripts/delegate-cursor.sh`; keep the existing Cursor
worker rules and review its completion report and diff.

After a Sol handoff, do not start another Sol subagent for the same decision.
If the scope changes materially and a new independent high-risk decision arises,
the Luna supervisor may make a fresh escalation decision.

When Codex CLI is acting as Luna, Luna is the supervisor and Cursor is the
bounded implementation worker. Unless the user explicitly assigns
implementation to Luna or the task is delegation-infrastructure maintenance,
Luna must delegate bounded code implementation, UI fixes, bug fixes, test/lint
fixes, and small refactors to Cursor with `scripts/delegate-cursor.sh`.

Sol escalation and Cursor delegation are separate decisions: not escalating to
Sol does not route implementation to Luna. Routine UI/CSS, understood local
bugs, normal features, lint/test work, and small refactors need no Sol advice by
default, but their implementation still goes to Cursor.

Luna's direct work is primarily requirement clarification, initial
investigation and task classification, Sol escalation decisions, implementation
approach decisions, Cursor work-order preparation, review of Cursor's results
and diff, and maintenance of delegation infrastructure itself. Do not take
ordinary implementation over just because delegation takes setup or the
checkout is dirty.

Use the fixed tier mapping through the script, with `normal` by default:

- `light` -> `composer-2.5`
- `normal` -> `grok-4.7-medium`
- `hard` -> `grok-4.7-high`

Use direct checkout only when it is clean and there is no concurrent work. If
the checkout is dirty or isolation is needed, use `--worktree <name>` rather
than implementing directly in Luna. Do not use `--allow-dirty` as a shortcut;
it is only appropriate when mixing changes is intentional and explicitly
approved by the supervisor/user.

If Cursor CLI is unavailable, the delegate script is broken, or another tooling
failure prevents delegation, report the specific failure and repair the
environment or delegation infrastructure, then resume delegation. Do not
silently replace Cursor implementation with Luna implementation as a workaround.
An explicit user request for Luna to implement a task overrides this default.

These instructions describe the supervisor's delegation process; they do not
authorize Cursor, when acting as the implementation worker, to invoke the
delegation script or re-delegate. Cursor must follow the repository rules above
and the worker instructions in `.cursor/rules/worker.mdc`.

Model tiers are fixed: `light` uses `composer-2.5`, `normal` uses
`grok-4.7-medium`, and `hard` uses `grok-4.7-high`. Use `normal` by default.
Do not use `fast`, `xhigh`, or other model families by default.

For database/schema, auth/security, public API contract, CI/CD, deployment,
Docker/nginx, cross-repository, and undocumented architecture work, Sol advises
before design decisions, Luna makes the final design decision, and bounded
implementation is then delegated to Cursor as usual.

Use direct checkout for one worker when the checkout is clean and there are no
concurrent edits. Use `--worktree` for parallel workers, a dirty checkout,
concurrent edits, or a large/risky change that needs isolation.

If Cursor encounters a tooling/environment failure, fix the environment rather
than escalating the model. Retry an implementation difficulty at the next tier
after clarifying the work order. If a `hard` attempt still fails and redesign is
needed, use the Sol escalation above before another implementation attempt.
Review high-risk work in Codex even after a successful worker run.
