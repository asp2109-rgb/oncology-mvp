# Oncology MVP Architecture

## Stack
- Next.js (App Router, TypeScript)
- SQLite + FTS5 (`better-sqlite3`)
- Rule engine (deterministic)
- LLM adapter for patient-mode (`OPENAI_API_KEY`, `OPENAI_MODEL`)
- External data sources:
  - Minzdrav API (`apicr.minzdrav.gov.ru`)
  - ClinicalTrials.gov API v2

## Modules
- `src/lib/db.ts` — schema, persistence, benchmark/validation storage, trials cache
- `src/lib/search/providers.ts` — `SearchProvider` contract, `SqlFtsProvider`, `RuleIndexProvider`
- `src/lib/validation/rule-engine.ts` — case validation and retrospective selection logic
- `src/lib/llm.ts` — patient-friendly explanation via OpenAI (`llm_only`)
- `src/lib/benchmark.ts` — benchmark runner and metrics
- `src/lib/trials.ts` — clinical trials search + TTL cache

## REST API
- `POST /api/doctor/validate`
- `POST /api/patient/explain`
- `POST /api/guidelines/search`
- `GET /api/trials/search?query=...&recruiting=true`
- `POST /api/benchmark/run`
- `GET /api/benchmark/latest`
- `GET /api/health`

## Data Lifecycle
1. `npm run ingest:minzdrav` pulls oncology recommendations (`C00-D48`, statuses 0 and 4).
2. Sections are normalized and chunked into `recommendation_chunks` + `recommendation_chunks_fts`.
3. Doctor/patient APIs use rule engine + provider abstraction for retrieval.
4. Benchmark datasets run through the same validation pipeline and persist metrics.

## Retrospective logic
Guideline versions are selected by:
- diagnosis keyword match,
- `publish_date <= as_of_date`,
- выбор ближайшей доступной версии, если точного исторического совпадения нет.

## Security constraints
- No personal patient identifiers are required.
- Only de-identified JSON cases are accepted.
- Tool does not issue autonomous treatment prescriptions.
