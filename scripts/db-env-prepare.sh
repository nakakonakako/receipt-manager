#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
# shellcheck source=lib-supabase-target.sh
source "$script_dir/lib-supabase-target.sh"

prepare_database_command_environment "$repo_root"
