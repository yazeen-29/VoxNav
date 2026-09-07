# Level 5 document-grounded context (RAG)

RAG is feasible for Context Companion, but it should be used to retrieve and quote relevant, human-reviewable evidence—not to train a diagnostic model or decide a patient's condition.

## Safe prototype

1. A caretaker or clinician explicitly imports a de-identified document (PDF/text) into the encrypted Supabase vault.
2. The Edge Function extracts text, removes obvious identifiers where possible, and splits it into small dated sections.
3. Each section is embedded and stored with patient/vault ownership, source name, page/date, and retention metadata. Raw text is never put into analytics or notifications.
4. A question such as “what changed since the last visit?” retrieves the top matching sections.
5. The app shows the source excerpts and asks a person to confirm each fact. The answer is a summary of confirmed facts plus “questions to ask the clinician.”

## Non-negotiable boundaries

- No diagnosis, severity label, medication change, or alert suppression is generated automatically.
- Do not use a document to change patient thresholds or make treatment decisions.
- Require explicit consent, per-document deletion, row-level security, and an audit trail.
- Keep retrieval scoped to one vault and one purpose; never train a shared model on private records.
- For the demo, use the supplied synthetic report only and display a clear “not medical advice” notice.

## Suggested implementation order

1. Local retrieval over the synthetic report (deterministic keyword/chunk matching).
2. Supabase Storage + Edge Function ingestion with RLS and short-lived signed URLs.
3. Embeddings/vector search only after the consent and deletion flows are tested.
4. Optional model-generated wording, with retrieved excerpts always visible beside it.

