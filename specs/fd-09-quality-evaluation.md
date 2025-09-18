**Focused Document #9 — Quality, Safety & Evaluation Plan (Semantic Engine + POP Edge, Codex‑ready)**
*Purpose:* Define what “good” looks like for the GPT‑5–powered **semantic congregator** and the POP Edge service, how we measure it, and the automated gates that determine release readiness. This plan binds model/content quality to **system SLOs** (city <10 s, ancestor <30 s, cached reads <500 ms, SSE <1 s) and to the engine/edge contracts (ingestion, `agent_state_update` SSE, lineage, chat).  &#x20;

> **Collective‑only model:** All user‑visible outputs are a **single collective summary** per region (no stance bars, no quotes). Any prior references to stance/quotes in older assets are superseded by this plan’s **collective\_summary** quality and safety checks. The SSE **event type** remains `agent_state_update`.&#x20;

---

## 1) Evaluation goals (what we must prove)

1. **Faithful aggregation:** Collective summaries **reflect weighted inputs** (per‑POP weight %) without fabricating sources or identities. Lineage weights are normalized and traceable (`{pop_public_id, weight_pct}`).&#x20;
2. **Safety by policy:** Only illegal content (CSAM/credible threats/terrorism) and spam automation are blocked; otherwise we **reflect authentic sentiment**. The agent voice never reveals PII.&#x20;
3. **Anonymity & privacy:** No user identifiers in any public payload; lineage uses only `pop_public_id`.&#x20;
4. **Internationalization fidelity:** Summaries/chats render in target locale; when translation fails, the UI shows original with an **“auto‑translate unavailable”** banner.&#x20;
5. **SLO adherence:** City P95 <10 s; ancestor P95 <30 s; cached reads P95 <500 ms; SSE E2E <1 s. Degradations trigger cache‑serve, **partial\_results** metadata, and runbook workflows. &#x20;

---

## 2) Quality dimensions & KPIs

| Dimension                   | What we measure                                                                                                                                                       | KPI / Gate                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Faithfulness to weights** | Spearman ρ between POP weight ranks (top‑K) and semantic similarity of `collective_summary` to those POPs (embedding cosine); % of top‑K themes reflected in summary. | ρ ≥ 0.6; ≥80% of top‑K themes referenced implicitly (manual rubric + auto proxy).  |
| **Coherence & concision**   | Length 50–1200 chars; readability; absence of lists/quotes; one unified voice.                                                                                        | 100% within bounds; ≥90% pass readability lint (heuristic).                        |
| **Prompt anchoring**        | Summary and chat explicitly tie back to the **weekly prompt**.                                                                                                        | ≥95% contain prompt‑topic lexical anchors.                                         |
| **Locale fidelity**         | Output language matches requested locale; back‑translation semantic retention.                                                                                        | ≥95% locale match; back‑translation similarity ≥0.75 (heuristic).                  |
| **Safety/PII**              | Zero illegal content; no PII (names, emails, phones) in outputs.                                                                                                      | 0 incidents; <0.1% false blocks on allowed content.                                |
| **Anonymity**               | Public payload scan for IDs/usernames.                                                                                                                                | 0 occurrences; lineage contains only `pop_public_id`.                              |
| **Latency SLOs**            | POP→city update, ancestor rollup, cached read, SSE E2E.                                                                                                               | City P95 <10 s; Ancestor P95 <30 s; Cache P95 <500 ms; SSE <1 s.                   |
| **Stability**               | Dual‑write success, breaker state, retry queue, cache hit‑rate.                                                                                                       | Dual‑write ≥98%; breaker closed; retry queue ≈0; cache hit ≥70%.                   |

> Latency, breaker, cache, rollup, and SSE KPIs are read from the shared metrics inventory and dashboards (“AgentState Health”, “Real‑time Delivery”).&#x20;

---

## 3) Datasets & fixtures (what we test with)

