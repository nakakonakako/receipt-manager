# Worktree and environment workflow

## Standard locations

- Main checkout: `~/web/receipt-manager`
- Additional worktrees: `~/worktrees/receipt-manager/<task-name>`
- Local environment files: `~/.config/receipt-manager/<environment>/`

Existing worktrees under `/tmp`, `~/.cursor/worktrees`, and `~/web` are left in
place. Do not migrate or remove them automatically.

## Commands

```bash
scripts/worktree.sh list
scripts/worktree.sh create <task-name> --branch <branch-name> --base origin/main
scripts/worktree.sh reuse <path>
scripts/worktree.sh setup <path> --environment development
scripts/worktree.sh remove <path>
```

## Starting Codex

Install the repository's external Codex launcher after updating the normal
checkout:

```bash
scripts/install-codex-launcher.sh
receipt-manager-codex
```

Use this command for every new Codex session in this repository. Before Codex
starts, the launcher fetches `origin/main`, creates a uniquely named worktree
from the fetched commit under `~/worktrees/receipt-manager/`, verifies its HEAD
and clean state, and starts Codex with that worktree as its working directory.
It never updates or reuses the normal checkout or an existing feature worktree.
Fetch, GitHub access, or verification failures stop startup. The launcher is
installed as a file copy under `~/.local/bin`, so reinstall it after pulling
launcher changes. Worktrees created for sessions are preserved; remove one only
through the documented explicit `scripts/worktree.sh remove <path>` flow after
reviewing its state.

This guarantee covers only new sessions started with `receipt-manager-codex`.
Direct `codex` invocations, IDE-managed starts, API starts, and resumed sessions
bypass the repository launcher and must not be assumed to have fresh
instructions. The launcher verifies freshness at successful fetch time; a
later push to GitHub does not change an already running session.

`create` creates a Git worktree under the standard directory and runs dependency
and environment setup. When it creates a **new** branch with the default base
`origin/main` (exactly that ref, including the implicit default), it first
completes existing-worktree and in-use-branch checks, then fetches
`refs/heads/main` into `refs/remotes/origin/main`, verifies
`origin/main^{commit}`, and only then runs `git worktree add`. Fetch failure,
a missing refspec, or an invalid commit stops without creating a worktree or
branch; there is no fallback to a stale local `origin/main` or the current
branch. Explicit `--base main`, any other `--base` ref, checkout of an existing
local branch, and `reuse` do not fetch or reset anything.

If its branch is already checked out elsewhere, the command displays the
worktree list and stops; inspect that worktree and pass its path to `reuse`.
`reuse` displays the branch, status, staged/unstaged summaries, and untracked
paths before running setup. It preserves all existing changes.

Setup installs dependencies from the root and frontend lockfiles, ensures a
managed `backend/.venv` (relocation detection, safe repair, and `uvicorn`
verification; see [spec-worktree-runtime.md](./spec-worktree-runtime.md)), and
creates absolute symlinks for configured `.env`,
`frontend/.env`, `frontend/.env.local`, and `backend/.env` files. The source
files must be regular files under `~/.config/receipt-manager/<environment>/`
with the same relative paths.
Missing sources are skipped during worktree setup. Existing target files or
conflicting links are never replaced. Environment values are never printed or
copied into Git.

The standard setup intentionally excludes `.env.ai-quota`,
`secrets/ai-quota-ca/`, `service_account.json`, and production settings. These
may contain database credentials or other sensitive material. A symlink does
not hide its target from a trusted Cursor workspace; configure only development
credentials needed for the task and do not link production credentials into a
worker workspace.

Before dependency setup, worktree setup validates existing environment paths
against the selected `~/.config/receipt-manager/<environment>/` directory.
Missing managed links are allowed at this stage so a new worktree can proceed
to dependency setup and link creation. Invalid existing paths stop setup
before npm or backend environment preparation. Validation runs through
`scripts/worktree-env-validate.py` in `pre` mode. Manual worktree commands retain
their selected `--environment`; Cursor delegation explicitly uses `development`.
After setup, strict validation requires every present managed source to have an
absolute symlink whose direct `readlink` target exactly matches the selected
source path, and every absent source to have no target. Links accepted only
because `Path.resolve()` reaches the same file are not valid managed links;
relative and indirect links are rejected. Before starting Cursor,
`delegate-cursor.sh` runs the same validator in `strict` mode against
`~/.config/receipt-manager/development/`. `worktree.sh validate-env <path>`
defaults to development and also accepts an explicit `--environment <name>`.
Each of
the four managed paths above must either be absent both in the development
settings and workspace, or be a symlink to the exact development settings
file. Broken links, links to another environment, regular files at managed
paths, stale links whose source is missing, and other `.env*` paths in the
workspace stop delegation. The check reads path metadata and symlink targets
only; it does not read environment file contents, replace, delete, or repair
anything. Symlinks and non-directories in the configured settings path or
dotenv lookup directory chain are rejected. It also rejects unexpected
`.env*` paths in the repository root, frontend, backend, `backend/app`, and
`backend/app/services`, matching receipt-manager's Python dotenv lookup scope.
Resolve any reported path manually, then retry delegation.

