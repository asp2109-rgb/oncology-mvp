# MVP проверки онколечения

Next.js fullstack MVP для ретроспективной проверки протоколов онколечения на соответствие клиническим рекомендациям.

## Что реализовано

- Два интерфейса:
  - `/doctor` — проверка протокола: rule-based результат + LLM-аудит (openai/model/response_id)
  - `/patient` — объяснение простым языком на основе того же результата валидации
- Панель бенчмарка:
  - `/benchmark` с запуском и просмотром последнего отчета
- Реестр источников:
  - `/sources` со списком версий рекомендаций и ссылками
- Загрузка и индексация КР из API Минздрава:
  - `GetJsonClinrecsFilterV2`
  - `GetClinrec2`
  - `GetClinrecPdf`
- Интеграция clinicaltrials.gov:
  - `GET /api/trials/search`
- “Всеядный” парсинг входа:
  - `POST /api/case/parse` (файл и/или текст)
- API эндпоинты:
  - `POST /api/doctor/validate`
  - `POST /api/patient/explain`
  - `POST /api/guidelines/search`
  - `POST /api/case/parse`
  - `GET /api/trials/search?query=...&recruiting=true`
  - `POST /api/benchmark/run`
  - `GET /api/benchmark/latest`
  - `GET /api/health`

## Стек

- Next.js 16, TypeScript
- SQLite + FTS5 (`better-sqlite3`)
- Rule engine + OpenAI LLM слой для doctor-mode и patient-mode
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

Опционально:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
ONCO_DB_PATH=/absolute/path/to/oncology.db
PUBLIC_DEMO_URL=https://your-demo-url
PUBLIC_DOCS_URL=https://your-docs-url
```

`OPENAI_API_KEY` обязателен для `/api/patient/explain` и `/api/doctor/validate`.

## Скрипты

- `npm run dev` — запуск приложения
- `npm run build` — build
- `npm run lint` — lint
- `npm run test` — unit-тесты
- `npm run db:init` — инициализация схемы БД
- `npm run ingest:minzdrav` — загрузка онко-КР (`C00-D48`, статусы 0 + 4)
- `npm run db:prepare-deploy` — подготовка облегченной базы `data/oncology.deploy.db` для деплоя
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

1. Подготовьте deploy-базу:
```bash
npm run db:prepare-deploy
```
По умолчанию сохраняются 10 последних КР. Для большего охвата:
```bash
ONCO_KEEP_GUIDELINES=18 npm run db:prepare-deploy
```
2. Убедитесь, что в репозитории есть:
- `render.yaml`
- `data/oncology.deploy.db`
3. На Render создайте сервис через Blueprint из репозитория (файл `render.yaml` применится автоматически).
4. При необходимости добавьте в Environment:
- `OPENAI_API_KEY` (обязателен для patient-mode)
- `OPENAI_MODEL` (по умолчанию `gpt-4o-mini`)

## Артефакты

- `docs/architecture.md`
- `deliverables/presentation-9-slides.md`
- `deliverables/poster-a1-content.md`
