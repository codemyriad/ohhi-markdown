#!/bin/bash

echo -e "Checking for consistency between migration files and generated database types...\n"

# Find monorepo root
MONOREPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

while [[ ! -f "$MONOREPO_ROOT/rush.json" && "$MONOREPO_ROOT" != "/" ]]; do
  MONOREPO_ROOT=$(dirname "$MONOREPO_ROOT")
done

if [[ ! -f "$MONOREPO_ROOT/rush.json" ]]; then
  echo "ERROR: Not inside a rush monorepo."
  exit 1
fi

# Get the latest migration version from migration files
MIGRATION_FILES_DIR="$MONOREPO_ROOT/libs/supabase/migrations"

echo -e "Looking for migration files in $MIGRATION_FILES_DIR\n"

LATEST_MIGRTATION_STR="$(ls $MIGRATION_FILES_DIR | sed 's/^\([^_]*\)_.*$/\1/' | sort -n | tail -n 1)"
LATEST_MIGRATION="$((10#$LATEST_MIGRTATION_STR))"

# Get the generated types version
SUPABASE_DIR="libs/supabase"
GEN_TYPES_FILE="$MONOREPO_ROOT/$SUPABASE_DIR/types/db.ts"

echo -e "Looking for generated types in $GEN_TYPES_FILE\n"

GEN_TYPES_VERSION="$(grep "Current version" $GEN_TYPES_FILE | sed 's/^.*Current version: \([0-9]*\).*$/\1/')"

if [[ "$LATEST_MIGRATION" != "$GEN_TYPES_VERSION" ]]; then
  echo -e "ERROR: Versions of generated database types and latest migration do not match: migration = $LATEST_MIGRATION, types = $GEN_TYPES_VERSION\n"
  echo "  1. Navigate to '<monorepo_root>/$SUPABASE_DIR'"
  echo "  2. Spin up the local db instance: docker-compose up -d"
  echo "  3. Migrate the db to the latest version: rushx db:migrate:up"
  echo "  4. Commit the generated types ('<monorepo_root>/$SUPABASE_DIR/types/index.d.ts')"
  exit 1
fi

echo "SUCCESS: Version of generated generated types matches the latest migration version"
exit 0
