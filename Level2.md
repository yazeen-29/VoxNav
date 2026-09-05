# Implementation Spec: Alzheimer's Adaptive Care Platform
**Purpose of this document:** Hand this to a coding agent (Claude Code, Cursor, etc.) as the single source of truth to build a production-grade MVP. It defines architecture, data contracts, module sequencing, and acceptance criteria so the agent can build autonomously with minimal re-prompting.

---

## 0. Product Summary (give this context first)

Build a mobile-first care platform for Alzheimer's patients and their caregivers that replaces static record-keeping with a **living clinical signal system**. The system passively collects behavioral/sensor data, cross-references it against evidence-based clinical rules (not black-box ML), and surfaces actionable flags to caregivers and clinicians — while also tracking caregiver wellbeing as a first-class metric.

**Non-negotiable constraint:** No hardcoded/mocked data anywhere in the running app. Every displayed value must trace to a database write originating from a real sensor reading, a real user input, or a real public dataset/API call used for calibration.

---

## 1. Tech Stack (lock this in before building)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React Native + Expo | Cross-platform, `expo-sensors` gives immediate accelerometer/gyroscope/light-sensor access |
| Backend/DB | Supabase (Postgres + Auth + Realtime + Row-Level Security) | Fast to stand up, real relational DB, built-in auth, RLS enforces patient/caregiver data isolation for free |
| File storage | Supabase Storage | Voice memos, video capacity statements, house-scan photos |
| Speech-to-text | AssemblyAI or Google Cloud Speech-to-Text (word-level timestamps required) | Needed for real pause-pattern computation, not simulated |
| Computer vision (contrast scan) | OpenCV (via a lightweight Python microservice) or on-device via `react-native-vision-camera` + a contrast-delta algorithm | Keep it simple: edge/contrast delta, not a trained model, for defensibility and speed |
| PDF generation | `pdf-lib` or `react-native-html-to-pdf` | Auto-generated visit summaries |
| Data model standard | FHIR R4 resource shapes (Patient, Condition, MedicationRequest, Observation, Consent) | Interoperability story + forces disciplined schema |
| Hashing/timestamping (capacity statements) | SHA-256 + a free trusted timestamp authority (e.g., OpenTimestamps) | Tamper-evidence without needing real blockchain infra |
| Notifications | Expo push notifications | Native to the stack |

---

## 2. Data Architecture (build this FIRST — everything else depends on it)

### 2.1 Core tables (Postgres via Supabase)

- `patients` — FHIR-lite Patient resource (id, name, dob, diagnosis_stage, created_at)
- `caregivers` — id, name, relationship_to_patient, auth_user_id
- `patient_caregiver_links` — many-to-many, permission level (view/edit/clinician)
- `medications` — FHIR MedicationRequest shape: drug name, dose, schedule, prescriber, **anticholinergic_burden_score** (populated via Layer lookup, see §5.2)
- `observations` — the universal signal table. Every passive/active data point lands here as a row:
  - `id, patient_id, type (enum: gait, typing_latency, speech_pause, self_report_wellness, emotional_tone, pain_score, ambient_light, sleep_hours), value (jsonb), source (enum: sensor/manual/derived), recorded_at`
  - This single flexible table is what prevents feature-siloed hardcoded arrays — every module reads/writes here.
- `episodes` — logged behavioral events: `patient_id, trigger_note, outcome (calm/agitated/confused), linked_flag_id (nullable), timestamp`
- `flags` — system-generated alerts: `patient_id, flag_type (infection_risk/sundowning_risk/anosognosia_gap/anticholinergic_burden/pain_detected), evidence (jsonb — the raw observation IDs that triggered it), status (open/acknowledged/resolved), created_at`
- `caregiver_checkins` — `caregiver_id, mood_score, sleep_hours, date`
- `narrative_entries` — `patient_id, tag (person/place/era/value), transcript, audio_url, recorded_at`
- `capacity_statements` — `patient_id, video_url, transcript, sha256_hash, timestamp_authority_receipt, recorded_at`
- `hazard_scans` — `patient_id, photo_url, contrast_score, flagged_area (jsonb coordinates), suggestion_text, scanned_at`
- `consent_records` — required before any sensor collection starts: `patient_id, consent_type, granted_by, granted_at`

