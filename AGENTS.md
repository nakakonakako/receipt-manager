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

When Codex CLI is acting as the supervisor, delegate bounded implementation
work to Cursor CLI with `scripts/delegate-cursor.sh`. These instructions describe
the supervisor's delegation process; they do not authorize Cursor, when acting
as the implementation worker, to invoke the delegation script or re-delegate.
Cursor must follow the repository rules above and the worker instructions in
`.cursor/rules/worker.mdc`.

Model tiers are fixed: `light` uses `composer-2.5`, `normal` uses
`grok-4.7-medium`, and `hard` uses `grok-4.7-high`. Use `normal` by default.
Do not use `fast`, `xhigh`, or other model families by default.

Codex must decide the design first for database/schema, auth/security, public
API contract, CI/CD, deployment, Docker/nginx, cross-repository, and undocumented
architecture work. Delegate only bounded implementation pieces after that
decision.

Use direct checkout for one worker when the checkout is clean and there are no
concurrent edits. Use `--worktree` for parallel workers, a dirty checkout,
concurrent edits, or a large/risky change that needs isolation.

If Cursor encounters a tooling/environment failure, fix the environment rather
than escalating the model. Retry an implementation difficulty at the next tier
after clarifying the work order; return hard-tier failures to Codex for further
investigation. Review high-risk work in Codex even after a successful worker run.
