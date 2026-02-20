# Presentation (9 slides)

1. Problem: guideline adherence gap in oncology workflows
2. Solution: AI protocol validation assistant (doctor + patient modes)
3. Input-Process-Output model and system boundaries
4. Data strategy: Minzdrav oncology corpus + retrospective timeline + synthetic scenarios
5. Architecture: Next.js + SQLite FTS + rule engine + optional LLM
6. Live demo flow: `/doctor` -> `/patient` -> `/benchmark` -> `/sources`
7. Metrics: accuracy, precision/recall mismatch, latency, coverage, traceability
8. Risks and controls: safety, non-autonomous usage, de-identified cases
9. Roadmap: pgvector/RAG plugin expansion, deeper case datasets, pilot workflow integration
