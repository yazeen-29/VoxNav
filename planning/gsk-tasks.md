# GSK - Backend Engine & Data Validation Lead
## Difficulty: HIGH

### STAGE 1: FOUNDATION (T+0 to T+10 HR)
- Create alzheimers_guardrail/docs/INTERFACES.md (exact I/O contracts)
- Build walking skeleton Risk Engine (hardcoded MED/HIGH for SEND_DOCUMENT)
- Set up basic FastAPI WebSocket endpoint (echo test)
- Generate project structure: backend/, risk_engine/, data/

### STAGE 2: CORE LOOP (T+10 to T+20 HR)
- Implement transparent risk scorer (Section 15 formula)
- Build permission filter (Section 9: enforce allowed sources)
- Add data validation layer (check action structure, risk score bounds)
- Connect to Yazeen's context processor → return explanation + privacy log
- Test end-to-end: Gopika's action → GSK engine → Yazeen context → Adithya UI

### STAGE 3: POLISH & DEMO (T+20 to T+30 HR)
- Optimize latency (<500ms end-to-end) + edge cases (rate limiting)
- Stress test: invalid inputs, missing data, timeout handling
- Demo validation: all 4 actions with synthetic data
- Final ethics check (Section 36: no medical claims, privacy-proof)