## Initial environment migration and daily startup

The one-time migration reads only file metadata and variable names during its
preview. It checks `~/web/receipt-manager/.env`, `frontend/.env`,
`frontend/.env.local`, and `backend/.env`, and shows each destination and any
existing-destination conflict without displaying values:

```bash
bash scripts/dev-env.sh migrate --preview
bash scripts/dev-env.sh migrate --apply frontend/.env
```

Pass only files reviewed as development-only credentials. The command asks for
an explicit `copy` confirmation, copies selected files to new destinations
with mode `0600` inside mode `0700` directories, and retains source files. It
never overwrites a destination. A `frontend/.env.local` value that overlaps a
key in `frontend/.env` is reported by key name and blocks startup until the
override is resolved. Do not place production credentials in this shared
directory: Cursor workers with trusted access to a linked workspace can read
the linked files. `.env.ai-quota`, its CA files, and service account files are
excluded from migration and worktree links.

Root `npm run dev` runs the ordinary human development pair after environment
preflight: Vite `5174` proxies `/api` to FastAPI `8000`. It keeps the existing
fixed-port, strict conflict handling and starts only process groups owned by
that invocation.

## Official Cursor browser verification path

The Codex supervisor plans UI verification and delegates implementation and
browser checks to a Cursor worker. The worker prepares the selected worktree,
starts/reuses its isolated browser pair, chooses an MCP for the page's auth
state, verifies the UI at `http://localhost:5274/`, reports evidence to the
supervisor, and stops the servers it owns:

```bash
npm run devserver:ensure
npm run devserver:status
npm run devserver:stop
```

The Cursor pair uses Vite `5274` with an explicit proxy to FastAPI `8100`; the
human pair remains `5174` → `8000`. Both are fixed with strict ports. A port
collision, unknown owner, mismatched configuration, or server belonging to a
different worktree is an error; ports are never changed automatically. Ensure
reuses only a verified session for the same canonical worktree and current
approved Dev Supabase configuration. Stop signals only process groups whose
PID, start time, session/group IDs, private launch marker, cwd, and listener
ownership still match its private state record. State is stored under
`~/.local/state/receipt-manager/cursor-devserver/` with restrictive directory
and file permissions. Do not edit or delete state records to bypass ownership
checks. The startup preflight reuses the existing Dev Supabase guard and does
not connect to hosted databases.

The official MCP servers in `.cursor/mcp.json` are deliberately separate:

- `playwright` is headed Chromium for authenticated UI checks. Its shared
  persistent profile is `~/.local/state/receipt-manager/playwright-profile`;
  every worktree uses this exact profile. Chromium permits only one browser to
  open it at a time. Never clear, copy, inspect, export, or log its contents.
  Do not automate Google OAuth. A person must sign in through the visible browser
  the first time.
- `playwright-unauth` is headless and starts with `--isolated`; it does not use
  the persistent profile or load storage state. Use it for pre-login screens.

Both launchers pin `@playwright/mcp@0.0.83`, Playwright
`1.64.0-alpha-1790635538000`, and Chromium revision `1247`. They install the
matching browser into `~/.cache/ms-playwright` if absent. The authenticated
launcher is headed so the initial human sign-in can be completed in its GUI.

For first use, inspect `.cursor/mcp.json`, then explicitly approve only the MCP
needed for that task from the target worktree, for example
`agent mcp enable playwright` or `agent mcp enable playwright-unauth`. Use
`agent mcp list` and `agent mcp list-tools <server-name>` to diagnose discovery.
Never pass `--approve-mcps`; it approves every configured MCP. After approval,
run `npm run devserver:ensure`, navigate to `http://localhost:5274/`, and set
desktop and mobile viewport sizes in the MCP. Then report observations and run
`npm run devserver:stop` for the owned pair. Do not start a second MCP browser
against the authenticated profile while one is open, including from another
worktree.

`frontend/src/components/Auth.tsx` uses the current browser origin for the
Supabase Auth redirect target. A human administrator must allow
`http://localhost:5274/` in the Dev Supabase Auth redirect URL configuration
before completing OAuth from the verification origin. This repository does not
change hosted Auth settings. The OAuth provider callback remains the Supabase
callback URL.

