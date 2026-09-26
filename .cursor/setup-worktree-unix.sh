#!/usr/bin/env bash
set -euo pipefail

echo "[worktree-setup] Installing root dependencies..."
npm ci

echo "[worktree-setup] Installing frontend dependencies..."
npm ci --prefix frontend

echo "[worktree-setup] Installing backend dependencies..."
uv sync --directory backend

echo "[worktree-setup] Copying local environment files..."

for file in .env frontend/.env backend/.env; do
  if [ -f "$ROOT_WORKTREE_PATH/$file" ]; then
    cp "$ROOT_WORKTREE_PATH/$file" "$file"
    echo "[worktree-setup] Copied $file"
  fi
done

echo "[worktree-setup] Complete."