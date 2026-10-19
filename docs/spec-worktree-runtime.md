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

## Development Supabase project registration

One-time registration stores the **development** project ref (20-character ref,
not production) in:

`~/.config/receipt-manager/development/supabase-development-project-ref` (mode `0600`)

```bash
bash scripts/dev-env.sh register-supabase-project-ref <project-ref>
```

The command refuses to overwrite an existing registration. Production project IDs
and `PROD_SUPABASE_PROJECT_ID` are never used as the development registration source.

## npm run db:plan

Receipt-manager only. The command:

1. Refuses to run outside the `receipt-manager` repository.
2. Requires local `supabase/migrations/*.sql` files.
3. Requires a registered development project ref in common settings.
4. If the worktree is unlinked, runs `supabase link --project-ref` using only
   the registered development ref; an existing link to another ref is never
   overwritten.
5. Requires the final linked ref to **exactly match** the registration, rejects
   project/database URL overrides, and refuses when `PROD_SUPABASE_PROJECT_ID`
   matches the linked or registered ref.
6. For database inspection, runs only `supabase migration list --linked` and
   `supabase db push --linked --dry-run` (no ordinary push, reset, repair, or apply).
7. Fails when there are no pending local migrations to plan.

Outside an explicit `db:plan` invocation, worktree setup and `npm run dev` never
link to Supabase or run DB commands. If the CLI needs a database password, set
`SUPABASE_DB_PASSWORD` in the shell; it is passed through the environment and
never printed or placed in command arguments. For temporary `cli_login_postgres`
role permission failures, retry with the development DB password set this way.

Applying migrations remains `npm run db:push` and requires an explicit human or
supervisor request per `AGENTS.md`.
