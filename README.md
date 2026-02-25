# MVP проверки онколечения

Next.js fullstack MVP для ретроспективной проверки протоколов онколечения на соответствие клиническим рекомендациям.

## Что реализовано

- Два интерфейса:
  - `/doctor` — проверка протокола: `rules + adaptive retrieval` с выбором источников по чекбоксам, retrieval-mode и online fallback
  - `/patient` — объяснение простым языком на основе того же результата валидации
- Панель бенчмарка:
  - `/benchmark` с запуском и просмотром последнего отчета
- Реестр источников:
  - `/sources` со списком версий рекомендаций, source-catalog и статусом синхронизации
- Загрузка и индексация КР из API Минздрава:
  - `GetJsonClinrecsFilterV2`
  - `GetClinrec2`
  - `GetClinrecPdf`
- Unified source sync:
  - коннекторы `minzdrav`, `russco`, `nccn_patient`, `nccn_professional`, `esmo`, `asco`, `pubmed`, `femb`
- Интеграция clinicaltrials.gov:
  - `GET /api/trials/search`
- “Всеядный” парсинг входа:
  - `POST /api/case/parse` (файл и/или текст)
- API эндпоинты:
  - `POST /api/doctor/validate`
  - `POST /api/patient/explain`
  - `POST /api/guidelines/search`
  - `GET /api/sources/status`
  - `POST /api/sources/sync`
  - `POST /api/case/parse`
  - `GET /api/trials/search?query=...&recruiting=true`
  - `POST /api/benchmark/run`
  - `GET /api/benchmark/latest`
  - `GET /api/health`

## Стек

- Next.js 16, TypeScript
- Supabase (Postgres + FTS + RPC), schema: `supabase/onco_schema.sql`
- Rule engine + OpenAI LLM слой для doctor-mode и patient-mode
  - doctor-mode: `rules + RAG + KAG + LLM`
- Парсинг входных документов: `pdf-parse`, `mammoth`, `word-extractor`

## Быстрый старт

```bash
npm install
npm run db:init
npm run ingest:minzdrav
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Переменные окружения

Обязательно для Supabase режима:

```bash
ONCO_DB_PROVIDER=supabase
ONCO_DB_STRICT_SUPABASE=false
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
# или publishable/anon ключ (если вы разрешили доступ политиками)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_BATCH_SIZE=500

OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
PUBLIC_DEMO_URL=https://your-demo-url
PUBLIC_DOCS_URL=https://your-docs-url
```

Перед первым запуском примените SQL схему в Supabase SQL Editor:

```sql
-- файл: supabase/onco_schema.sql
```

`OPENAI_API_KEY` обязателен для `/api/patient/explain` и `/api/doctor/validate`.

## Скрипты

- `npm run dev` — запуск приложения
- `npm run build` — build
- `npm run lint` — lint
- `npm run test` — unit-тесты
- `npm run db:init` — проверка подключения и инициализация провайдера БД
- `npm run db:supabase:check` — диагностика Supabase-подключения и скорости ключевых запросов
- `npm run ingest:minzdrav` — загрузка онко-КР (`C00-D48`, статусы 0 + 4)
- `npm run sources:sync` — синхронизация внешних источников (скачать все доступное + online_only fallback)
- `npm run benchmark:sample` — запуск бенчмарка на встроенных наборах
- `npm run qr:generate` — генерация `public/qr/qr-demo.png` и `public/qr/qr-docs.png`

## Форматы входа для `/api/case/parse`

- Рекомендуемые: `pdf`, `doc`, `docx`, `txt`, `md`, `csv`, `tsv`, `json`, `rtf`, `xml`, `html`, `yaml`, `yml`, `log`, `ini`
- Для прочих форматов работает best-effort fallback (текстовое декодирование)
- Для сканированных PDF (изображения без текстового слоя) потребуется OCR

## Ограничения

- Входные кейсы должны быть обезличены.
- MVP не назначает лечение автономно.
- Финальное клиническое решение остается за врачом.

## Деплой на Render (free)

1. Убедитесь, что в Supabase применена схема `supabase/onco_schema.sql`.
2. На Render создайте сервис через Blueprint из репозитория (файл `render.yaml`).
3. В Environment добавьте:
- `ONCO_DB_PROVIDER=supabase`
- `ONCO_DB_STRICT_SUPABASE=true`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (рекомендуется)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (опционально, для client-side вызовов)
- `SUPABASE_BATCH_SIZE=500`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (по умолчанию `gpt-4o-mini`)

## Артефакты

- `docs/architecture.md`
- `deliverables/presentation-9-slides.md`
- `deliverables/poster-a1-content.md`
- `deliverables/tech-stack-and-mvp-boundary.md`
- `deliverables/expert-docs-pack-ru.md`
- `deliverables/architecture-schemes-ru.md`
