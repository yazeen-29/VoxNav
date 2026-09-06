# Level-Up Plan, Continued: Levels 2–4

## Implementation update — 2026-09-06

The repository now implements the local, patient-only appointment part of Level 2: scheduled manual appointments, repeated-completion recall, correction to incomplete, and a short merged medication/appointment check history. It uses an Android date/time picker and SecureStore only. The exact device acceptance flow is in `mobile-companion/LEVEL2_APPOINTMENT_TEST_PLAN.md`.

The remaining Level 2 items below still rely on data sources and systems absent from this repository: free-text call/action events, the base care-data schema, caregiver links, narrative data, hazard zones, and risk predictions. Level 3 and Level 4 remain roadmap work, except for a phone-local prototype of Level 3.3: consented trusted-person enrollment and comparison now run fully on-device, with a basic blink movement check and no retained camera photo. It is not anti-spoofing or identity proof. The prerequisite statement below describes the original proposal, not the actual capabilities currently implemented.

**Prerequisite:** Level 1 is built and its acceptance tests pass — the `allowed_action_context` gate exists, the Action–Situation Consistency Engine works for `medication_taken`, the Minimum-Sufficient-Context Assist responds to it, and Trusted-Person Alert is running on at least a phone camera. Nothing below should start until that foundation actually runs end-to-end with real data — Level 2 generalizes and hardens it; it doesn't route around gaps in it.

---

## LEVEL 2 — Generalize and connect what's already built

Level 1 deliberately kept scope narrow (one action type, rule-based, one demo scenario). Level 2's job is to widen that without re-architecting, and to wire the VOX layer into the base-spec phases that were built independently of it.

