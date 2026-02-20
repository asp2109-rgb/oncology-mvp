#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DB="${ONCO_SOURCE_DB:-$ROOT_DIR/data/oncology.db}"
DEPLOY_DB="${ONCO_DEPLOY_DB:-$ROOT_DIR/data/oncology.deploy.db}"
KEEP_GUIDELINES="${ONCO_KEEP_GUIDELINES:-10}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 не найден. Установите sqlite3 и повторите."
  exit 1
fi

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "Источник БД не найден: $SOURCE_DB"
  exit 1
fi

mkdir -p "$(dirname "$DEPLOY_DB")"
cp "$SOURCE_DB" "$DEPLOY_DB"

sqlite3 "$DEPLOY_DB" <<SQL
PRAGMA journal_mode=DELETE;
PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS keep_guidelines;
CREATE TEMP TABLE keep_guidelines AS
SELECT id
FROM guidelines
ORDER BY COALESCE(publish_date, '') DESC
LIMIT $KEEP_GUIDELINES;

DELETE FROM recommendation_chunks
WHERE guideline_id NOT IN (SELECT id FROM keep_guidelines);

DELETE FROM recommendation_chunks_fts
WHERE chunk_id NOT IN (SELECT chunk_id FROM recommendation_chunks);

DELETE FROM guideline_sections
WHERE guideline_id NOT IN (SELECT id FROM keep_guidelines);

DELETE FROM guidelines
WHERE id NOT IN (SELECT id FROM keep_guidelines);

DELETE FROM validation_runs;
DELETE FROM benchmark_runs;
DELETE FROM trials_cache;

DROP TABLE IF EXISTS keep_guidelines;
VACUUM;
SQL

SIZE_BYTES="$(stat -f '%z' "$DEPLOY_DB" 2>/dev/null || stat -c '%s' "$DEPLOY_DB")"
SIZE_MB="$(awk "BEGIN { printf \"%.1f\", $SIZE_BYTES/1024/1024 }")"

echo "Готово: $DEPLOY_DB"
echo "Размер: ${SIZE_MB} MB"
echo "Оставлено рекомендаций: $KEEP_GUIDELINES"
