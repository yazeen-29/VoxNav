# Yazeen - Context Analysis & Privacy Engineering Lead
## Difficulty: MEDIUM

### STAGE 1: FOUNDATION (T+0 to T+10 HR)
- Generate synthetic data: messages.json, calendar.json, files.json, contacts.json (clearly labeled)
- Set up ChromaDB + Sentence Transformer (all-MiniLM-L6-v2)
- Build context retriever: cosine similarity search over permitted sources
- Implement context compressor (rule-based): extract [date] [person] [request] → short fact

### STAGE 2: CORE LOOP (T+10 to T+20 HR)
- Build explanation engine: turn {action, recipient, document, context} → human sentence
- Add context sufficiency check (Section 14): rules-based + LLM fluency-only
- Connect to GSK's backend: receive policy → return explanation + privacy log
- Build privacy audit helper: track EXACTLY what data was used/not used (for judge proof)
- Test all 4 actions with synthetic data → validate "USED/NOT USED" accuracy

### STAGE 3: POLISH & DEMO (T+20 to T+30 HR)
- Add lightweight personalization (if time permits): store user feedback, weight suggestions
- Optimize for <100ms context processing latency + ChromaDB query speed
- Demo validation: test with Adithya's extension + Gopika's demo webapp
- Final privacy proof preparation + ethics review (no raw data exposure)
