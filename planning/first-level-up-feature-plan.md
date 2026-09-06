# First-Level-Up Plan: Integrating VOX Cognitive-Support Components into the Alzheimer's Care Platform

## Implementation update — 2026-09-06

The agreed first delivery is implemented locally in `mobile-companion/`: named medication routines, a patient-session privacy gate, a deterministic four-hour repeat-log check, and a recall dialog capped at two facts. Checks and linked flags are stored with Expo SecureStore; pending decisions survive restart, and the patient can keep the earlier record or explicitly record another entry. See `../mobile-companion/MEDICATION_TEST_PLAN.md` for acceptance steps and `PROJECT_STATUS.md` for validation status.

This increment preserves the existing local-first privacy architecture. It does **not** introduce plaintext Supabase care tables or depend on the missing `alzheimers-care-app-implementation-spec.md`. The schema integrations, caregiver delivery and additional action types described below remain future proposals rather than implemented capabilities. A phone-local trusted-person prototype is now implemented separately: it requires an explicit patient action and consented enrollment, keeps raw photos off the server and deletes its temporary camera files after processing. It is not anti-spoofing or identity proof. The recall wording now reports what was **recorded**, not whether medication was actually consumed.

The original broader proposal follows for reference.

**Context this plan assumes:** the base app spec (`alzheimers-care-app-implementation-spec.md`) is already the target architecture — Supabase/Postgres, `observations`/`episodes`/`flags` tables, FHIR-lite shapes. This document does not replace that spec; it slots three VOX-derived components into it as the next build increment.

---

## Why these 3, and why together

The base spec is strong on **passive monitoring** (sensors → anomaly flags → caregiver alerts). What it's missing — and what the VOX documents solve — is **real-time, in-the-moment cognitive support while the patient is mid-action**, delivered with a privacy discipline that makes it trustworthy rather than surveillance-y. Combined, these three features move the product from "a dashboard that tells caregivers what happened" to "a companion that gently catches confusion as it happens and tells the patient/caregiver exactly enough to resolve it — nothing more."

This is the single most defensible "no one else is doing this" claim you can make, because it's built on a real, named clinical problem (perseveration and repeated/contradictory actions in dementia — e.g., calling the same person five times, or setting out to do something already done) rather than a vague "AI monitoring" claim.

The three features, in build order:

1. **Action–Situation Consistency Engine** — the flagship differentiator
2. **Minimum-Sufficient-Context Recall Assist** — what fires when #1 detects a mismatch
3. **Privacy Gateway + Trusted-Person Alert** — the trust layer everything else passes through, plus the glasses/camera stranger-detection feature as its first concrete use case

---

## Feature 1 — Action–Situation Consistency Engine

### What it does
VOX maintains a compact "active situation" state built from the patient's recent digital/logged actions (calls made, tasks logged, reminders completed, appointments). When the patient performs a new action, the system checks it against the active situation and computes a **discontinuity score**. A high score means the action likely reflects confusion (e.g., patient is about to call a number already called 20 minutes ago; marks "took morning medication" as not-done when it was already logged done; tries to leave for an appointment that was already completed).

### Why this is the clinical novelty, not just a tech feature
This directly targets **perseveration and short-term memory failure loops** — one of the most exhausting, hard-to-manage symptoms for caregivers, and one that existing dementia apps do not address in real time. It also feeds your existing **anosognosia gap metric** (Phase 6 of the base spec) with a much richer, event-level signal instead of just sensor drift.

### Integration into existing schema
Add two tables (no changes needed to existing ones):
- `situations` — `id, patient_id, topic, extracted_facts (jsonb), status (active/resolved), confidence, created_at, expires_at`
- `consistency_checks` — `id, patient_id, action_type, action_payload (jsonb), matched_situation_id (nullable), discontinuity_score, decision (consistent/discontinuity), created_at`
- Every row in `consistency_checks` with `decision=discontinuity` writes a linked row into the existing `flags` table (`flag_type=action_discontinuity`) — this reuses your Phase 4 flag pipeline rather than inventing a parallel one.

