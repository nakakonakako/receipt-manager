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

Before `db:plan` or `db:push`, the guard checks that:

- `frontend/.env` in the current worktree is a symlink to
  `~/.config/receipt-manager/development/frontend/.env` (mode `0600`, parent
  directory mode `0700`).
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

## Local development database push

`npm run db:push` is a development-only guarded command. It repeats the target
checks, displays migration status and a dry-run plan, then requires a TTY and
the user to type the development ref. The target is checked again immediately
before the actual `supabase db push --linked`. Non-interactive runs and any
ambiguous or mismatched target stop without applying migrations. Production
CI/CD keeps its existing independent migration command and credentials.

Outside explicit `db:plan` or `db:push` invocations, worktree setup, `npm run dev`,
and `npm run check` never link to Supabase or access a remote database. If the
CLI needs a database password, set
`SUPABASE_DB_PASSWORD` in the shell; it is passed through the environment and
never printed or placed in command arguments. For temporary `cli_login_postgres`
role permission failures, retry with the development DB password set this way.

Applying migrations remains `npm run db:push` and requires an explicit human or
supervisor request per `AGENTS.md`.
