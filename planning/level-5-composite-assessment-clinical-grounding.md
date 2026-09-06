# Level 5: Composite Assessment Engine with Clinical Report Grounding

**Framing (important for the pitch, not just internally):** this feature does not diagnose. It produces a periodic composite status snapshot from data the app already collects, and lets an uploaded clinical document (doctor's note, lab result, MMSE/MoCA score) add context that changes how the app *weighs and explains* its own signals — always surfaced to a human (caregiver/clinician) for interpretation, never auto-acting on a diagnosis. Frame it as "we make the existing data richer for the doctor," not "we diagnose."

---

## 1. What this adds on top of everything already built

Right now the system only reacts: Phase 4 fires on sudden deviation, Feature 1 (VOX) fires on a discontinuity, the CDT (if built) produces a one-off score. Nothing currently produces a **periodic, composite "here's the overall picture" snapshot**, and nothing lets a real clinical document change how the app interprets itself.

This closes both gaps as one connected feature.

---

## 2. Data model additions

- `clinical_documents` — `id, patient_id, file_url, document_type (enum: diagnosis_letter, lab_result, cognitive_test_score, prescription_note, other), uploaded_by, uploaded_at, ocr_status (pending/done/failed)`
- `extracted_clinical_facts` — `id, document_id, patient_id, fact_type (enum: mmse_score, moca_score, diagnosis_stage, lab_finding, medication_change, clinician_note), value (jsonb), confidence, extracted_at`
- `composite_snapshots` — `id, patient_id, period_start, period_end, sensor_summary (jsonb), cdt_score (nullable), anosognosia_gap (nullable), flag_count_by_type (jsonb), clinical_context_used (jsonb — references to extracted_clinical_facts), narrative_summary (text), created_at`
- `recalibration_rules` — `id, patient_id, trigger_fact_type, adjustment_type (threshold_shift/flag_suppress_with_note/weight_change), parameters (jsonb), source_document_id, applied_at, active (bool)`

Every recalibration rule stores which document justified it (`source_document_id`) — this is non-negotiable. No threshold or interpretation should ever change without a traceable clinical source, and this record is exactly what makes the feature explainable rather than a black box quietly reinterpreting itself.

---

## 3. Pipeline: from upload to recalibration

```
Caregiver uploads document (PDF/photo)
        ↓
OCR + text extraction (Phase per §4)
        ↓
LLM-assisted structured fact extraction, scoped prompt (per §5)
        ↓
Facts written to extracted_clinical_facts (status: pending review)
        ↓
Caregiver/clinician confirms facts are read correctly  ← human checkpoint, mandatory
        ↓
Confirmed facts eligible to create recalibration_rules
        ↓
Recalibration rules adjust interpretation (not raw data) going forward
```

The mandatory human-confirmation checkpoint is the most important line in this spec. OCR and LLM extraction on real medical documents will make mistakes; nothing should be automatically trusted from an uploaded document until a person confirms the extracted fact is correct.

---

## 4. Document ingestion (OCR)

- Use a general OCR pipeline (e.g., Tesseract for typed text, or a cloud OCR API for scanned/handwritten clinical notes if typed-text-only OCR proves insufficient in testing)
- Store the raw extracted text alongside the structured facts for audit — if the LLM extraction step gets something wrong, you need the raw text to see why
- Flag low-confidence OCR (blurry photo, poor scan) for manual re-entry rather than silently guessing

---

## 5. Structured fact extraction (LLM, tightly scoped — same discipline as the VOX docs)

Prompt the extraction model with the OCR'd text only, and an explicit closed schema — do not let it free-associate:

```
Extract only the following, if present:
- test_name (e.g., MMSE, MoCA)
- score
- score_date
- diagnosis_stage (if explicitly stated)
- named_lab_finding (e.g., "B12 deficiency", "UTI positive")
- medication_change (drug name + action: started/stopped/dose changed)

Do not infer anything not explicitly stated in the text.
Return null for any field not clearly present.
```

This mirrors the "LLM does language understanding, the system owns the decision logic" separation you already established for the VOX components — same principle, same discipline, applied to documents instead of messages/calendar.

---

## 6. Recalibration logic (the genuinely novel part) — kept conservative by design

Three adjustment types only, deliberately narrow rather than open-ended:

**6.1 Threshold shift** — if a confirmed diagnosis_stage or MMSE/MoCA score indicates the patient is at a more advanced stage than the app's current behavioral baseline assumes, widen the Phase 4 anomaly z-score threshold slightly (a patient already known to be more advanced should not trigger a flag for every incremental behavioral change — this reduces alert fatigue rather than causing it).

**6.2 Flag context annotation, never silent suppression** — if a lab_finding explains a symptom cluster (e.g., a confirmed UTI already being treated), do **not** suppress the Phase 4 infection-risk flag outright. Instead, annotate it: "Infection risk flag — note: patient has a documented UTI diagnosis as of [date], already being treated." The flag still fires, still gets logged, but the caregiver sees the clinical context alongside it. Silently suppressing a safety flag because of an uploaded document is exactly the kind of thing that should make you nervous in a health app, and it's not necessary to get the value here — annotation gives the same benefit (context, not alarm fatigue) without ever hiding a signal.

**6.3 Weight change in the composite snapshot narrative** — if a confirmed MMSE/MoCA score exists, include it directly alongside the behavioral composite score in the snapshot narrative, rather than treating behavioral signals as the only input — this is what actually fulfils "customize according to that report."

**Acceptance test:** upload a sample MMSE score document, confirm the extracted fact through the human checkpoint, and verify (a) a `recalibration_rules` row is created referencing that document, (b) the next `composite_snapshots` narrative explicitly cites the MMSE score, and (c) no existing flag was silently deleted — only annotated.

---

## 7. The composite snapshot itself (the "silent regular checkup")

Runs on a fixed cadence (weekly is a sensible default) as a scheduled job, not a manual trigger — this is what makes it feel like a genuine ongoing checkup rather than another dashboard the caregiver has to remember to check.

Pulls together, for the period:
- Sensor trend summary (gait/typing/speech deviation from Phase 3/4)
- CDT score if one was completed in the period (from the earlier CDT proposal, if built)
- Anosognosia gap trend (Phase 6 / VOX Level 3)
- Count and type of flags raised, each annotated with any active clinical context (§6.2)
- Any confirmed clinical facts from the period

Produces a short, plain-language narrative summary (templated, not free-generated, to keep it predictable and clinically safe) — e.g., "This week: gait stability stable, speech pause frequency slightly elevated (within personal range), no infection-risk flags, MMSE score on file: 22/30 (as of [date])." This is the artifact you'd actually hand to a neurologist at the next visit — a genuine upgrade on Phase 13's static PDF, now grounded in real clinical data rather than just app-collected behavioral data alone.

---

## 8. Why this is a strong addition to the pitch specifically

- It's the one feature that explicitly closes the loop between "what the app observes" and "what the doctor already knows" — nothing else in the project does this.
- The mandatory human-confirmation step and the "annotate, never silently suppress" rule are the right calls both ethically and for the pitch — a judge who asks "what if your OCR misreads the document" has an actual designed-in answer, not a shrug.
- It directly answers a real caregiver pain point named in the base spec's Phase 13 motivation: doctors currently rely on family members to accurately recall and relay clinical history at every visit; this closes that gap in the other direction too — bringing what the doctor already documented back into the app's own reasoning.

## 9. What to explicitly avoid in the pitch
Don't say "the app diagnoses" or "the app adjusts its diagnosis based on your report." Say "the app incorporates your doctor's documented findings so its behavioral tracking stays consistent with what's clinically known" — same feature, correctly scoped claim.
