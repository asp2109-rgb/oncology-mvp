#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DB="${ONCO_SOURCE_DB:-$ROOT_DIR/data/oncology.db}"
DEPLOY_DB="${ONCO_DEPLOY_DB:-$ROOT_DIR/data/oncology.deploy.db}"
KEEP_GUIDELINES="${ONCO_KEEP_GUIDELINES:-40}"
MIN_KEEP_GUIDELINES="${ONCO_MIN_KEEP_GUIDELINES:-14}"
MAX_DEPLOY_MB="${ONCO_DEPLOY_MAX_MB:-95}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 не найден. Установите sqlite3 и повторите."
  exit 1
fi

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "Источник БД не найден: $SOURCE_DB"
  exit 1
fi

if ! [[ "$KEEP_GUIDELINES" =~ ^[0-9]+$ ]] || [[ "$KEEP_GUIDELINES" -lt 1 ]]; then
  echo "ONCO_KEEP_GUIDELINES должен быть положительным целым числом."
  exit 1
fi

if ! [[ "$MIN_KEEP_GUIDELINES" =~ ^[0-9]+$ ]] || [[ "$MIN_KEEP_GUIDELINES" -lt 1 ]]; then
  echo "ONCO_MIN_KEEP_GUIDELINES должен быть положительным целым числом."
  exit 1
fi

if (( MIN_KEEP_GUIDELINES > KEEP_GUIDELINES )); then
  MIN_KEEP_GUIDELINES="$KEEP_GUIDELINES"
fi

if ! [[ "$MAX_DEPLOY_MB" =~ ^[0-9]+$ ]] || [[ "$MAX_DEPLOY_MB" -lt 1 ]]; then
  echo "ONCO_DEPLOY_MAX_MB должен быть положительным целым числом (MB)."
  exit 1
fi

TARGET_BYTES="$((MAX_DEPLOY_MB * 1024 * 1024))"

mkdir -p "$(dirname "$DEPLOY_DB")"
TMP_DB="${DEPLOY_DB}.tmp"
BEST_DB="${DEPLOY_DB}.best"

cleanup() {
  rm -f "$TMP_DB" "$BEST_DB"
}
trap cleanup EXIT

build_deploy_db() {
  local keep="$1"
  cp "$SOURCE_DB" "$TMP_DB"

  sqlite3 "$TMP_DB" <<SQL
PRAGMA journal_mode=DELETE;
PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS keep_guidelines;
CREATE TEMP TABLE keep_guidelines AS
SELECT id
FROM guidelines
ORDER BY COALESCE(publish_date, '') DESC
LIMIT $keep;

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

-- FTS5 keeps shadow pages for deleted rows.
-- Rebuild indexes so deploy DB size reflects retained data only.
INSERT INTO recommendation_chunks_fts(recommendation_chunks_fts) VALUES('rebuild');
INSERT INTO source_documents_fts(source_documents_fts) VALUES('rebuild');

DROP TABLE IF EXISTS keep_guidelines;
VACUUM;
SQL
}

size_bytes() {
  local db_path="$1"
  stat -f '%z' "$db_path" 2>/dev/null || stat -c '%s' "$db_path"
}

size_mb() {
  local bytes="$1"
  awk "BEGIN { printf \"%.1f\", $bytes/1024/1024 }"
}

SELECTED_KEEP="$KEEP_GUIDELINES"
SELECTED_SIZE_BYTES=0

build_deploy_db "$KEEP_GUIDELINES"
CURRENT_SIZE_BYTES="$(size_bytes "$TMP_DB")"

if (( CURRENT_SIZE_BYTES <= TARGET_BYTES )); then
  mv "$TMP_DB" "$DEPLOY_DB"
  SELECTED_SIZE_BYTES="$CURRENT_SIZE_BYTES"
else
  LOW="$MIN_KEEP_GUIDELINES"
  HIGH="$((KEEP_GUIDELINES - 1))"
  BEST_KEEP=0
  BEST_SIZE_BYTES=0

  while (( LOW <= HIGH )); do
    MID="$(((LOW + HIGH) / 2))"
    build_deploy_db "$MID"
    MID_SIZE_BYTES="$(size_bytes "$TMP_DB")"

    if (( MID_SIZE_BYTES <= TARGET_BYTES )); then
      BEST_KEEP="$MID"
      BEST_SIZE_BYTES="$MID_SIZE_BYTES"
      cp "$TMP_DB" "$BEST_DB"
      LOW="$((MID + 1))"
    else
      HIGH="$((MID - 1))"
    fi
  done

  if (( BEST_KEEP == 0 )); then
    build_deploy_db "$MIN_KEEP_GUIDELINES"
    mv "$TMP_DB" "$DEPLOY_DB"
    SELECTED_KEEP="$MIN_KEEP_GUIDELINES"
    SELECTED_SIZE_BYTES="$(size_bytes "$DEPLOY_DB")"
  else
    mv "$BEST_DB" "$DEPLOY_DB"
    SELECTED_KEEP="$BEST_KEEP"
    SELECTED_SIZE_BYTES="$BEST_SIZE_BYTES"
  fi
fi

SELECTED_SIZE_MB="$(size_mb "$SELECTED_SIZE_BYTES")"

echo "Готово: $DEPLOY_DB"
echo "Размер: ${SELECTED_SIZE_MB} MB (лимит ${MAX_DEPLOY_MB} MB)"
echo "Запрошено рекомендаций: $KEEP_GUIDELINES"
echo "Фактически оставлено рекомендаций: $SELECTED_KEEP"

if (( SELECTED_KEEP < KEEP_GUIDELINES )); then
  echo "Применено авто-ужатие до лимита размера deploy-БД."
fi

if (( SELECTED_SIZE_BYTES > TARGET_BYTES )); then
  echo "Внимание: даже минимальный лимит ONCO_MIN_KEEP_GUIDELINES=$MIN_KEEP_GUIDELINES превысил целевой размер."
fi
