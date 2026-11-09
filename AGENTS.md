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

Do not run `npm run db:push`. The command is disabled and exits before
environment preparation, password prompts, or Supabase CLI calls. It does not
connect to a hosted database or apply migrations.

shared-supabase-db owns the hosted migration inventory and Dev/Prod Writer
application. receipt-manager owns application development and DB contract
verification. Its legacy production apply and one-time Reader bootstrap
workflows are removed. Do not apply migrations to a linked hosted project from
this repository. New hosted migrations belong in shared-supabase-db and require
separate approval there. Production app deployment runs only the pinned shared
Reader gate and read-only integrity checks, and never applies migrations.

Use `npm run db:plan` to find the official Reader-only migration plan workflow:
https://github.com/nakakonakako/shared-supabase-db/actions/workflows/dev-migration-plan.yml
The local command does not query the Dev database and must not be described as
a successful history check. `npm run db:list` lists receipt-manager's local
migration files only. shared-supabase-db's Reader workflow is the official Dev
migration plan check, and its protected Writer workflows own Dev and Prod
migration application. Dev and Prod Reader checks, and Writer credential
read-only connection identity probes, have succeeded. Actual Dev and Prod
PENDING migration apply remains unverified. A Dev `IN_SYNC` no-op is not proof
that apply works. `DEV_DB_WRITER_ENABLED` and `PROD_DB_WRITER_ENABLED` stay
false until a separately approved apply.

Keep the existing receipt-manager Production Writer Secret until shared
Production PENDING apply, Reader postflight, both apps' DB compatibility and
production deployment success, and an audit confirming no old Writer reference
paths. Deletion still requires separate approval. Do not print credential
values. Disabling `db:push` does not delete that retained Secret. The Dev
database password has been rotated and the old local Writer password removed.

## Git worktree and environment files

- The normal checkout is `~/web/receipt-manager`; additional worktrees belong
  under `~/worktrees/receipt-manager/<task-name>`.
- Create, list, inspect/reuse, and remove worktrees with `scripts/worktree.sh`.
  Run `scripts/worktree.sh list` before creating a worktree for an existing
  branch. If that branch is already checked out, inspect the listed worktree
  and reuse it; never force a second checkout.
- Create new worktrees with an explicit branch and base, for example
  `scripts/worktree.sh create <task> --branch <branch> --base origin/main`.
  Reuse an existing path with `scripts/worktree.sh reuse <path>`.
- Managed environment links must be direct absolute symlinks to the exact
  configured source path. Setup validates them before dependencies, after link
  creation, and again before Cursor starts; see `docs/worktree-development.md`.
- Development environment files stay outside Git under
  `~/.config/receipt-manager/<environment>/` and are linked into worktrees by
  the setup command. For initial migration from `~/web/receipt-manager`, first
  run `bash scripts/dev-env.sh migrate --preview`, then explicitly select only
  reviewed development files with `migrate --apply <relative-file> [...]`.
  Migration copies into new mode-0600 files under mode-0700 directories,
  retains every source, and never prints values or replaces a destination.
  Existing `.env.local` files and Vite key overlaps are reported by name only.
  Daily `npm run dev` validates required Supabase settings and checks the
  effective frontend and backend URLs against the approved development project
  ref; ambiguous URL overrides fail closed. It checks backend `uvicorn` when
  `backend/.venv` is present without running `npm ci` or `uv sync` when healthy,
  and prepares missing links without replacing local
  files. It checks the configured Vite/API ports before launch and supervises
  only the process groups it starts; occupied ports are never reassigned or
  killed.
  Worktree setup manages `backend/.venv` with relocation detection and safe
  repair; see `docs/spec-worktree-runtime.md`.
  The allowed development Supabase project ref is fixed in
  `scripts/supabase-target.py`. `npm run db:plan` links to the shared Reader-only
  workflow and explicitly reports that it did not check Dev DB history.
  `npm run db:list` shows local receipt-manager files only and links to the same
  workflow for the official inventory/history. Neither command reads DB
  credentials, prepares Supabase CLI state, or connects remotely. The legacy
  local `npm run db:push` exits before environment preparation or any Supabase
  CLI call. shared-supabase-db owns the hosted migration inventory, Reader plan
  checks, and protected Dev/Prod Writer application. receipt-manager owns app
  development and DB contract verification. Its legacy production apply and
  Reader bootstrap paths are removed. Production deployment uses the pinned
  shared Reader gate and read-only integrity checks, and never applies
  migrations. Dev/Prod Reader checks and Writer credential read-only identity
  probes have succeeded. PENDING migration apply remains unverified, and a Dev
  `IN_SYNC` no-op is not apply proof. Outside these explicit DB commands, setup,
  `npm run dev`, and `npm run check` do not link to Supabase or access a remote
  database.
  A symlink makes its target readable to any worker trusted with that workspace,
  so provide only the development credentials required by the task.
- `.env.ai-quota`, `secrets/ai-quota-ca/`, `service_account.json`, and
  production settings are excluded from the standard setup. Do not link these
  into worker workspaces.