### 2.2 Row-Level Security
Every table filtered by `patient_caregiver_links` — a caregiver can only read/write rows for patients they're linked to. Build this policy layer before any UI screen, not after.

### 2.3 Calibration datasets (so thresholds are evidence-based, not guessed)
Agent should fetch/reference these once during setup to derive default z-score thresholds, then store thresholds as configurable rows in a `calibration_baselines` table (not hardcoded constants in code):
- DementiaBank Pitt Corpus — speech pause norms
- PhysioNet gait/actigraphy datasets — movement irregularity norms
- Public ACB (Anticholinergic Cognitive Burden) scale reference table — for medication scoring

---

## 3. Build Sequence (in order — each phase should be fully working with real data before moving on)

### Phase 1 — Auth, consent, and patient file CRUD
- Supabase auth (email or magic link)
- Consent screen flow — must be completed before any sensor permission request fires
- Patient file screens bound live to `patients`, `medications` tables
- Acceptance test: create a patient, add a medication, refresh app, data persists from DB (not local state)

### Phase 2 — Medication engine + ACB scoring
- On medication add, look up drug name against ACB reference table (seed this table from the public scale — a real static reference table is fine, this isn't "hardcoded data," it's a clinical reference dataset)
- Compute cumulative burden score, write to `medications.anticholinergic_burden_score`
- Trigger a `flags` row if cumulative score crosses the published high-burden threshold
- Acceptance test: adding two moderate-burden drugs together produces a real flag row, visible to caregiver

### Phase 3 — Passive sensor pipeline
- `expo-sensors` accelerometer/gyroscope stream → sampled and aggregated (e.g., variance over a 60-second walking window) → written to `observations` as `type=gait`
- Keystroke timing capture on any text field → `type=typing_latency`
- Voice check-in recording → sent to speech-to-text API → compute pause length/frequency from returned word timestamps → `type=speech_pause`
- Ambient light sensor reading tagged alongside every `episodes` entry → `type=ambient_light`
- Acceptance test: walk with the phone, see a real new row appear in `observations` with a live-computed value — no seed data

### Phase 4 — Baseline + anomaly detection engine (rule-based, transparent)
- Nightly job (Supabase Edge Function on a cron schedule) computes 7-day rolling mean/stddev per patient per observation type → writes to `calibration_baselines`
- Real-time check on each new observation: compute z-score against that patient's own baseline
- If ≥2 signal types simultaneously exceed threshold within a rolling window → write `flags` row, `flag_type=infection_risk`, with explicit copy: "Sudden change detected — consider ruling out infection before assuming progression"
- Acceptance test: manually simulate a rough-walking session + slow speech check-in, confirm a real flag fires from the actual computed z-scores

### Phase 5 — Sundowning predictor
- Join `episodes` (outcome=agitated) with `observations` (ambient_light, time-of-day) over time
- Simple logistic regression or even a rolling-frequency-by-hour-bucket model (start simple — a frequency histogram is defensible and explainable) to compute a personal "risk window"
- Push a preemptive notification 30 minutes before the computed risk window
- Acceptance test: after ≥5 logged agitation episodes, the predicted window should reflect the actual clustering in the data, not a fixed 4–6pm default

### Phase 6 — Anosognosia gap metric
- Self-report wellness captured via a simple daily 1–5 tap-in (`type=self_report_wellness`)
- Compute gap = normalized self-report score vs. normalized composite of gait/speech/typing deviation from baseline
- Visualize as a two-line time-series chart (self-report vs. measured) — the widening-gap-over-time IS the product's signature visual
- Acceptance test: gap value recalculates correctly whenever either input changes

