#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
repository_name="$(basename "$source_root")"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/${repository_name}-dev-env-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fixture_home="$test_root/home"
fixture_repo="$fixture_home/web/$repository_name"
fixture_config="$fixture_home/.config/$repository_name/development"
mkdir -p "$fixture_repo/scripts" "$fixture_repo/frontend" "$fixture_repo/backend/app" "$fixture_config/backend"
chmod 700 "$fixture_config" "$fixture_config/backend"
cp "$source_root/scripts/dev-env.sh" "$fixture_repo/scripts/dev-env.sh"
cp "$source_root/scripts/lib-backend-runtime.sh" "$fixture_repo/scripts/lib-backend-runtime.sh"
cp "$source_root/scripts/supabase-target.py" "$fixture_repo/scripts/supabase-target.py"
chmod +x "$fixture_repo/scripts/dev-env.sh"
printf 'VITE_SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=public-test-value\nPRIVATE_MARKER=must-not-print\n' > "$fixture_repo/frontend/.env"
printf 'VITE_SUPABASE_URL=https://override.invalid\nOVERRIDE_MARKER=must-not-print\n' > "$fixture_repo/frontend/.env.local"
printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nBACKEND_MARKER=must-not-print\n' > "$fixture_repo/backend/.env"
printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nROOT_MARKER=must-not-print\n' > "$fixture_repo/.env"
printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nBACKEND_MARKER=must-not-print\n' > "$fixture_config/backend/.env"
chmod 600 "$fixture_config/backend/.env"
chmod 644 "$fixture_repo/frontend/.env" "$fixture_repo/frontend/.env.local" "$fixture_repo/backend/.env" "$fixture_repo/.env"
printf '.env\nfrontend/.env\nfrontend/.env.local\nbackend/.env\n' > "$fixture_repo/.gitignore"
touch "$fixture_repo/frontend/.keep" "$fixture_repo/backend/.keep"
git -C "$fixture_repo" init -b main >/dev/null
git -C "$fixture_repo" config user.name 'Dev Env Test'
git -C "$fixture_repo" config user.email 'dev-env-test@example.invalid'
git -C "$fixture_repo" add scripts/dev-env.sh scripts/lib-backend-runtime.sh scripts/supabase-target.py .gitignore frontend/.keep backend/.keep
git -C "$fixture_repo" commit -m 'development environment fixture' >/dev/null
export HOME="$fixture_home"

preview="$("$fixture_repo/scripts/dev-env.sh" migrate --preview)"
for expected in "$fixture_repo/.env" "$fixture_repo/frontend/.env" "$fixture_repo/frontend/.env.local" "$fixture_repo/backend/.env" 'VITE_SUPABASE_URL'; do
  [[ "$preview" == *"$expected"* ]]
done
for secret in must-not-print safe.invalid override.invalid public-test-value; do
  [[ "$preview" != *"$secret"* ]]
done

printf 'copy\n' | "$fixture_repo/scripts/dev-env.sh" migrate --apply frontend/.env >/dev/null
[[ -f "$fixture_config/frontend/.env" ]]
[[ "$(stat -c '%a' "$fixture_config")" == 700 ]]
[[ "$(stat -c '%a' "$fixture_config/frontend")" == 700 ]]
[[ "$(stat -c '%a' "$fixture_config/frontend/.env")" == 600 ]]
[[ -f "$fixture_repo/frontend/.env" ]]
conflict_preview="$("$fixture_repo/scripts/dev-env.sh" migrate --preview)"
[[ "$conflict_preview" == *'CONFLICT (will not overwrite)'* ]]
if printf 'copy\n' | "$fixture_repo/scripts/dev-env.sh" migrate --apply frontend/.env >"$test_root/migration-conflict.log" 2>&1; then
  echo 'Expected an existing common setting to be preserved and rejected.' >&2
  exit 1
fi
[[ "$(cat "$fixture_config/frontend/.env")" == *'must-not-print'* ]]

if "$fixture_repo/scripts/dev-env.sh" prepare >"$test_root/override.log" 2>&1; then
  echo 'Expected overlapping .env.local keys to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/override.log")" == *'VITE_SUPABASE_URL'* ]]
