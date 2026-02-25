# Схемы MVP: как работает система и что под капотом

Дата: 2026-02-24

## 1) Продуктовый контур (что видят пользователи)

```mermaid
flowchart LR
    U1["Врач"] --> D["/doctor"]
    U2["Пациент"] --> P["/patient"]
    U3["Эксперт/Команда"] --> B["/benchmark"]
    U3 --> S["/sources"]

    D --> API1["POST /api/case/parse"]
    D --> API2["POST /api/doctor/validate"]
    P --> API3["POST /api/patient/explain"]
    B --> API4["POST /api/benchmark/run"]
    B --> API5["GET /api/benchmark/latest"]
    S --> API6["GET /api/sources/status"]
    S --> API7["POST /api/sources/sync"]
```

## 2) Сквозной pipeline проверки кейса (Input -> Process -> Output)

```mermaid
flowchart TD
    I["Input: файл/текст кейса"] --> P1["/api/case/parse"]
    P1 --> N["Нормализация в CaseInput"]
    N --> G["Выбор версий КР по diagnosis + as_of_date"]
    G --> R["Retrieval (FTS + RuleIndex + SourceDocs)"]
    R --> E["Rule Engine валидация"]
    E --> L{"OPENAI_API_KEY есть?"}
    L -- "Да" --> M["LLM review (doctor) / patient explanation"]
    L -- "Нет" --> F["rules-only fallback"]
    M --> O["Output: статус, mismatches, evidence, traceability"]
    F --> O
```

## 3) Что под капотом: слои системы

```mermaid
flowchart TB
    subgraph UI["UI слой (Next.js pages)"]
      UI1["/doctor"]
      UI2["/patient"]
      UI3["/benchmark"]
      UI4["/sources"]
    end

    subgraph API["API слой (Route Handlers)"]
      A1["case/parse"]
      A2["doctor/validate"]
      A3["patient/explain"]
      A4["guidelines/search"]
      A5["sources/status + sources/sync"]
      A6["trials/search"]
      A7["benchmark/run + benchmark/latest"]
      A8["health"]
    end

    subgraph Core["Core слой"]
      C1["case-parser.ts"]
      C2["validation/rule-engine.ts"]
      C3["retrieval.ts"]
      C4["search/providers.ts"]
      C5["guidelines.ts"]
      C6["doctor-llm.ts / llm.ts"]
      C7["benchmark.ts"]
      C8["trials.ts"]
      C9["source-sync.ts"]
    end

    subgraph Data["Data слой"]
      D1["SQLite (better-sqlite3)"]
      D2["FTS5 indexes"]
      D3["tables: guidelines, chunks, source_documents, runs, cache, logs"]
    end

    subgraph Ext["Внешние источники"]
      X1["Минздрав API"]
      X2["RUSSCO / NCCN / ESMO / ASCO / FEMB"]
      X3["PubMed API"]
      X4["ClinicalTrials.gov API v2"]
      X5["OpenAI API"]
    end

    UI --> API
    API --> Core
    Core --> Data
    C9 --> Ext
    C8 --> X4
    C6 --> X5
    C5 --> D1
    C3 --> D2
```

## 4) Sequence для `/api/doctor/validate`

```mermaid
sequenceDiagram
    participant Doc as "UI /doctor"
    participant API as "/api/doctor/validate"
    participant Rule as "rule-engine"
    participant Ret as "retrieval"
    participant DB as "SQLite + FTS5"
    participant LLM as "OpenAI"

    Doc->>API: case_input + source_selection + retrieval_mode
    API->>Rule: validateCase()
    Rule->>Ret: retrieveEvidence() по пунктам плана
    Ret->>DB: FTS + rule index + source docs
    DB-->>Ret: SearchHit[]
    Ret-->>Rule: hits + confidence + warnings
    Rule-->>API: ValidationResult
    API->>LLM: buildDoctorLlmReview() (опционально)
    LLM-->>API: verdict + rationale + citations
    API-->>Doc: ValidationResult + llm_review / rules-only
```

## 5) Data ingestion и source sync

```mermaid
flowchart LR
    MZ["scripts/ingest-minzdrav.ts"] --> A["GetJsonClinrecsFilterV2"]
    MZ --> B["GetClinrec2"]
    MZ --> C["GetClinrecPdf"]
    A --> D["guidelines"]
    B --> E["guideline_sections"]
    C --> F["recommendation_chunks"]
    F --> G["recommendation_chunks_fts"]

    SY["/api/sources/sync -> source-sync.ts"] --> S1["minzdrav"]
    SY --> S2["russco"]
    SY --> S3["nccn_patient/professional"]
    SY --> S4["esmo/asco/femb"]
    SY --> S5["pubmed"]
    S1 --> SD["source_documents + source_documents_fts"]
    S2 --> SD
    S3 --> SD
    S4 --> SD
    S5 --> SD
    SY --> LOG["source_sync_logs"]
```

## 6) Граница MVP vs Post-MVP (для слайда)

```mermaid
flowchart LR
    subgraph MVP["MVP (сделано)"]
      M1["Doctor + Patient UI"]
      M2["Rule engine + retrieval modes"]
      M3["SQLite + FTS5"]
      M4["Минздрав ingestion + source-catalog sync"]
      M5["Benchmark + метрики"]
      M6["LLM-слой с fallback"]
    end

    subgraph NEXT["Post-MVP (следующий этап)"]
      P1["МИС/EMR интеграции"]
      P2["OCR pipeline для сканов"]
      P3["Роли, SSO, аудит"]
      P4["Масштабирование и SLA"]
      P5["Регуляторный контур"]
    end
```

## Как использовать в презентации
- Слайд 1-2: схема 1.
- Слайд 3: схема 2.
- Слайд 5-6: схема 3 + схема 4.
- Слайд 4 и 8: схема 5.
- Слайд 9: схема 6.
