# Worktree runtime and db:plan

## Managed backend virtual environment

- Worktree setup (`scripts/worktree.sh` setup / create without `--no-setup`) installs
  Node dependencies and ensures a **managed** `backend/.venv` in the worktree.
- A managed environment is a regular directory at `backend/.venv` (never a symlink)
  with marker file `backend/.venv/.receipt-manager-managed-venv` recording the
  canonical worktree path at creation or adoption.
- Relocation is detected by comparing the `uvicorn` script shebang to
  `backend/.venv/bin/python` and `sys.prefix` to the current worktree, and by
  the marker path when present.
- Automatic repair runs `uv sync --reinstall` in place only for a confirmed stale
  standard virtualenv inside this worktree. It does not remove the venv. Symlinks,
  paths outside `backend/.venv`, and non-standard environments are never repaired
  automatically; recovery steps are printed.
- After sync, `backend/.venv/bin/uvicorn --version` must succeed.

## Fast dev preflight

`bash scripts/dev-env.sh prepare` (and thus `npm run dev`) still avoids `npm ci`
and `uv sync` when the backend runtime is healthy. It fails with concrete recovery
steps when the venv is missing, stale, or cannot run `uvicorn`.

## Development Supabase project target

The allowed development Supabase project ref is fixed in
`scripts/supabase-target.py` (`irgahixsuvtopiwmtkku`). There is no registration
file or registration command.

Before `npm run dev` starts either server, `dev-env.sh prepare` also runs the
local-only target validator. It checks the shared frontend `.env`, all Vite
development override files, URL process overrides, and the backend dotenv
sources. `gemini_service.py` calls `load_dotenv()` during import from
`backend/app/services`, then `main.py` calls it from `backend/app`. Both calls
use python-dotenv's default `override=False`, so values loaded by the first call
remain effective. The validator rejects `backend/app/services/.env` as an
ambiguous higher-priority source and checks the remaining selected file
(`backend/app/.env`, then `backend/.env`, then repository `.env`).

The backend prefers `VITE_SUPABASE_URL` over `SUPABASE_URL`; both are checked
when present. The AI quota dotenv is loaded afterward with `override=False`, so
the validator also rejects either Supabase URL setting in the selected quota
file. `PYTHON_DOTENV_DISABLED` values that disable dotenv loading are rejected.
Missing, duplicated, non-literal, malformed, or mismatched URLs fail closed.
Diagnostics show setting/file names and never print URL values. The validator
does not invoke the Supabase CLI or make a network/database connection.

Before `db:plan`, `scripts/db-env-prepare.sh` (also invoked at the
start of both commands) runs a DB-only environment step. It does **not** run
`dev-env.sh prepare`, backend `.venv` checks, or other application runtime
preflight.

That step checks that:

- Shared `~/.config/receipt-manager/development/frontend/.env` exists with mode
  `0600` and parent directory mode `0700`.
- `frontend/.env` in the current worktree is a symlink to that shared file when
  it already exists. If `frontend/.env` is missing entirely, the command creates
  an absolute symlink to the shared file. Regular files, broken symlinks, and
  mismatched symlinks are never changed.
- `VITE_SUPABASE_URL` in that shared file resolves to
  `https://irgahixsuvtopiwmtkku.supabase.co` with no Vite override files or
  process-level URL overrides.
- `~/.config/receipt-manager/development/frontend` is a regular directory, not
  a symlink.

## npm run db:plan

Receipt-manager only. The command:

1. Refuses to run outside the `receipt-manager` repository.
2. Requires local `supabase/migrations/*.sql` files.
3. Rejects project/database/workdir environment overrides, Vite URL overrides,
   unsupported URL forms, a non-symlink or mismatched `frontend/.env`, and a
   frontend URL that does not match the allowed development ref.
4. Requires the current worktree CLI link to match the allowed development ref.
   An unlinked worktree can be linked only after an interactive confirmation;
   an existing mismatched or partial link is never repaired.
5. Runs only `supabase migration list --linked` and
   `supabase db push --linked --dry-run` for remote DB inspection. The dry-run
   is shown even when there are no pending migrations and never applies them.

## Legacy local database push

`npm run db:push` is retired for hosted Dev writes. `scripts/db-push.sh` exits
before environment preparation, target lookup, password prompts, or Supabase
CLI execution. Hosted Dev migrations use the protected Writer workflow in
`shared-supabase-db` (currently disabled while `DEV_DB_WRITER_ENABLED=false`);
the existing production CI/CD path remains independent
and unchanged. Use `npm run db:plan` for migration list and dry-run review.

This guard closes the repository script path only. It cannot prevent a valid
previously issued database credential from being used directly with Supabase
CLI or another client. Revoking or rotating that credential is a separate
operational action and is not performed by this code change.

Outside explicit `db:plan` invocations, worktree setup, `npm run dev`, and
`npm run check` never link to Supabase or access a remote database.

If `SUPABASE_DB_PASSWORD` is unset, `db:plan` prompts for it on a TTY with
hidden input, exports it only for the current process, and never prints, logs,
or passes it on the CLI argument list. Non-interactive sessions without the
variable stop with recovery steps instead of running Supabase.