`remove` only accepts a clean, registered worktree below
`~/worktrees/receipt-manager/`, prompts for the literal word `remove`, and uses
non-forced `git worktree remove`. It does not delete the branch. Check for active
workers and development servers first. It never runs automatically after a PR
is merged. The shared v1 acceptance conditions and test mapping are documented
in [worktree-remove-contract.md](./worktree-remove-contract.md).

Before showing the confirmation prompt and again immediately before removing,
the command scans Linux `/proc` for live processes whose canonical current
working directory is the target worktree or one of its subdirectories. A match
prints the PID and asks you to stop that process yourself before retrying. The
guard never kills processes. A `/proc` enumeration error or unreadable process
identity for a current-user PID refuses removal with a reason and a retry hint.
Zombie processes are ignored. For a readable cwd, the guard compares process
start time before and after reading cwd; for an unreadable cwd, it also
rechecks PID/start-time identity before skipping it. A changed identity or an
exited process is not attributed to the old PID. A matching identity with an
unreadable cwd still cannot establish whether that process uses the target
worktree, so the current policy skips it rather than assuming it belongs to
the target. A failed stat recheck refuses removal. The final scan narrows the
race where a process starts while the confirmation prompt is open; a process
could still start in the small interval between that scan and Git removing the
worktree.

The scan depends on Linux `/proc`. Processes that move their working directory
out of the worktree, or whose cwd cannot be read, may not be detected. Start
time identifies the sampled process but cannot reveal its worktree relationship
when cwd access fails. A same-user PID whose stat identity or `/proc`
enumeration cannot be read blocks removal. A race also remains after the final
scan and before Git removes the worktree. If removal is refused, inspect the
listed PID locally (for example with `ps`), stop the relevant development
server or worker, then run `scripts/worktree.sh remove <path>` again. The guard
does not print process command lines or environment values.

## Cursor delegation

`scripts/delegate-cursor.sh --worktree <task-name>` creates or reuses the
standard Git worktree and invokes Cursor with `--workspace <absolute-path>`.
Freshness of `origin/main` for new branches is handled only by
`scripts/worktree.sh create` (default `--base origin/main`); the delegate script
does not fetch. Existing worktrees are reused without fetch or branch changes.
Use `--workspace <path>` to continue work in a listed worktree. Cursor's own
`--worktree` option is not used because it controls a separate storage root.

`npm run dev` starts the human services with the receipt-manager frontend on
`5174`, supervised backend on `8000`, and explicit port-conflict handling.
`npm run devserver:ensure|status|stop` manages the separate Cursor pair on
`5274` and `8100`. Worktree setup does not start or stop services or apply
database migrations.

### Playwright MCP setup, troubleshooting, and updates

The first launch downloads the pinned MCP package and, when necessary, its
matching Chromium build; npm registry access is required. Browser binaries are
shared in `~/.cache/ms-playwright`, while only the authenticated profile is
persistent. Never inspect or remove profile contents as troubleshooting. If a
launcher fails, use `agent mcp list` and `agent mcp list-tools <server-name>`,
check the safe error output for package/network issues, and retry only after
repairing the cause. Do not broaden Shell/MCP permissions or use
`--approve-mcps`.

When changing pins, inspect the selected `@playwright/mcp` release's exact
Playwright dependency and `browsers.json`, then update both launchers together.
Run `bash scripts/test-playwright-mcp.sh` and `npm run check`. For actual UI
verification, use the official two-MCP route above and confirm the rendered
screen and desktop/mobile viewports. The persistent profile can be held by only
one browser process at a time.

## Development database migration plan

`shared-supabase-db` owns the migration inventory and Dev DB history. Its
Reader-only manual workflow is the official way to review pending migrations:
[Dev migration plan](https://github.com/nakakonakako/shared-supabase-db/actions/workflows/dev-migration-plan.yml).

`npm run db:plan` prints this link and states clearly that no Dev DB history was
checked. `npm run db:list` lists files in this receipt-manager checkout only;
it does not represent the shared inventory or Dev DB history. Neither command
reads DB credentials, invokes Supabase CLI, or accesses a hosted DB:

```bash
npm run db:plan
```

The legacy local `npm run db:push` command is disabled and exits before
loading DB environment, prompting for credentials, or invoking Supabase CLI.
Shared-supabase-db owns Dev migration inventory and history, uses its Reader
workflow for plan checks, and its protected Writer workflow to apply migrations.
Receipt-manager owns application development and DB contract verification. The
production deployment workflow remains unchanged.

Disabling this script closes only the repository's legacy command path. It does
not revoke or rotate credentials that may already exist on a developer machine;
a valid database password can still be used with the Supabase CLI directly or
another database client. Credential rotation/revocation is a separate
operational step.

Details and safety constraints: [spec-worktree-runtime.md](./spec-worktree-runtime.md).
