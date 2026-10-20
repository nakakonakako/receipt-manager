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
and environment setup. If its branch is already checked out elsewhere, the
command displays the worktree list and stops; inspect that worktree and pass its
path to `reuse`. `reuse` displays the branch, status, staged/unstaged summaries,
and untracked paths before running setup. It preserves all existing changes.

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
alongside price-memo on `5173`. The separate Cursor Playwright server remains
on `5273`. If Tailscale Serve forwards to the receipt-manager development
server, verify its local target and update it from `5173` to `5174` when needed;
this repository change does not alter the machine's Tailscale configuration.
Before `npm run dev` starts, an owned-process supervisor checks frontend `5174`
and backend `8000`. Occupied ports stop startup with listener PID, command, and
working directory where available; ports are never reassigned and existing
owners are never stopped. Ctrl+C, SIGTERM, and either server's startup failure
stop only the isolated process groups started by that command. Shutdown releases
the ports for a later run.

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

## Cursor delegation

`scripts/delegate-cursor.sh --worktree <task-name>` creates or reuses the
standard Git worktree and invokes Cursor with `--workspace <absolute-path>`.
For a new worktree it fetches `origin/main` and uses that exact ref as its base;
fetch failure stops creation, with no fallback to the current branch. Existing
worktrees are reused without fetch or branch changes.
Use `--workspace <path>` to continue work in a listed worktree. Cursor's own
`--worktree` option is not used because it controls a separate storage root.

`npm run dev` starts the same services with the receipt-manager frontend on
`5174`, supervised backend on `8000`, and explicit port-conflict handling.
Worktree setup does not start or stop services or apply database migrations.

## Development database planning

The allowed development Supabase project ref is fixed in the repository
(`irgahixsuvtopiwmtkku`). Shared development credentials live under
`~/.config/receipt-manager/development/`; each worktree's `frontend/.env` must
symlink to `~/.config/receipt-manager/development/frontend/.env` (created by
`bash scripts/dev-env.sh prepare` / worktree setup). The shared
`development/frontend` directory must be a regular directory, not a symlink.

`db:plan` validates the shared `frontend/.env` symlink and URL, then this
worktree's Supabase CLI link. Vite URL overrides or unsupported URL formats fail
closed. An unlinked worktree requires an interactive confirmation before it
links to the allowed development ref; a mismatched link is never changed. It
runs migration list and dry-run only:

```bash
npm run db:plan
```

Local `npm run db:push` uses the same checks, displays the dry-run apply plan,
and requires an interactive terminal plus typing the development ref. The
production deployment
workflow remains unchanged. For a CLI database-password prompt, use the
documented `SUPABASE_DB_PASSWORD` environment variable; never put the password
in command arguments, repository files, or logs.

Details and safety constraints: [spec-worktree-runtime.md](./spec-worktree-runtime.md).
