# Технические детали и стек с границей MVP

Дата: 2026-02-24

## 1. Коротко о решении
Платформа ретроспективно проверяет назначенный план онколечения на соответствие клиническим рекомендациям и выдает два вида результата:
- для врача: структурированная валидация + доказательства + LLM-ревью (если доступен ключ);
- для пациента: объяснение простым языком по тому же кейсу.

## 2. Технологический стек (фактическая реализация)

### Frontend
- `Next.js 16.1.6` (App Router)
- `React 19.2.3`
- `TypeScript 5`
- `Tailwind CSS 4`
- `lucide-react` (иконки)

### Backend
- `Next.js Route Handlers` (`runtime = nodejs`) для REST API.
- Модульная структура:
  - `src/lib/validation/rule-engine.ts`
  - `src/lib/retrieval.ts`
  - `src/lib/search/providers.ts`
  - `src/lib/source-sync.ts`
  - `src/lib/doctor-llm.ts`
  - `src/lib/llm.ts`
  - `src/lib/benchmark.ts`

### Хранилище и поиск
- `SQLite` (`better-sqlite3`) как локальная база MVP.
- `FTS5` для полнотекстового поиска:
  - `recommendation_chunks_fts`
  - `source_documents_fts`
- Основные таблицы: guidelines, sections, chunks, validation_runs, benchmark_runs, trials_cache, source_documents, source_sync_logs.

### AI-слой
- Deterministic rule engine для базовой валидации.
- Retrieval с режимами:
  - `auto`, `standard`, `hyde`, `fusion`, `graphrag_lite`, `kag`, `agentic`.
- OpenAI для:
  - врачебного RAG+KAG заключения (`/api/doctor/validate`);
  - пациентского объяснения (`/api/patient/explain`).
- При недоступности LLM для doctor-mode включается `rules-only fallback`.

### Интеграции данных
- Минздрав РФ:
  - `GetJsonClinrecsFilterV2`
  - `GetClinrec2`
  - `GetClinrecPdf`
- ClinicalTrials.gov API v2.
- Unified source sync для:
  - `minzdrav`, `russco`, `nccn_patient`, `nccn_professional`, `esmo`, `asco`, `pubmed`, `femb`.

### Качество и эксплуатация
- Unit-тесты: `Vitest` (`schema`, `rule-engine`).
- ESLint.
- Скрипты: ingestion, sync, benchmark, DB init, deploy DB prep, QR generation.
- Базовый деплой: `render.yaml`.

## 3. Архитектура обработки кейса (Input -> Process -> Output)
1. Ввод кейса:
- файл или текст через `/api/case/parse`;
- извлечение текста (`pdf-parse`, `mammoth`, `word-extractor`, text fallback).
2. Нормализация:
- формирование `CaseInput` (диагноз, стадия, биомаркеры, план, timeline, `as_of_date`).
3. Выбор рекомендаций:
- подбор версий КР по диагнозу и дате (`publish_date <= as_of_date`).
4. Retrieval:
- локальный FTS-поиск + rule index + source documents;
- опциональный online fallback по source policy.
5. Валидация:
- классификация `matches/mismatches/missing_actions/conflicts`;
- расчет confidence, traceability, source coverage.
6. Формирование ответа:
- доктор: structured result + опциональный LLM-review;
- пациент: упрощенное объяснение на основе результата валидации.
7. Логирование:
- запись validation/benchmark результатов в БД.

## 4. API-контур MVP
- `POST /api/case/parse`
- `POST /api/doctor/validate`
- `POST /api/patient/explain`
- `POST /api/guidelines/search`
- `GET /api/sources/status`
- `POST /api/sources/sync`
- `GET /api/trials/search`
- `POST /api/benchmark/run`
- `GET /api/benchmark/latest`
- `GET /api/health`

## 5. Что помечать как MVP, а что как Post-MVP

| Блок | Статус | Как отмечать в презентации |
|---|---|---|
| Режим врача (`/doctor`) с валидацией, evidence и source traceability | Реализовано | `[MVP]` |
| Режим пациента (`/patient`) с LLM-объяснением | Реализовано | `[MVP]` |
| Разбор входных файлов и автозаполнение кейса | Реализовано | `[MVP]` |
| Ретроспективный выбор версии КР по `as_of_date` | Реализовано | `[MVP]` |
| Бенчмарк (`/benchmark`) и расчет метрик | Реализовано | `[MVP]` |
| Реестр и синхронизация источников (`/sources`, `/api/sources/*`) | Реализовано | `[MVP]` |
| ClinicalTrials поиск (`/api/trials/search`) | Реализовано | `[MVP]` |
| LLM-first автономные назначения терапии | Не реализуется по замыслу | Не заявлять вообще |
| Интеграция с МИС/EMR (онлайн доступ к реальным записям) | Не реализовано | `[Post-MVP]` |
| Ролевая модель, SSO, аудит действий пользователей | Не реализовано | `[Post-MVP]` |
| Промышленное масштабирование (кластерная БД, очередь, SLO/SLA) | Не реализовано | `[Post-MVP]` |
| Полноценный OCR-конвейер и контроль качества извлечения из сканов | Не реализовано | `[Post-MVP]` |
| Регуляторный медицинский контур (сертификация/формальный комплаенс) | Не реализовано | `[Post-MVP]` |

## 6. Рекомендуемая формулировка для слайдов
- `MVP (сделано):` локальная fullstack-платформа с ретроспективной проверкой, доказательной выдачей и двумя интерфейсами (врач/пациент).
- `Post-MVP (развитие):` интеграция в клинический ИТ-контур, эксплуатационная зрелость и масштабирование.

## 7. Ограничения, которые нужно проговаривать вслух
- Входные кейсы только обезличенные.
- Прототип не назначает лечение и не заменяет решение врача.
- Качество зависит от покрытия и актуальности источников.
- Для LLM-режимов нужен `OPENAI_API_KEY`; при его отсутствии доступен `rules-only` режим.