### 2.1 Generalize the Consistency Engine to free-text actions
Level 1 only handled structured `action_type`s. Now bring in the semantic path VOX describes for the fuzzier cases.
- Add LLM-based **fact extraction** (any instruction-tuned model, called with a tightly scoped prompt and only the permitted data — never the patient's full history) to turn free-text caregiver notes and call/message content into structured facts, same shape as the `situations.extracted_facts` jsonb.
- Wire the `all-MiniLM-L6-v2` embedding + cross-encoder path (already scoped in Level 1) as the default path for `call_made` and `appointment_action`, instead of the "if time remains" stretch goal it was in Level 1.
- **Acceptance test:** log a free-text note ("called the pharmacy about the refill") followed by a duplicate call 10 minutes later → discontinuity fires from real embedding similarity, not a keyword match.

### 2.2 Feed existing base-spec phases into the situation model
Right now the sundowning predictor, anosognosia gap, narrative bank, hazard scans, and capacity statements (base spec Phases 5, 6, 9, 10, 11) all write to their own tables independently. Level 2 connects them:
- **Sundowning + Consistency:** if a discontinuity fires inside the patient's predicted sundowning risk window (Phase 5), tag the flag with `context: sundowning_window` — this changes the tone of the Minimum-Context message the caregiver sees ("this may be a harder hour for them") without changing the underlying fact set.
- **Narrative Bank as a fact source:** when Minimum-Context Assist needs a calming, personal fact (not just a timestamp), let it query `narrative_entries` for a relevant, patient-specific detail (e.g., a name or memory tagged to the topic) — this is what turns a generic reassurance into a genuinely personalized one, and it's a very strong demo beat.
- **Hazard scan → situation context:** if a `left_home` discontinuity fires near a flagged hazard zone (Phase 9), escalate the guardian notification priority.
- **Acceptance test:** trigger a discontinuity during the patient's predicted risk window and confirm the caregiver-facing message text actually differs from the same discontinuity outside that window — driven by a real Phase-5 prediction, not a hardcoded string swap.

### 2.3 Audit logging and privacy metrics (from the VOX privacy doc, not yet built in Level 1)
Level 1 built the gate; Level 2 makes it *measurable*, which is what turns "we have a privacy layer" from a claim into evidence.
- `audit_log` table: `timestamp, action_type, patient_id, sources_accessed (jsonb), facts_used (jsonb), facts_shown (jsonb), purpose`
- Every Feature 1/2 pipeline run writes one row here — this is cheap since the data already exists in memory at that point, you're just persisting it.
- Build a simple internal metrics view computing, per the VOX doc's suggested metrics: unauthorized access rate (should be exactly 0 — provable, not asserted), average facts shown per discontinuity, irrelevant-context rate.
- **Acceptance test:** run 10 varied discontinuity scenarios, then query `audit_log` and show the computed metrics live — this is a genuinely compelling judge-facing artifact, since almost no one else will have real numbers instead of a slide claim.

### 2.4 Guardian permission tiers
Base spec already has `patient_caregiver_links` with a permission level field but it's not yet differentiated in what data flows to whom.
- Split guardian views: a "safety events only" tier (stranger alerts, discontinuity flags, infection-risk flags) vs. a full-access clinician/primary-caregiver tier.
- This maps directly onto the VOX privacy doc's "Guardian Access" phase and gives you a second, distinct persona to demo (a distant family member who should see safety events but not the full narrative bank, say).

---

## LEVEL 3 — Make the sufficiency logic and retrieval genuinely adaptive

Level 1–2 use fixed, hand-written sufficiency rules ("time + confirmation = enough"). Level 3 is where the system starts behaving less like a scripted flow and more like the iterative, self-checking pipeline the VOX docs actually describe.

### 3.1 Iterative retrieval with an LLM sufficiency evaluator
- Replace the fixed 2-fact cap with the real iterative loop: select 1 fact → ask a sufficiency check ("is this enough to resolve the discontinuity?") → if no, add the next-ranked fact → recheck → stop.
- The sufficiency check can start as your existing deterministic rules (keep those — they're fast and free) and fall back to an LLM evaluator only for action types without a clean rule yet, exactly as the VOX doc recommends ("optionally add an LLM evaluator," not replace the rules with one).
- **Acceptance test:** construct a scenario where the first fact genuinely isn't enough (e.g., an appointment discontinuity where the time alone doesn't resolve confusion about *who's* taking them) and confirm the system actually retrieves a second fact rather than stopping early.

### 3.2 Personalized threshold calibration (the "small model" step VOX explicitly defers to later)
- Once you have a few days/weeks of real `consistency_checks` and caregiver feedback (a simple thumbs-up/down on whether a flag was actually useful), train a small per-patient or per-cohort threshold model instead of using the same global discontinuity threshold for everyone.
- This is exactly the point where the VOX docs say custom training becomes worth it — not before. Don't jump here without the Level 1–2 data to justify it.
- **Acceptance test:** show that the false-positive rate (flags the caregiver marked "not useful") drops after calibration, using your own logged feedback data — not a synthetic before/after.

### 3.3 On-device face processing for Trusted-Person Alert (closing the privacy gap Level 1 left open)
Level 1 explicitly allowed encrypted server-side embedding storage as a "labeled TODO." Level 3 closes it:
- Move face detection + embedding + matching fully on-device (e.g., ONNX-exported ArcFace/FaceNet running via a mobile inference runtime) so raw frames and embeddings never leave the device at all — only the `stranger_events` record syncs.
- Add basic liveness/spoof resistance (blink or motion check) since a static-photo spoof is the obvious attack a judge or clinician reviewer might test.
- **Acceptance test:** demonstrate the app functioning with the device in airplane mode for the enrollment-and-match flow, network only needed to push the final event.

### 3.4 Explainability surface for caregivers/clinicians
- Every flag in the caregiver UI should have a "why was I told this" expandable view pulling directly from `audit_log`/`flags.evidence` — the raw observations, the facts shown, the discontinuity score.
- This is low-effort (you already store the data from Level 2.3) but high-impact: it's the difference between a caregiver trusting the system and a caregiver ignoring notifications after a few false alarms.

---

## LEVEL 4 — Platform generalization (stretch goals, only after 1–3 are solid)

These are legitimate next steps but should be pitched as roadmap/vision, not built under time pressure at the expense of Levels 1–3 working reliably.

### 4.1 Generalize the architecture across the other three brief conditions
The hackathon brief explicitly covers Alzheimer's, Acute OCD, PTSD, and Tourette's together. The Action–Situation Consistency + Minimum-Context + Privacy Gateway architecture is not Alzheimer's-specific — it's a general "detect discontinuity between digital/behavioral action and known context, respond with minimum sufficient information, under a strict privacy gate" pattern. That reframing is a strong closing slide:
- **PTSD:** situation model tracks known triggers/context; discontinuity = sudden physiological/behavioral deviation (if wearable data available) during a known high-risk context (anniversary dates, specific locations) → minimum-context grounding assist instead of full symptom log.
- **OCD:** situation model tracks completed compulsion-adjacent actions (e.g., already checked the lock, logged); discontinuity = repeated re-checking behavior → same "you already did this at X time" minimum-context assist, now targeting a completely different clinical mechanism with the identical engine.
- **Tourette's:** privacy gateway logic reused for a different sensitive-data type (tic frequency/severity logs) with guardian-tier access controls identical to what you built in 2.4.
- Framing note for your pitch: this is not "we'll rebuild the app four times" — it's "the discontinuity-detection and privacy-gateway engine is condition-agnostic; only the situation-model vocabulary and response scripts change per condition."

### 4.2 Federated / privacy-preserving learning for threshold calibration
- Instead of centralizing calibration data (3.2) on your server, explore on-device model updates that only sync aggregate threshold adjustments, not raw behavioral data — a natural extension of the "raw data never leaves the device" principle from Level 3.3, applied to the learning loop itself, not just inference.

### 4.3 Real smart-glasses hardware integration
- Level 1–3 Trusted-Person Alert runs on a phone camera by design (feasible in a hackathon). Level 4 is the actual glasses integration path (e.g., existing AR-glasses SDKs with camera + display), which changes the interaction model from "check phone notification" to "quiet in-lens cue" — genuinely valuable for reducing phone dependence in moderate-stage patients, but a hardware/SDK dependency outside a software team's control, so scope this explicitly as post-hackathon.

### 4.4 Clinician-facing longitudinal export
- Extend the base spec's Phase 13 (PDF visit summary) to include the new `consistency_checks`/`audit_log` history as a structured FHIR `Observation`/`Provenance` bundle, so a neurologist could, in principle, ingest the discontinuity-frequency trend into a real EHR system — closes the loop on the base spec's original FHIR-interoperability commitment.

---

## How to present the levels

If asked "how far did you get," the honest and strong answer is a level number, not a feature count: "we have Level 1 fully working end-to-end with real data, Level 2 partially wired in [name which], and Levels 3–4 are the architecturally-justified roadmap" — judges consistently respond better to a clear, honest frontier than to a pile of half-finished features presented as done.