[[ "$(cat "$test_root/override.log")" != *'override.invalid'* ]]

rm "$fixture_repo/frontend/.env.local"
"$fixture_repo/scripts/dev-env.sh" prepare >/dev/null
[[ -f "$fixture_repo/frontend/.env" && ! -L "$fixture_repo/frontend/.env" ]]
[[ "$(python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config")" == 'irgahixsuvtopiwmtkku' ]]

wrong_url='https://zyxwvutsrqponmlkjihg.supabase.co'
unset VITE_SUPABASE_URL SUPABASE_URL
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_PUBLISHABLE_KEY=public-test-value\n' "$wrong_url" > "$fixture_config/frontend/.env"
cp "$fixture_config/frontend/.env" "$fixture_repo/frontend/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/frontend-target.log" 2>&1; then
  echo 'Expected an unapproved frontend target to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/frontend-target.log")" != *"$wrong_url"* ]]
printf 'VITE_SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=public-test-value\nPRIVATE_MARKER=must-not-print\n' > "$fixture_config/frontend/.env"
cp "$fixture_config/frontend/.env" "$fixture_repo/frontend/.env"

if VITE_SUPABASE_URL="$wrong_url" "$fixture_repo/scripts/dev-env.sh" prepare >"$test_root/frontend-process-override.log" 2>&1; then
  echo 'Expected a frontend process override to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/frontend-process-override.log")" == *'VITE_SUPABASE_URL process override'* ]]
[[ "$(cat "$test_root/frontend-process-override.log")" != *"$wrong_url"* ]]

if SUPABASE_URL="$wrong_url" "$fixture_repo/scripts/dev-env.sh" prepare >"$test_root/backend-process-override.log" 2>&1; then
  echo 'Expected a backend process override to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-process-override.log")" == *'SUPABASE_URL process override'* ]]
[[ "$(cat "$test_root/backend-process-override.log")" != *"$wrong_url"* ]]

printf 'VITE_SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nSUPABASE_URL=%s\n' "$wrong_url" > "$fixture_repo/backend/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/backend-file-override.log" 2>&1; then
  echo 'Expected a mismatched backend URL to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-file-override.log")" == *'Backend SUPABASE_URL does not match'* ]]
[[ "$(cat "$test_root/backend-file-override.log")" != *"$wrong_url"* ]]
printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nBACKEND_MARKER=must-not-print\n' > "$fixture_repo/backend/.env"

printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nVITE_SUPABASE_URL=%s\n' "$wrong_url" > "$fixture_repo/backend/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/backend-effective-override.log" 2>&1; then
  echo 'Expected the backend-selected VITE_SUPABASE_URL to be validated.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-effective-override.log")" == *'Backend VITE_SUPABASE_URL does not match'* ]]
[[ "$(cat "$test_root/backend-effective-override.log")" != *"$wrong_url"* ]]
printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nBACKEND_MARKER=must-not-print\n' > "$fixture_repo/backend/.env"

for override_file in .env.development .env.development.local; do
  printf 'VITE_SUPABASE_URL=%s\n' "$wrong_url" > "$fixture_repo/frontend/$override_file"
  if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/frontend-file-override.log" 2>&1; then
    echo "Expected frontend/$override_file to block startup." >&2
    exit 1
  fi
  [[ "$(cat "$test_root/frontend-file-override.log")" == *"VITE_SUPABASE_URL override exists in frontend/$override_file"* ]]
  [[ "$(cat "$test_root/frontend-file-override.log")" != *"$wrong_url"* ]]
  rm "$fixture_repo/frontend/$override_file"
done

printf 'SUPABASE_URL=%s\n' "$wrong_url" > "$fixture_repo/backend/app/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/backend-app-env.log" 2>&1; then
  echo 'Expected the backend dotenv file nearest main.py to be validated first.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-app-env.log")" == *'does not match the allowed development project ref'* ]]
[[ "$(cat "$test_root/backend-app-env.log")" != *"$wrong_url"* ]]
rm "$fixture_repo/backend/app/.env"

printf 'VITE_SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nSUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\n' > "$fixture_repo/backend/.env"
[[ "$(python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config")" == 'irgahixsuvtopiwmtkku' ]]
printf 'VITE_SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nSUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nVITE_SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\n' > "$fixture_repo/backend/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/backend-duplicate.log" 2>&1; then
  echo 'Expected duplicate backend URL settings to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-duplicate.log")" == *'must be defined at most once'* ]]

printf 'BACKEND_MARKER=must-not-print\n' > "$fixture_repo/backend/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/backend-missing-url.log" 2>&1; then
  echo 'Expected a missing backend URL to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-missing-url.log")" == *'must define VITE_SUPABASE_URL or SUPABASE_URL'* ]]

printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co/path\n' > "$fixture_repo/backend/.env"
if python3 "$fixture_repo/scripts/supabase-target.py" validate-dev "$fixture_repo" "$fixture_config" >"$test_root/backend-malformed-url.log" 2>&1; then
  echo 'Expected a non-canonical backend URL to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/backend-malformed-url.log")" == *'SUPABASE_URL is not a canonical Supabase project URL'* ]]
[[ "$(cat "$test_root/backend-malformed-url.log")" != *'/path'* ]]
printf 'SUPABASE_URL=https://irgahixsuvtopiwmtkku.supabase.co\nBACKEND_MARKER=must-not-print\n' > "$fixture_repo/backend/.env"

worktree="$fixture_home/worktrees/$repository_name/new-task"
mkdir -p "$(dirname "$worktree")"
git -C "$fixture_repo" worktree add -b env-test "$worktree" HEAD >/dev/null
"$worktree/scripts/dev-env.sh" prepare >/dev/null
[[ "$(readlink "$worktree/frontend/.env")" == "$fixture_config/frontend/.env" ]]

rm "$worktree/frontend/.env"
printf 'local-conflict\n' > "$worktree/frontend/.env"
if "$worktree/scripts/dev-env.sh" prepare >"$test_root/conflict.log" 2>&1; then
  echo 'Expected a conflicting existing file to be preserved and rejected.' >&2
  exit 1
fi
[[ "$(cat "$worktree/frontend/.env")" == 'local-conflict' ]]

missing_home="$test_root/missing-home"
missing_repo="$missing_home/web/$repository_name"
mkdir -p "$missing_repo/scripts" "$missing_repo/frontend"
cp "$source_root/scripts/dev-env.sh" "$missing_repo/scripts/dev-env.sh"
cp "$source_root/scripts/lib-backend-runtime.sh" "$missing_repo/scripts/lib-backend-runtime.sh"
cp "$source_root/scripts/supabase-target.py" "$missing_repo/scripts/supabase-target.py"
if HOME="$missing_home" "$missing_repo/scripts/dev-env.sh" prepare >"$test_root/missing.log" 2>&1; then
  echo 'Expected missing development settings to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/missing.log")" == *'migrate --preview'* ]]
[[ "$(cat "$test_root/missing.log")" == *'VITE_SUPABASE_URL'* ]]

if [[ "$repository_name" == price-memo || "$repository_name" == receipt-manager ]]; then
  if [[ "$repository_name" == price-memo ]]; then
    grep -Eq 'port: 5173' "$source_root/frontend/vite.config.ts"
    grep -Eq 'vite --port 5273 --strictPort' "$source_root/frontend/package.json"
  else
    grep -Eq 'port: 5174' "$source_root/frontend/vite.config.ts"
  fi
  grep -Eq 'strictPort: true' "$source_root/frontend/vite.config.ts"
fi

node - "$source_root" "$repository_name" <<'NODE'
const fs = require('node:fs')
const root = process.argv[2]
const name = process.argv[3]
const scripts = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8')).scripts
if (!scripts.dev.startsWith('bash scripts/dev-env.sh prepare && ')) {
  throw new Error('npm run dev must run the environment preflight first')
}
if (name === 'price-memo') {
  for (const command of ['dev:playwright', 'devserver:ensure']) {
    if (!scripts[command].startsWith('bash scripts/dev-env.sh prepare && ')) {
      throw new Error(`${command} must run the environment preflight first`)
    }
  }
}
NODE

echo 'Development environment workflow tests passed.'