- `scripts/worktree.sh remove <path>` is an explicit, interactive operation for
  clean worktrees under `~/worktrees/receipt-manager/`. It never forces removal
  or deletes the branch. Check for active workers and development servers
  first. Worktrees under `/tmp`, `~/.cursor/worktrees`, or `~/web` are not
  migrated or removed automatically.
- Use `scripts/delegate-cursor.sh --worktree <task>` to create/reuse the
  standard worktree, or `--workspace <path>` to reuse an existing one. Cursor
  receives `--workspace`; do not use Cursor's own `--worktree` location.
  New branches based on `origin/main` fetch and validate the remote ref in
  `scripts/worktree.sh create`; failed fetches stop creation instead of falling
  back to a stale ref. Explicit bases and existing local branches do not fetch.
  Existing worktrees are reused without fetching or changing their branch.

## Implementation rules

- Never introduce TypeScript `any`.
- Follow existing architecture and naming before adding abstractions.
- Prefer small focused changes.
- Do not silently change API contracts.
- When changing an API contract, inspect both frontend and backend consumers.

## Commit subjects

- Follow Conventional Commits format: `<type>: <変更内容>`.
- Use lowercase English types and concise Japanese descriptions.
- Do not include custom task or phase identifiers.
- Do not rewrite existing commit history.

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
- The official Cursor browser path is: Codex supervisor plans and delegates;
  Cursor worker runs `npm run devserver:ensure`, chooses `playwright` for
  authenticated screens or `playwright-unauth` for pre-login screens, verifies
  `http://localhost:5274/` on desktop and mobile viewports, reports evidence,
  and runs `npm run devserver:stop` for its owned servers. Details are in
  `docs/worktree-development.md`.
- The authenticated MCP uses the shared
  `~/.local/state/receipt-manager/playwright-profile`; only one browser may
  open it at once. Do not inspect, copy, reset, or log profile/auth state and do
  not automate Google OAuth. The unauthenticated MCP uses `--isolated` and
  must not read saved auth state.
- For manual login, use the actual authenticated MCP browser window; opening
  the URL in a normal browser uses a different profile. A snapshot or a
  running MCP does not prove the human can see or operate its window. Do not
  report readiness until the human confirms both. The default mode is headless;
  select GUI explicitly for manual login. Fully stop the owning MCP and browser
  before switching modes. After manual login, select headless, fully restart
  the MCP browser, and verify the authenticated screen again. Follow
  the Codex/Cursor and WSLg procedure in `docs/worktree-development.md`; if
  visibility or persistence cannot be confirmed, report it as unconfirmed.
- Approve only the MCP needed for the task in `.cursor/mcp.json`. Never use
  `--approve-mcps` to approve all servers.

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
on the Luna supervisor's normal routing path. "Handle those in the Luna
supervisor" means Luna owns classification, scope, routing, and review.

The `sol_supervisor` is a design and investigation adviser. It returns evidence,
the required decision, tradeoffs, and a bounded implementation plan to the Luna
supervisor. It must not implement changes or spawn agents. Luna owns the final
design decision. Sol review is mandatory before design decisions and before
implementation for every escalation trigger above, including when Luna
implements that work directly.

After a Sol handoff, do not start another Sol subagent for the same decision.
If the scope changes materially and a new independent high-risk decision arises,
the Luna supervisor may make a fresh escalation decision.

### Implementation ownership

When Codex CLI is acting as Luna, Luna is the supervisor. Cursor is the default
implementation owner for ordinary UI/UX, features, localized bugs, routine
test/lint fixes, and other bounded work with independently verifiable
completion criteria. Luna classifies and routes that work, provides design and
supervision, prepares the work order, and reviews Cursor's completion report
and diff.

Delegate that default work with `scripts/delegate-cursor.sh`. Sol escalation
and implementation ownership are separate decisions: not escalating to Sol does
not route implementation to Luna. Routine UI/CSS, understood local bugs, normal
features, lint/test work, and small refactors need no Sol advice by default,
and Cursor still implements them.

Luna may implement directly when the work is high-risk or spans multiple areas
and needs repeated short implementation and verification cycles, or when Cursor
delegation is clearly less efficient for that task. State the concrete reason.
Dirty checkout or delegation setup overhead alone is not a sufficient reason.
Luna also implements directly when the user explicitly assigns the
implementation to Luna, and when maintaining the delegation infrastructure
itself.

Do not take ordinary implementation over just because delegation takes setup or
the checkout is dirty. If Cursor CLI is unavailable, the delegate script is
broken, or another tooling failure prevents delegation, report the concrete
failure. Follow the execution-environment policy below before any repair or
retry. Do one bounded repair only when it addresses the observed cause;
otherwise stop and report an approved alternative environment. Luna may take
over only if the independent direct-implementation conditions above are met.
Tooling failure alone does not justify takeover, skipping Sol review or quality
checks, or changing the model family.