* **Synthetic multilingual POP sets** (EN, es, pt, fr, de, hi, ja, ko, zh‑CN/zh‑TW), balanced across **agree/neutral/disagree** sentiments—but evaluated as a **single collective**. Include slang, dialect, and sarcasm to stress tone handling.&#x20;
* **Regional thematics** for 12 seed cities (e.g., SF, NYC, Delhi, Tokyo, São Paulo, Berlin) with groundable local idioms; each set includes 200–800 POPs, ensured unique `pop_public_id`.
* **Edge‑cases:** very short POPs, emoji‑heavy, code‑switched text, spammy bursts, borderline but legal insults (must pass), and illegal samples (must block).&#x20;
* **Golden summaries** for 30 region×prompt pairs (manually authored baselines for rubric comparison).
* **Degradation fixtures:** synthetic OpenAI timeouts, engine outages, and packet loss to validate breaker, cache fallback, **partial\_results** flags, and runbook flow.&#x20;

---

## 4) Automation harness (how we measure it)

**Components (re‑use & extend existing test assets):**

* **Integration/soak harness** that drives POP→Engine→POP flows, measures end‑to‑end latencies, and inspects SSE ordering via the existing scripted probes and Playwright/Node test rigs.&#x20;
* **SSE probe**: multi‑client verifier for `agent_state_update` ordering, backlog replay, and gaps/dupes—already present and configurable (`SSE_CLIENTS`, durations).&#x20;
* **Load harness**: concurrent POP submissions and agent‑state qps, streaming metrics snapshots to assert counters/gauges.&#x20;
* **Metrics snapshotter**: pulls `/metrics`/`/api/metrics`, asserts alert thresholds for breaker, retry queue, cache hit‑rate, rollup depth, and SSE client health per Monitoring Plan.&#x20;

**Execution model (CI & local):** docker‑compose boots the engine stack (Qdrant etc.), POP server, then the harness runs unit + integration + load suites with health waits—templates are already sketched in the testing & MVP plans. &#x20;

---

## 5) Test suites (what Codex must implement)

### A) Engine unit suites

1. **Weighting math:** normalization (Σ=100%), zero‑vector guards, stability under edits/deletes; digest correctness (gini/mean/top‑K). **Gate:** 100% pass.&#x20;
2. **LLM JSON‑mode guard:** schema/length bounds, retry/backoff, prompt anchoring, no lists/quotes/PII. **Gate:** 100% pass.&#x20;
3. **I18N/translation:** locale selection, fallback flags set on failure; back‑trans check utility present. **Gate:** 100% pass.&#x20;
4. **Safety filters:** illegal/spam detection; allow borderline content. **Gate:** 100% pass for fixtures; ≤0.1% false‑positive on allowed set.&#x20;

### B) Edge unit suites

* **Circuit breaker & retry queue** behavior; error envelopes; cache TTL & invalidation; region ID validation. **Gate:** 100% pass.&#x20;

### C) Integration suites (E2E)

1. **Happy path:** submit POP → **city** summary ≤10 s P95 → **agent\_state\_update** received → cached read <500 ms → ancestor ≤30 s. **Gate:** meets SLOs over N=50 runs. &#x20;
2. **Degradation:** kill engine → edge serves cache with `partial_results:true` → runbook steps close breaker & drain queue → automatic recovery confirmed. **Gate:** passes; metrics return to green.&#x20;
3. **SSE ordering:** 50 clients, region‑filtered subscription; no gaps/dupes; backlog replay on reconnect. **Gate:** 0 defects.&#x20;
4. **Multilingual:** all 9+ locales; locale fidelity and back‑translation pass thresholds; banner shown on MT failure. **Gate:** ≥95% locale match.&#x20;

### D) Load & soak

* **POP burst:** 50 concurrent submits (≤10 s wall) and 1‑min sustained 2 rps; measure dual‑write success ≥98%; breaker closed; cache hit ≥70%. **Gate:** pass.&#x20;
* **Read surge:** 100 concurrent `agent-states` reads complete in <5 s aggregate. **Gate:** pass.&#x20;

---

## 6) Content quality rubric (manual + semi‑auto)

**Rubric (per region×prompt):**

* **Relevance** (0–2): on‑topic, answers the prompt.
* **Faithfulness** (0–3): reflects dominant weighted themes; no hallucinated facts.
* **Tone match** (0–2): region personality (playful/blunt) w/out violating safety.
* **Clarity** (0–2): single narrative; no lists or quotes; grammar natural in locale.
* **Anonymity** (0–1): zero PII, no user identifiers.

