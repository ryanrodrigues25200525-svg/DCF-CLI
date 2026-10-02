#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/prepare_public_repo.sh /absolute/path/to/public-repo"
  exit 1
fi

TARGET_DIR="$1"
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$TARGET_DIR"

rsync -av --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.pytest_cache/' \
  --exclude 'backend/.env' \
  --exclude 'backend/data/' \
  --exclude 'output/' \
  --exclude 'OPERATIONS.md' \
  --exclude 'PROJECT_MAP.md' \
  "$SOURCE_DIR"/ "$TARGET_DIR"/

echo "Sanitized public export written to: $TARGET_DIR"
echo "Review README.md and backend/.env.example before pushing."
