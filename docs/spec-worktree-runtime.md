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

## Migration plan and local inventory commands

The official source for migration inventory and Dev database history is
`shared-supabase-db`. Run its Reader-only manual workflow to check the plan:
[Dev migration plan](https://github.com/nakakonakako/shared-supabase-db/actions/workflows/dev-migration-plan.yml).

`npm run db:plan` prints that link and states that it did not check Dev database
history. It does not read a database password, prepare a CLI link, or connect
to Supabase. `npm run db:list` lists only SQL migration files present in this
receipt-manager checkout, labels them as local files (not the shared inventory
or Dev history), and prints the same workflow link. Neither command invokes
Supabase CLI. The repository's `scripts/supabase-target.py` remains in use for
validating app development URLs; it is not part of DB plan/list commands.

## Legacy local database push

`npm run db:push` is retired for hosted Dev writes. `scripts/db-push.sh` exits
before environment preparation, target lookup, password prompts, or Supabase
CLI execution. Shared-supabase-db owns the migration inventory and Dev DB
history, its Reader-only workflow checks the plan, and its protected Writer
workflow applies Dev migrations. Receipt-manager owns application development
and DB contract verification. Production CI/CD remains independent and
unchanged.

This guard closes the repository script path only. It cannot prevent a valid
previously issued database credential from being used directly with Supabase
CLI or another client. Revoking or rotating that credential is a separate
operational action and is not performed by this code change.

Worktree setup, `npm run dev`, `npm run check`, `npm run db:plan`, and
`npm run db:list` do not use a linked Supabase CLI project or access a remote
database. The local `frontend/.env` still supports app development, but the DB
plan/list commands do not read it or require `SUPABASE_DB_PASSWORD`.