### Phase 7 — Emotional-tone log + validation-response assist
- Episode logging UI (calm/agitated/confused + trigger note)
- Deterministic decision tree (stored as data rows in a `response_scripts` table, not hardcoded in UI code, so it's editable by clinicians) mapping trigger-type → validation-therapy script
- Every script use auto-writes back into `episodes` to close the loop
- Acceptance test: script shown should be driven by a DB query on trigger_note tag, not a switch-statement in the frontend

### Phase 8 — Nonverbal pain detection
- Short camera capture flow, scored against PAINAD rubric criteria (breathing, facial grimacing, vocalization, body language, consolability) — implement as a structured 5-question caregiver-observed checklist initially (fast, defensible, no CV model needed for MVP); flag CV-based automation as a v2 roadmap item
- Write score to `observations`, type=pain_score
- If pain score high while an `agitated` episode was logged same-day → auto-append a note suggesting pain reassessment before behavioral intervention

### Phase 9 — Environmental hazard scan
- Camera capture → basic contrast-delta computation between adjacent image regions (OpenCV Sobel/edge detection is sufficient) → flag low-contrast zones
- Store flagged coordinates + auto-generated suggestion text (from a small rules table: low-contrast floor→stair edge tape, low-contrast plate→colored placemat, etc.)

### Phase 10 — Narrative Identity Bank
- Structured recording flow tagged by category
- Searchable via simple full-text search on `transcript` column (Postgres `tsvector` — real search, not a static list)

### Phase 11 — Capacity statement recorder
- Video capture → SHA-256 hash computed client-side → submitted to a free trusted timestamp authority (OpenTimestamps API) → receipt stored alongside video
- Acceptance test: hash recomputed from stored video must match stored hash exactly (tamper-evidence proof)

### Phase 12 — Caregiver burnout correlation
- Daily caregiver check-in (mood 1–5, sleep hours)
- Overlay chart: caregiver stress trend vs. patient agitation-episode frequency, same time axis, pulled from two real tables via a join query
- If both trend upward together for N consecutive days → trigger a respite-care suggestion notification

### Phase 13 — Auto-generated visit summary (PDF)
- Query last N days of `observations`, `flags`, `episodes`, `medications` changes
- Populate a PDF template via `pdf-lib` — this should be genuinely useful standalone, demo it early since it's low-effort/high-impact

---

## 4. Cross-cutting Engineering Requirements (apply to every phase)

- **No local component state pretending to be data.** Every list/chart component must be backed by a Supabase query with loading and empty states — no `const dummyData = [...]` anywhere in the codebase. Agent should treat any hardcoded array as a build error.
- **RLS enforced at the DB layer**, not just hidden in the UI — test by attempting cross-patient reads with a second test account.
- **Every flag and score must store its evidence** (`evidence jsonb` referencing the observation IDs used) — this is what makes the system explainable to a clinician instead of a black box, and it's cheap to add now.
- **Thresholds live in DB config tables**, not code constants, so clinicians/testers can tune them without a redeploy.
- **Idempotent Edge Functions** for the nightly baseline job — must be safely re-runnable.
- **Consent gating**: no sensor collection code path should be reachable before a `consent_records` row exists for that data type.

---

## 5. Suggested Delivery Order for a Time-Boxed Build (e.g., hackathon)

If time is constrained, build in this priority order and stop wherever time runs out — each stopping point is still a coherent, demoable product:

1. Phases 1–2 (file + medication/ACB engine) — credible baseline
2. Phase 3 (real sensor capture) — this is the "wow, it's really reading my phone" moment
3. Phase 4 (anomaly + infection flag) — the core clinical differentiator
4. Phase 7 (emotional-tone log) — cheap to build, high narrative value
5. Phase 6 (anosognosia gap chart) — the single most novel *visual* for a pitch
6. Everything else as "built" bonus or roadmap slide, in whatever time remains

---

## 6. What to Tell the Agent Explicitly at Build Start

> "Build against Supabase from the first commit. Every screen must query real tables — treat placeholder/mock data as a defect, not a shortcut. Implement Phase 1 and 2 fully with passing acceptance tests before starting Phase 3. Confirm each phase's acceptance test passes before moving to the next."
