# MVP Implementation Report

Date: 2026-02-20

## Implemented scope

- Next.js fullstack app with doctor/patient/benchmark/sources pages.
- SQLite schema with all planned tables + FTS5 indexing.
- Modular retrieval abstraction:
  - `SqlFtsProvider`
  - `RuleIndexProvider`
- Rule-based retrospective validation by `as_of_date`.
- LLM-only patient explanation layer (OpenAI).
- ClinicalTrials.gov integration (API v2) with cache table.
- Benchmark runner with retrospective/synthetic/literature datasets.
- Unit tests for schema and rule engine.
- Presentation/poster content drafts.
- QR generation script and PNG artifacts.

## Data ingestion status

Command:

```bash
npm run ingest:minzdrav
```

Result:

- oncology guidelines indexed: **220**
- recommendation chunks indexed: **55,628**
- failures: **0**

## Smoke checks

- `GET /api/health` ✅
- `POST /api/guidelines/search` ✅
- `POST /api/doctor/validate` ✅
- `POST /api/patient/explain` ✅
- `GET /api/trials/search` ✅
- `POST /api/benchmark/run` ✅
- `GET /api/benchmark/latest` ✅

## Latest benchmark snapshot

- scenarios_total: 5
- protocol_match_accuracy: 0.6
- mismatch_detection_precision: 0.5
- mismatch_detection_recall: 1.0
- median_validation_time: 270 ms
- case_coverage: 1.0
- source_traceability_rate: 1.0

## Deployment status

Configured for Render Blueprint deployment via `render.yaml`.
