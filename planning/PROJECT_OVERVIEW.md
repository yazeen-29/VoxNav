# Context Before Consequence: Alzheimer's Assistive Digital Guardrail
### Target Track: Inclusive Innovation | Hackathon: `>.hack();_'26`

---

## 1. Executive Summary & Context

- **Event**: `>.hack();_'26`
- **Track**: **Inclusive Innovation**
- **Current Status**: Selected (Moving from ideation/submission into build & demo phase).
- **Repository**: `VoxNav` (repurposed for the new direction).
- **Core Idea**: Build a privacy-preserving digital accessibility layer that restores minimum necessary context before high-consequence digital actions, allowing individuals with cognitive impairment (e.g., Alzheimer's) to retain digital autonomy without stigma.

---

## 2. Problem Statement

Most digital systems assume:
**User action = informed intention + sufficient context**

For a person living with Alzheimer's or cognitive impairment, this assumption can fail:
- The person may still be capable of making a decision but may temporarily lack the context needed to understand the consequence of a digital action.
Examples:
- Sending a document to the wrong person because the conversation context is forgotten.
- Deleting an important file without remembering why it exists.
- Cancelling an appointment without remembering who arranged it.
- Approving a high-value transaction without remembering the previous agreement.
- Replying to a message without remembering the earlier conversation.

These actions are not always intentional. The objective is to approach these challenges with empathy, dignity, privacy, and humanity—not to replace memory or make decisions for the user, but to restore enough context to exercise autonomy.

---

## 3. Solution Overview

**Context Before Consequence** acts as a guardrail between the user and high-consequence digital actions:
1. **Detects** a potentially consequential action (e.g., sending a document, deleting a file, cancelling an appointment, transferring money).
2. **Estimates** the action's risk using a transparent, interpretable scoring model.
3. **Determines** the minimum context necessary for the user to make an informed decision.
4. **Retrieves** only that context from permissioned sources (messages, calendar, files, contacts—never raw conversations or financial data unless explicitly permitted).
5. **Compresses** the retrieved information into short, human-readable facts.
6. **Explains** the context in plain language (e.g., "John requested the final report on August 28").
7. **Presents** the explanation and lets the user proceed, cancel, or ask for verification.

The system never makes decisions for the user; it only surfaces relevant information at the right moment.

---

## 4. Key Innovations

- **Privacy by Design**: Implements a strict permission filter—raw data is never exposed to AI models. Only structured facts (e.g., "John requested the final report on August 28") are used for explanation.
- **Minimum-Context Computing**: The system asks, "What is the absolute minimum information needed for this action?" rather than dumping all user data into an AI model.
- **Transparency**: Every intervention answers:
  - *Why did you stop me?* ("This action can have a significant consequence.")
  - *What information did you use?* (Lists exact sources: e.g., "1 message, 1 contact, file metadata")
  - *What did you NOT use?* (Shows what was intentionally ignored to protect privacy)
- **Dignity-Focused UI**: Interventions appear as productivity‑tool suggestions (not medical alerts), reducing stigma and encouraging adoption.
- **No Medical Claims**: Positioned strictly as a digital accessibility aid, avoiding regulated‑medical‑device pitfalls.

---

## 5. System Architecture (High‑Level)

```
[User Action in Demo Web App]
          ↓
[Action Interceptor] → Captures structured action (e.g., SEND_DOCUMENT)
          ↓
[Risk Engine] → Scores action using transparent weighted formula
          ↓
[MEDIUM/HIGH Risk?] → YES → [Context Gate]
          ↓
[Permission/Privacy Layer] → Enforces allowed sources (messages, calendar, files, contacts)
          ↓
[Context Policy Engine] → Defines minimum required context per action
          ↓
[Context Retriever] → Searches ONLY permitted sources for relevant items
          ↓
[Context Relevance Model] → Ranks items by semantic similarity (cosine distance)
          ↓
[Context Sufficiency Check] → Rules‑based + LLM fluency‑only check
          ↓
[Context Compressor] → Turns raw data into short facts (e.g., "John requested the final report on August 28")
          ↓
[Explanation Engine] → Formats facts into human‑sentence (LLM used only for fluency, not decision)
          ↓
[Privacy Audit Logger] → Records EXACTLY what was used and what was deliberately NOT used
          ↓
[Decision UI] → Shows explanation + [Continue]/[Cancel]/[Verify] options
          ↓
[User Decision] → Action proceeds, is cancelled, or triggers verification flow
```

---

## 6. Tech Stack (Chosen for Hackathon Speed & Privacy)

- **Language**: Python (backend), JavaScript/TypeScript (frontend/browser extension)
- **Backend**: FastAPI + WebSockets for low‑latency audio‑agnostic action streaming
- **Risk Model**: Rule‑based weighted sum + Random Forest (interpretable, feature‑importance explainable)
- **Permission Filter**: Explicit allow‑list (messages, calendar, files, contacts) enforced before any retrieval
- **Context Retrieval**: ChromaDB vector store + Sentence‑Transformer (all‑MiniLM‑L6‑v2) embeddings → cosine similarity ranking
- **Context Compression**: Rule‑based extraction of [person] [date] [request] → short fact
- **Explanation**: Llama 3 (via Groq API) used **only** to make extracted facts grammatically fluent—**never** to decide risk or sufficiency
- **Frontend**: React/Vite decision UI (modals) + Tailwind CSS for clean, productivity‑tool aesthetic
- **Browser Extension**: Manifest V3 content script that intercepts button clicks in a demo web app, validates data integrity, and streams actions to the backend via WebSocket
- **Data (MVP)**: Clearly labeled synthetic JSON files (messages.json, calendar.json, files.json, contacts.json) – no real user data used
- **Privacy Guarantees**: All symptom‑level data stays encrypted locally; only anonymized, aggregated insights leave the device if the user opts to share

---

## 7. Why This Approach Wins the Hackathon

- **Novelty**: First privacy‑preserving minimum‑context layer for cognitive accessibility—not another memory‑assistant chatbot.
- **Technical Depth**: Combines transparent risk scoring, provable permission filtering, and auditable privacy logs—judges can verify exactly what data was used.
- **Demo‑Ready**: End‑to‑end flow works in <3 seconds with synthetic data; UI shows clear "USED/NOT USED" proof.
- **Ethical & Safe**: No medical claims, no raw data exposure, user stays in control at all times.
- **Team Synergy**: Leverages existing strengths in backend orchestration, MCP‑based agentic systems, frontend/Uи, and context‑aware AI—no steep learning curves.

---

## 8. 30‑Hour Execution Plan (Three Synchronized Stages)

All team members work simultaneously in three 10‑hour stages, ensuring continuous integration.

### Stage 1 – Foundation (T+0 to T+10)
- Define exact input/output contracts (INTERFACES.md)
- Build walking‑skeleton risk engine (hard‑coded MED/HIGH for SEND_DOCUMENT)
- Set up basic FastAPI WebSocket endpoint (echo test)
- Generate synthetic data (messages.json, calendar.json, files.json, contacts.json)
- Create decision UI skeleton (React/Vite) + browser extension popup UI
- Set up ChromaDB + Sentence‑Transformer for context retrieval
- Implement action interceptor (demo webapp buttons → structured data)
- Set up browser extension skeleton (Manifest V3, content script)

### Stage 2 – Core Loop (T+10 to T+20)
- Implement transparent risk scorer (Section 15 weighted formula)
- Build permission filter (Section 9: enforce allowed sources)
- Add data validation layer (check action structure, sanitize inputs)
- Connect risk engine to context processor → return explanation + privacy log
- Complete browser extension: send actions to backend, receive/display UI
- Build context compressor (rule‑based) and explanation engine (LLM fluency‑only)
- Add context sufficiency check (rules‑based + LLM fluency)
- Build privacy audit helper (track exactly what was used/not used)
- Test end‑to‑end flow: button click → risk → context → UI

### Stage 3 – Polish & Demo (T+20 to T+30)
- Optimize latency (<500 ms end‑to‑end) + edge cases (rate limiting)
- Stress test: invalid inputs, missing data, timeout handling
- Demo validation: all four actions (SEND_DOCUMENT, DELETE_FILE, CANCEL_APPT, TRANSFER) with synthetic data
- Refine UI for dignity: easy opt‑out/snooze, clear "Why am I seeing this?" tooltip
- Final privacy‑proof preparation: show EXACTLY "USED: 1 message, 1 contact • NOT USED: 46 messages, 15 files, 10 events"
- Ethics check: no medical claims, no raw data exposure, user consent flows clear
- Demo scenario rehearsal (job‑interview example) + feedback incorporation

---

## 9. Success Criteria for the Hackathon

1. **Working browser extension** that intercepts actions in a demo web app and shows explanation + decision UI.
2. **Data validation** that checks integrity of incoming actions before processing.
3. **Privacy demonstration**: Judges see EXACTLY which items were used and which were deliberately ignored (e.g., "USED: 1 message, 1 contact • NOT USED: 46 messages, 15 files, 10 calendar events").
4. **Dignity‑focused UI**: Non‑stigmatizing, productivity‑tool aesthetic (no medical red alarms).
5. **Novelty clear**: First privacy‑preserving minimum‑context layer for cognitive accessibility—not a memory‑assistant cliché.
6. **Team coordination**: All components integrated by T+20 hr, leaving 10 hr for polish, validation, and demo rehearsal.

---

## 10. Final Note

This project is **not** about detecting Alzheimer's, predicting confusion, or replacing memory. It is about **restoring just enough context at the moment of risk** so that a person with cognitive impairment can make informed decisions about their own digital actions—preserving autonomy, dignity, and privacy.

Let's build the guardrail, not the crutch.

--- 

*Prepared for the `>.hack();_'26` Inclusive Innovation track.*
