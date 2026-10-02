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
  --exclude '.venv/' \
  --exclude 'venv/' \
  --exclude '.pytest_cache/' \
  --include 'backend/.env.example' \
  --exclude '.env*' \
  --exclude '.envrc' \
  --include 'backend/app/assets/templates/dcf-export-template.xlsx' \
  --exclude '*.xlsx' \
  --exclude '*.db' \
  --exclude '*.db-*' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite-*' \
  --exclude 'library.db*' \
  --exclude 'backend/data/' \
  --exclude 'backend/scratch/' \
  --exclude 'backend/.tmp_*.xml' \
  --exclude 'model/test-results/' \
  --exclude 'model/output/' \
  --exclude '.superpowers/sdd/' \
  --exclude 'model/.check-pld.ts' \
  --exclude '.DS_Store' \
  --exclude '.ruff_cache/' \
  --exclude '__pycache__/' \
  --exclude '*.py[cod]' \
  --exclude '*.tsbuildinfo' \
  --exclude 'coverage/' \
  --exclude 'output/' \
  "$SOURCE_DIR"/ "$TARGET_DIR"/

echo "Sanitized public export written to: $TARGET_DIR"
echo "Review README.md and backend/.env.example before pushing."
