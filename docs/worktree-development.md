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

Before starting Cursor, `delegate-cursor.sh` validates the workspace's
environment paths against `~/.config/receipt-manager/development/`. Each of
the four managed paths above must either be absent both in the development
settings and workspace, or be a symlink to the exact development settings
file. Broken links, links to another environment, regular files at managed
paths, stale links whose source is missing, and other `.env*` paths in the
workspace stop delegation. The check reads path metadata and symlink targets
only; it does not read environment file contents, replace, delete, or repair
anything. It also rejects unexpected `.env*` paths in the repository root,
frontend, backend, and the backend dotenv lookup directories. Resolve any
reported path manually, then retry delegation.

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

Root `npm run dev` runs a lightweight environment preflight before starting.
It prepares missing symlinks, validates the frontend Supabase settings,
checks that the backend runtime can run `uvicorn` without reinstalling when
healthy, refuses conflicting local files, and does not install or sync
dependencies when checks pass.
The ordinary Vite server is fixed to `5174` with `strictPort` so it can run
alongside price-memo on `5173`. The Playwright MCP configured in `.cursor/mcp.json` provides browser
automation; it does not start a separate receipt-manager Vite server. The
checked-in `.cursor/playwright-mcp.sh` pins `@playwright/mcp@0.0.83` and its
exact `playwright@1.64.0-alpha-1790635538000` dependency, and installs Chromium
revision `1247` from the matching Playwright package into
`~/.cache/ms-playwright` on first launch. It runs Chromium headless so the MCP
does not depend on a WSL display server. Node.js 20 or newer is recommended by
the current Playwright MCP setup guide; the pinned package declares Node.js 18
or newer.

The browser uses Playwright MCP's default persistent profile. On Linux this is
stored under `~/.cache/ms-playwright-mcp/` and keyed by browser channel and the
MCP client's workspace path, so each worktree is expected to retain a separate
login session. The profile persists cookies and local storage. Never delete,
reset, copy, or commit profile data as routine troubleshooting. A profile can
only be open in one browser at a time; run MCP checks sequentially within a
worktree. Separate worktrees can use their separate profiles concurrently, but
a login in one worktree is not shared with another. Complete any required
development login manually; do not automate Google/OAuth authentication.

For first use, open the repository/worktree in Cursor and check MCP discovery
with `agent mcp list` and tool availability with `agent mcp list-tools
playwright`. On first use, inspect `.cursor/mcp.json` and explicitly enable only
this server with `agent mcp enable playwright`; this records the server in the
local Cursor CLI approved list. Project CLI permissions allow only
`Mcp(playwright:*)`; do not use `--approve-mcps`, which auto-approves every
configured MCP server. Then start the application
with `npm run dev` and use the MCP to open `http://localhost:5174/`. Use the
browser tools to inspect the DOM and set desktop and mobile viewport sizes.
Vite proxies `/api` requests to the supervised FastAPI server on `8000`. This
repository does not define a separate Playwright port or additional npm
command. If Tailscale
Serve forwards to the receipt-manager development server, verify its local
target and update it from `5173` to `5174` when needed; this repository change
does not alter the machine's Tailscale configuration.
Before `npm run dev` starts, an owned-process supervisor checks frontend `5174`
and backend `8000`. Occupied ports stop startup with listener PID, command, and
working directory where available; ports are never reassigned and existing
owners are never stopped. The supervisor runs each server in its own session and
stops only the isolated process groups started by that command on Ctrl+C,
SIGTERM, or startup failure. It confirms group exit after SIGTERM and, when
needed, after SIGKILL. If ownership or exit cannot be confirmed, or `/proc`
inspection fails, cleanup reports an error and returns a failure status.
Shutdown releases the ports for a later run when cleanup succeeds.

`frontend/src/components/Auth.tsx` sends the browser's current origin as the
Supabase Auth redirect target. For local receipt-manager development, verify
that `http://localhost:5174/` is allowed in the Supabase Auth redirect URL
configuration. The Google OAuth provider callback URL remains the Supabase
callback URL and is separate from this application redirect target.

`remove` only accepts a clean, registered worktree below
`~/worktrees/receipt-manager/`, prompts for the literal word `remove`, and uses
non-forced `git worktree remove`. It does not delete the branch. Check for active
workers and development servers first. It never runs automatically after a PR
is merged.

Before showing the confirmation prompt and again immediately before removing,
the command scans Linux `/proc` for live processes whose canonical current
working directory is the target worktree or one of its subdirectories. A match
prints the PID and asks you to stop that process yourself before retrying. The
guard never kills processes. A `/proc` enumeration error or unreadable process
identity for a current-user PID refuses removal with a reason and a retry hint.
Zombie processes are ignored, and process start times are compared around the
working-directory read so an exited or reused PID is not attributed to the old
process. The final scan narrows the race where a process starts while the
confirmation prompt is open; a process could still start in the small interval
between that scan and Git removing the worktree.

The scan depends on Linux `/proc`. Processes that move their working directory
out of the worktree, or whose cwd cannot be read, may not be detected. A PID
whose cwd cannot be read is skipped because its relation to the target cannot
be established; a same-user PID whose stat identity or `/proc` enumeration
cannot be read blocks removal. If removal is refused, inspect the listed PID
locally (for example with `ps`), stop the relevant development server or worker,
then run `scripts/worktree.sh remove <path>` again. The guard does not print
process command lines or environment values.

## Cursor delegation

`scripts/delegate-cursor.sh --worktree <task-name>` creates or reuses the
standard Git worktree and invokes Cursor with `--workspace <absolute-path>`.
Freshness of `origin/main` for new branches is handled only by
`scripts/worktree.sh create` (default `--base origin/main`); the delegate script
does not fetch. Existing worktrees are reused without fetch or branch changes.
Use `--workspace <path>` to continue work in a listed worktree. Cursor's own
`--worktree` option is not used because it controls a separate storage root.

`npm run dev` starts the same services with the receipt-manager frontend on
`5174`, supervised backend on `8000`, and explicit port-conflict handling.
Worktree setup does not start or stop services or apply database migrations.

### Playwright MCP setup, troubleshooting, and updates

The first MCP launch downloads the pinned MCP package and, if needed, its
matching Chromium build. This requires npm registry access. Browser binaries are
shared in the standard Playwright cache; browser profiles remain in the MCP
cache and are scoped by workspace. If MCP does not start, run `agent mcp list`
and `agent mcp list-tools playwright` from the target worktree, confirm that
`.cursor/mcp.json` is loaded, and inspect the Cursor CLI error for npm network or
permission failures. Do not add broad Shell or MCP permissions to work around a
single-server issue.

If Chromium is missing or mismatched, start `.cursor/playwright-mcp.sh` again;
it installs only the pinned browser revision when that revision is absent. The
launcher refuses to start MCP if the matching headless-shell executable is still
missing. Do not delete the Playwright browser cache or MCP profile as a generic
repair.

When updating Playwright MCP, select a concrete `@playwright/mcp` release,
inspect that release's exact `playwright` / `playwright-core` dependencies and
its `browsers.json`, and update the three pins in
`.cursor/playwright-mcp.sh` together. Then run
`bash scripts/test-playwright-mcp.sh` and `npm run check`. From Cursor, verify
that the MCP tools are listed, Chromium launches,
`http://localhost:5174/` loads, and desktop/mobile viewport checks work. Do not infer successful Cursor or browser operation from static tests.

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