**Acceptance:** median ≥7/10 across 30 golden cases; no item <5. Auto‑aids: top‑K coverage check via embedding similarity; PII regex/NER scan; schema/length lints.

---

## 7) Safety checks & red‑team protocols

* **Illegal content hard‑block** fixtures (CSAM, explicit terror/violence threats) → must be rejected; log **blocked\_reason**; **no shadowbans** for allowed but distasteful content.&#x20;
* **Spam/automation**: flood tests trigger regional **chat mute** and show subtle **cooling‑off** banner; verify auto‑unmute.&#x20;
* **PII leak guard**: scan `collective_summary` and chat replies for emails, phones, handles; fail CI if found.
* **Anonymity surface**: ensure `agent-states` and SSE payloads never include `account_id`. **Gate:** 0 violations.&#x20;

---

## 8) Metrics, dashboards & alerts (evidence collection)

* Use the shared **Metrics Inventory**; assert gauges/counters in CI and during soak (breaker, retry queue, rollup queue/latency, cache hit, SSE clients, refresh latency). Include JSON snapshot & Prometheus exposure.&#x20;
* Dashboards: **Ingestion Overview**, **AgentState Health**, **Real‑time Delivery**; each panel links to the **Breaker & Retry Queue** runbook. &#x20;
* Alert matrix: dual‑write <0.98 (P1), breaker open 2 min (P1), retry queue >10 (P0), SSE client drop >50%/min (P2).&#x20;

---

## 9) Pass/fail release gates (Go/No‑Go)

A release **passes** when all are true:

1. **Latency SLOs** met in integration probes (city <10 s; ancestor <30 s; cache <500 ms; SSE <1 s). Evidence: metrics + probe logs.&#x20;
2. **Stability:** dual‑write ≥98%, breaker closed, retry queue \~0, cache hit ≥70% during soak.&#x20;
3. **Quality rubric:** median ≥7/10 across golden set; no PII; locale fidelity ≥95%.
4. **Safety:** 0 illegal content escapes; ≤0.1% false‑positive on allowed borderline cases.&#x20;
5. **SSE integrity:** 0 gaps/dupes; replay OK.&#x20;

If any P1+ alert criteria hold (per Monitoring Plan), **No‑Go** until remediation and a green re‑run.&#x20;

---

## 10) Runbooks & incident validation

As part of evaluation, execute a **breaker drill**: force engine failure, watch POP cache serve `partial_results`, follow **Congregator Breaker & Retry Queue Recovery**, confirm breaker closes and queue drains; record timings and screenshots.&#x20;

---

## 11) CI wiring (what Codex should generate)

* **Jobs:** unit → integration (engine up via compose) → load burst → SSE probe → quality rubric run (goldens). Templates mirror the Testing Strategy’s GitHub Actions sample & docker‑compose test stack.&#x20;
* **Artifacts:** metrics snapshots, SSE probe reports, rubric CSV (scores per case), and pass/fail badges.
* **Gates:** workflow fails if any pass/fail gate in §9 is unmet; publish dashboards/links per MVP plan.&#x20;

---

## 12) Acceptance checklist (Evaluation Plan)

* [ ] Synthetic + multilingual fixtures seeded; golden set curated.
* [ ] Engine unit suites (weights, JSON‑mode, safety, i18n) pass 100%.&#x20;
* [ ] Integration SLO probes green; SSE probe shows 0 ordering defects. &#x20;
* [ ] Degradation drill executed; runbook followed; recovery verified.&#x20;
* [ ] Dashboards populated; alert routes live; monitor CLI emits no warnings.&#x20;
* [ ] Release gate report generated; Go/No‑Go recorded in change log.&#x20;

---

### Notes on alignment

* Contracts & SSE event **shapes** match the API contracts; we assert payloads contain only the **collective\_summary** (plus digest/meta) in this greenfield MVP.&#x20;
* The test harnesses, probes, and CI scaffolding extend the **Testing Strategy** and **MVP Plan** without re‑introducing stance or quotes into the UI. &#x20;
* All monitoring hooks and alerts come from the **Monitoring & Observability Plan** and feed the **Breaker & Retry Queue** runbook for rapid remediation. &#x20;

---
