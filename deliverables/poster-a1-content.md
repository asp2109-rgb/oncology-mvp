# Poster A1 Content Draft

## Title
AI assistant for retrospective verification of oncology treatment protocol compliance

## Objective
Reduce manual burden of guideline checks and improve transparency of treatment-path validation.

## Pipeline
- Ingestion: Minzdrav API (`status=0`, `status=4`, `C00-D48`)
- Normalization: sections and recommendation chunking
- Retrieval: FTS + rule index providers
- Inference: deterministic validation + optional LLM explanation
- Outputs: doctor report, patient explanation, benchmark dashboard

## Validation Metrics
- protocol_match_accuracy
- mismatch_detection_precision / recall
- median_validation_time
- case_coverage
- source_traceability_rate

## MVP Screens
- `/doctor`
- `/patient`
- `/benchmark`
- `/sources`

## Safety framing
- de-identified input only
- no autonomous treatment assignment
- physician remains final decision-maker

## QR blocks
- `QR-1` demo link
- `QR-2` documentation link
