#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
repository_name="$(basename "$source_root")"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/${repository_name}-dev-env-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fixture_home="$test_root/home"
fixture_repo="$fixture_home/web/$repository_name"
fixture_config="$fixture_home/.config/$repository_name/development"
mkdir -p "$fixture_repo/scripts" "$fixture_repo/frontend" "$fixture_repo/backend"
cp "$source_root/scripts/dev-env.sh" "$fixture_repo/scripts/dev-env.sh"
chmod +x "$fixture_repo/scripts/dev-env.sh"
printf 'VITE_SUPABASE_URL=https://safe.invalid\nVITE_SUPABASE_PUBLISHABLE_KEY=public-test-value\nPRIVATE_MARKER=must-not-print\n' > "$fixture_repo/frontend/.env"
printf 'VITE_SUPABASE_URL=https://override.invalid\nOVERRIDE_MARKER=must-not-print\n' > "$fixture_repo/frontend/.env.local"
printf 'BACKEND_MARKER=must-not-print\n' > "$fixture_repo/backend/.env"
printf 'ROOT_MARKER=must-not-print\n' > "$fixture_repo/.env"
chmod 644 "$fixture_repo/frontend/.env" "$fixture_repo/frontend/.env.local" "$fixture_repo/backend/.env" "$fixture_repo/.env"
printf '.env\nfrontend/.env\nfrontend/.env.local\nbackend/.env\n' > "$fixture_repo/.gitignore"
touch "$fixture_repo/frontend/.keep" "$fixture_repo/backend/.keep"
git -C "$fixture_repo" init -b main >/dev/null
git -C "$fixture_repo" config user.name 'Dev Env Test'
git -C "$fixture_repo" config user.email 'dev-env-test@example.invalid'
git -C "$fixture_repo" add scripts/dev-env.sh .gitignore frontend/.keep backend/.keep
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
if HOME="$missing_home" "$missing_repo/scripts/dev-env.sh" prepare >"$test_root/missing.log" 2>&1; then
  echo 'Expected missing development settings to block startup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/missing.log")" == *'migrate --preview'* ]]
[[ "$(cat "$test_root/missing.log")" == *'VITE_SUPABASE_URL'* ]]

if [[ "$repository_name" == price-memo || "$repository_name" == receipt-manager ]]; then
  grep -Eq 'port: 5173' "$source_root/frontend/vite.config.ts"
  grep -Eq 'strictPort: true' "$source_root/frontend/vite.config.ts"
  if [[ "$repository_name" == price-memo ]]; then
    grep -Eq 'vite --port 5273 --strictPort' "$source_root/frontend/package.json"
  fi
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