### Execution environment and approval policy

Before every delegation, inspect the execution tools and argument schemas
available in the current session, plus its actual sandbox, network, and approval
state. Use network access normally when already allowed; request only a
currently supported limited approval when network access is blocked. If that
approval is unavailable or denied, stop and report an approved alternative
environment. Never enable `danger-full-access` automatically or assume tool
names or arguments from another session. Classify network, authentication, MCP,
execution-tool, and approval-policy failures separately. Environment failures
do not justify model changes or repeated retries. Follow the decision table in
[docs/cursor-delegation.md](docs/cursor-delegation.md#execution-tools-network-access-and-approval-policy).

Quality checks, security review, tests, final diff review, and Git/worktree
safety apply regardless of who implements.

These instructions describe the supervisor's delegation process; they do not
authorize Cursor, when acting as the implementation worker, to invoke the
delegation script or re-delegate. Cursor must follow the repository rules above
and the worker instructions in `.cursor/rules/worker.mdc`.

### Cursor tiers, checkout, and retries

Use the fixed tier mapping through the script, with `light` by default:

- `light` -> `composer-2.5`
- `normal` -> `grok-4.7-medium`
- `hard` -> `grok-4.7-high`

For an explicitly supervisor-approved Other Models route, use only:

- `--fallback-tier light` -> `gemini-3.8-flash-low`
- `--fallback-tier normal` -> `claude-sonnet-5-5-medium`
- `--model-override gpt-5.6-luna-medium` -> reserve candidate

These options are mutually exclusive with `--tier` and with each other.
When the monitor reports `cursor_usage_exhausted`, stop Cursor retries and
announce that the current Codex Supervisor is taking over because the CLI usage
limit was confirmed. Inspect `git status --short`, `git diff --cached`,
`git diff`, and untracked paths before working; preserve all existing staged,
unstaged and untracked changes. Continue in the same worker worktree, without
reset, clean, stash or removal. Do not launch another Codex process or switch
models. Implement, run the normal quality checks, verify affected UI in a real
browser, and perform the final review under the same criteria as a Cursor worker.
For UI checks use the existing project Playwright MCP launcher and devserver
helper if available, with the dedicated verification port, one authenticated
profile user at a time, no credential inspection or OAuth automation, and stop
only servers owned by the session. If browser operation is unavailable, report
UI behavior as UNCONFIRMED with the cause and required setup; never claim PASS.
The monitor recognizes the observed `ActionRequiredError` usage message only on
failure, after ANSI removal. It does not infer quota from `resource_exhausted`,
capacity, network, authentication, MCP, or implementation failures. The
structured quota error format is unverified. Other Models options remain
explicit and are never selected automatically.

Implementation-difficulty escalation remains `light` → `normal` → `hard` after
clarifying the work order. If a `hard` attempt still needs a design change,
escalate to Sol; this is separate from an explicit Other Models route decision.
The monitor must report the selected `route`, `tier`, and `model`. Model IDs
remain account/team/CLI dependent; do not claim current account availability
without checking an authorized model catalog. Explicit third-party routes may
have different billing treatment; do not change account billing settings.

Do not use `fast`, `xhigh`, or other model families by default. Do not change
the model family as a workaround for an environment or tooling failure. For
environment failures, follow the execution-environment policy above. For
implementation difficulty, clarify the work order and follow the tier sequence
below. If Luna's independent direct-implementation conditions are met, follow
that route instead.

Use direct checkout only when one worker is running, the checkout is clean, and
there is no concurrent work. Use `scripts/delegate-cursor.sh --worktree <task>`
or create a standard worktree and pass it through `--workspace <path>` when
workers run in parallel, the checkout is dirty, edits are concurrent, or a
large or risky change needs isolation. Do not use `--allow-dirty` as a shortcut;
it is only appropriate when mixing changes is intentional and explicitly
approved by the supervisor or user.

Before delegation, fetch `origin/main` and verify the launcher checkout. A
launcher started from branch `main` stops if its HEAD is older than, diverged
from, or cannot be compared with the local `origin/main` commit. It never
fetches or updates a checkout itself. If the ordinary checkout is behind, run
the launcher from a dedicated worktree based on the fetched `origin/main`;
never update the ordinary checkout as part of delegation. Feature branches and
detached historical checkouts are not rejected just because their HEAD differs
from `origin/main`. The launcher reports the source checkout, branch, HEAD,
baseline ref and SHA, Worker workspace, and monitor path/checkout. This check
cannot protect against invoking an older launcher that predates the check; the
Supervisor must perform the fetch and choose the launcher checkout before
starting it. See [the detailed freshness procedure](docs/cursor-delegation.md#launcher-checkout-freshness-and-provenance).

If an implementation attempt is unproductive, clarify the work order and retry
at the next tier. Do not repeat unproductive retries at the same tier. If a
`hard` attempt still fails and redesign is needed, use the Sol escalation above
before another implementation attempt. Review high-risk work in Codex even
after a successful worker run.