### Tech pieces (pretrained, no training required for MVP)
- Sentence embedding: `sentence-transformers/all-MiniLM-L6-v2` for turning both the active situation and the new action into vectors
- Cross-encoder reranker (any Sentence-Transformers cross-encoder model) for precise action-vs-situation scoring when embedding similarity alone is ambiguous
- Deterministic rule layer on top for the handful of `action_type`s that matter most in v1 (see below) — keep this rule-based and transparent, not a black box, matching the base spec's "explainable, not ML black-box" principle

### Exact build steps
1. Define a fixed enum of `action_type`s to support in v1 — start narrow and real: `medication_taken`, `call_made`, `appointment_action`, `left_home` (from geofence event already in base spec). Do not try to generalize to arbitrary free text yet.
2. On each new action event, extract or fetch the most recent `situations` row of matching topic (e.g., a `medication_taken` action checks against the day's medication schedule state, not a full semantic search — this keeps v1 fast and reliable).
3. Compute discontinuity via simple, explainable rules first (e.g., "medication already marked taken in the last 4 hours" = discontinuity), and only fall back to the embedding/cross-encoder pipeline for the fuzzier `appointment_action` and `call_made` types where free-text matching is genuinely needed.
4. Write the check result to `consistency_checks`; on discontinuity, create the `flags` row and immediately hand off to Feature 2.
5. **Acceptance test:** log "took morning medication" twice within 2 hours from the test device → a real discontinuity flag is created from the actual timestamp comparison, not a scripted demo response.

---

## Feature 2 — Minimum-Sufficient-Context Recall Assist

### What it does
When Feature 1 flags a discontinuity, don't dump the patient's full history at them (confusing and undignified) and don't just say "you already did that" (patronizing, can trigger distress). Instead, retrieve the **smallest set of facts that resolves the confusion**, check if that set is sufficient, and only add more if it isn't.

### Why this matters clinically
This is the dignity-preserving mechanism the hackathon brief explicitly asks for. A gentle "You already had your morning pills at 8:15 — you're all set" is fundamentally different in emotional impact from a bare notification or from nothing at all. It also gives the caregiver a **ready-made de-escalation script** at the exact moment they need one, extending your existing Phase 7 validation-response assist rather than duplicating it.

### Integration into existing schema
- Reuse `response_scripts` from base spec Phase 7 as the output shape.
- Add `context_facts_used (jsonb)` to the `flags` row so every surfaced message stores exactly which facts were shown — this is your audit trail and demo-ability proof (judges can ask "why did it say that" and you have a real answer).

### Exact build steps
1. On a `flags` row of type `action_discontinuity`, pull the small candidate fact set from the linked `situations`/`observations`/`episodes` rows (already scoped to that patient/topic — no broad search needed since Feature 1 already narrowed it).
2. Rank candidates with the same cross-encoder from Feature 1 if more than 2–3 candidates exist.
3. Apply a hard **context budget of 2–3 facts** (per VOX doc's recommended MVP default) — stop as soon as the fixed sufficiency rule is met (e.g., "time + action confirmed" = sufficient for medication; "date + accompanying person" = sufficient for appointments).
4. Render as a single calm, first-person-to-patient message on the patient's device AND a caregiver-facing card showing the same facts plus the discontinuity reason.
5. **Acceptance test:** trigger the medication double-log scenario from Feature 1 → confirm the message shown contains exactly the 1–2 facts needed (time of first log) and nothing else from the patient's broader history.

---

## Feature 3 — Privacy Gateway + Trusted-Person Alert

### What it does
Two parts that share one architectural principle (a hard permission/purpose gate that every other feature must pass through):

**3a. Privacy Gateway (structural, applies to Features 1 & 2 too):**
Every context request — including the ones Feature 2 just made — passes through an explicit permission+purpose check before touching real data. Concretely: an `allowed_action_context` config table maps each `action_type` to which tables it's allowed to query (e.g., `medication_taken` checks may only ever read `medications`/`observations`, never `narrative_entries` or `capacity_statements`). This is cheap to add now and is a strong, concrete answer to "how do you handle sensitive data" in a pitch — most competing apps have no answer beyond "we encrypt it."

**3b. Trusted-Person Alert (concrete, demoable use case of the gateway):**
Phone camera (no real glasses needed for a hackathon) captures a face, converts it to an embedding via a pretrained model, compares against the patient's enrolled trusted-person embeddings stored on-device, and — only on no-match — sends a guardian notification containing an event record (`unfamiliar_person, timestamp`), never the raw image. This directly answers the brief's "help individuals feel comfortable... reduce impact... support the people around them" for the safety/dignity dimension.

### Why this matters
This is what makes the whole system defensible rather than just "another app with camera access." The stated principle — **raw biometric data never leaves the device; only a minimal event crosses the gateway** — is a genuinely strong, specific privacy claim you can state plainly to judges, not a vague "we care about privacy" line.

### Integration into existing schema
- `trusted_persons` — `id, patient_id, name, relationship, face_embedding (stored locally / or encrypted-at-rest if server-synced), enrolled_at`
- `stranger_events` — `id, patient_id, timestamp, match_status (no_match), guardian_notified_at` — **no image or embedding stored here**, only the event
- `allowed_action_context` — `action_type, allowed_tables (jsonb), max_facts (int)` — the config table Feature 1/2 must check before querying anything

### Tech pieces
- Face embedding: DeepFace (Python) as the framework wrapper, backed by ArcFace or FaceNet — DeepFace lets you swap backends without re-architecting
- On-device or local-server matching only — never send raw frames to a third-party cloud API
- Simple cosine similarity threshold for match/no-match, calibrated against a small enrollment set (3–5 photos per trusted person minimum for a stable embedding)

### Exact build steps
1. Build `allowed_action_context` first and retrofit Features 1 & 2 to check it before their queries — this ordering matters: build the gate before the things it gates, or it becomes an afterthought bolt-on (which defeats the "architectural, not cosmetic" claim).
2. Enrollment flow: capture 3–5 photos per trusted person → compute embeddings via DeepFace → store locally (or encrypted server-side for the demo, clearly labeled as a production TODO to move fully on-device).
3. Live capture flow: camera frame → face detection → embedding → cosine similarity against all enrolled embeddings → threshold decision.
4. On no-match: write `stranger_events` row, push guardian notification with only the event fields — explicitly do not attach the photo, to make the privacy claim literally true in your own database, not just in the pitch.
5. **Acceptance test:** enroll yourself as trusted, have a second person's face tested live → confirm a real `stranger_events` row is created with no image reference, and the guardian device receives only the structured event.

---

## Build order for a time-boxed sprint

1. `allowed_action_context` table + gate logic (small, foundational, ~half a day)
2. Feature 1, rule-based path only (`medication_taken` discontinuity) — this alone is demoable and novel
3. Feature 2 for that same medication scenario, hard-capped at 2 facts
4. Feature 3b (trusted-person alert) — independently buildable in parallel if you have a second engineer, since it doesn't depend on 1/2
5. Feature 1's embedding/cross-encoder path for `call_made`/`appointment_action` — only if time remains after 1–4 are solid

## Demo script this unlocks
"Watch: the patient logs their medication as taken. Twenty minutes later, confused, they try to log it again. The system doesn't scold them or dump their whole day at them — it quietly confirms 'you took this at 8:15, you're all set' using only the two facts needed to resolve it. And separately — if someone the patient doesn't recognize approaches, their guardian gets notified instantly, with no photo ever leaving the device." That's a two-minute demo that no other submission in this track will be able to match feature-for-feature.
