**Focused Document #4 — Implementation Blueprint & Milestone Roadmap**
*Greenfield build; Codex‑ready. Aligns to: weekly global prompt; one POP per account per prompt (≤1000 chars); singular collective summary per region; per‑POP contribution weights; anonymous UI; auto‑translation; region‑agent chat; SSE real‑time updates; indefinite retention; hard‑block legality only; Flutter + Google Maps; single‑region infra with CDN; SLOs—City <10 s, Ancestor <30 s, Cached <500 ms, SSE <1 s.*

---

## 1) Delivery model & team roles

* **Product/Content:** defines weekly prompt, tone guardrails; approves UI copy.
* **Mobile (Flutter) Lead:** map UI, chat overlay, auth, i18n, SSE client.
* **Backend (POP API) Lead:** public REST & SSE, auth, caching, rate limits, proxy to congregator, metrics.
* **Semantic Engine Lead:** ingestion, canonicalization, embeddings, contribution weights, GPT‑5 synthesis, debounced rollups, lineage, chat endpoints.
* **DevOps/Observability:** environments, secrets, monitoring, on‑call runbooks and alerts.

> Event types, proxy endpoints, and SSE patterns follow the POP↔Engine contracts and event stream conventions. &#x20;

---

## 2) Workstreams & deliverables (what Codex will generate)

1. **Semantic Congregator service (engine)**

   * HTTP API: `/engine/pops:batch`, `/engine/collectives`, `/engine/collectives/:id/lineage`, `/engine/collectives/:id/chat`.
   * Pipelines: language detect → MT to EN (canonical) → hard‑block screening → embeddings (Qdrant) → contribution weights → GPT‑5 synthesis (JSON mode) → publish.
   * Debounced ancestor rollups (state/country) with queue + metrics.
   * Lineage vectors (anonymized IDs + weight\_pct) + optional weight digests in read path.
   * Prometheus metrics; healthz; circuit‑breaker around GPT‑5. &#x20;

2. **POP API (public edge)**

   * `POST /v1/pops`, `GET /v1/agent-states`, `GET /v1/agent-lineage/:id`, `POST /v1/agent-conversation/:id`, `GET /v1/events` (SSE).
   * In‑memory/Redis cache for `agent-states` (TTL 60 s), forced refresh flag, partial results on degradation.
   * Rate limits; error envelopes; request logging; metrics.
   * Proxy to engine with retries and circuit‑breaker; SSE **`agent_state_update`** broadcasting with region filters/backlog replay. &#x20;

3. **Mobile app (Flutter)**

   * Auth: Google, Facebook, X/Twitter (+ **Sign in with Apple on iOS**).
   * Map UI: Google Maps SDK; **chat bubble overlay** with zoom‑aware rollups (individual → city → state → country), staged animations, focus/ARIA, probe toggle.
   * NodeChat overlay: region summary + chat (20‑turn cap, 30‑min inactivity), lineage cues (no identities).
   * SSE client; React‑Query‑like caching via provider of choice; i18n with device‑locale default and manual override.
   * **No stance bars / no quotes** anywhere in UI; one collective summary only. (Use Chat Bubble spec as visual/interaction reference; replace stance/quote renderers with the summary.)&#x20;

4. **Observability & Ops**

   * Metrics: dual‑write success, breaker state, rollup queue/latency, cache hit ratio, SSE clients, chat/session caps; dashboards; alerts; synthetic probes.
   * Runbooks: congregator outage/breaker, queue drain, feature‑flag cutover. &#x20;

5. **Testing**

   * Unit (weighting math, schema guards, cache, SSE manager, rate limits).
   * Integration (POP→Engine E2E; debounced rollups; SSE ordering/backlog; chat limits; translation fallback).
   * Load (POP storms; 100 concurrent `agent-states`; 50+ SSE clients).
   * UAT: map exploration; POP→city <10 s; ancestor <30 s; chat UX; anonymity; accessibility.&#x20;

> MVP plan/checklists provide baseline milestones, latency probes, dev commands (`npm run dev:engine`, rollup tests, monitor scripts) we’ll encode into CI and acceptance gates. &#x20;

---

## 3) Milestones, gates, and acceptance (6‑week plan)

> Each milestone has **Definition of Done (DoD)**, **SLO gate**, and **evidence artifacts** (metrics snapshot, API traces, screenshots/recordings). Monitoring/alerting thresholds come from the observability plan; breaker/queue runbook is linked in alerts. &#x20;

### **M0 — Foundations & scaffolds (Week 0)**

**Tasks**

* Repos & packages; shared types (CollectiveAgentState, Lineage, events).
* Engine skeleton (Hono/Fastify), healthz, API‑key auth, config.
* POP API skeleton (Fastify/Express TS), JWT auth, SSE manager, cache.
* Flutter app shell; Google Maps SDK; feature flag config; Auth SDKs wired.

**DoD**

* `GET /healthz` up for POP API & Engine; `/metrics` exposes base gauges.
* Mobile renders map; pre‑login read‑only.
* CI: lint, typecheck, unit test scaffolds.

**Gate**

* Smoke monitor OK; alarms wired to webhook; breaker closed.&#x20;

---

### **M1 — Ingestion, canonicalization & city synthesis (Week 1)**

**Tasks**

* Engine: POP ingest, language detect + MT→EN, hard‑block CSAM/threat/spam, embeddings (Qdrant), contribution weight calc & persistence, synth (GPT‑5, JSON mode), persist `collective_state` + lineage vector; publish SSE to POP API.
* POP API: `POST /v1/pops` → forward to engine; proxy `GET /v1/agent-states`; SSE `agent_state_update` broadcasting.
* Mobile: submit flow (login‑gated), pin appears immediately, map fetches city summary via `agent-states`, SSE subscription updates UI.

**DoD**

* Submit POP → **city** collective updated and visible; SSE event delivered.
* **SLOs:** City P95 < **10 s**; SSE E2E < **1 s** (probe script/metrics).
* Evidence: metrics (`agent_state_refresh_last_latency_ms`), SSE probe logs.&#x20;

**References**
Event schema & proxy patterns from API contracts; engine wiring checklist. &#x20;

---

### **M2 — Ancestor rollups & caching (Week 2)**

**Tasks**

* Engine: rollup orchestrator with debounced **state/country** synthesis; priority queues; metrics (`rollup_queue_size`, per‑level throughput).
* POP API: cache (TTL 60 s) with forced refresh; partial results on breaker open; rate limits.
* Mobile: prefetch active viewport region chain; region breadcrumb/selector (no stance/quotes).

**DoD**

* Submit POP → **state/country** update visible.
* **SLOs:** Ancestor P95 < **30 s**; cached reads < **500 ms** P95.
* Evidence: rollup latency probe outputs; cache hit ratio ≥70% dashboard.&#x20;

**References**
Integration architecture rollup & cache approach; MVP dev plan latency probes. &#x20;

---

### **M3 — Chat (region agent) & translation (Week 3)**

**Tasks**

* Engine: `POST /engine/collectives/:id/chat` (20 turns/session, 30‑min idle, 500 new sessions/min region cap); translation in/out; tone rules; anchor to weekly prompt.
* POP API proxy; rate limits; metrics (`chat_overlay_served_total`, session throttles).
* Mobile: NodeChat overlay; streaming; session cap UI; transcript persistence.

**DoD**

* Chat flows for any region; transcripts stored (internal only).
* **SLO:** cached chat preloads < **500 ms** P95; steady streaming start \~1–2 s.
* Evidence: chat interaction counters; conversation logs (internal).&#x20;

---

### **M4 — Map overlay polish, probe mode, accessibility (Week 4)**

**Tasks**

* Flutter **chat bubble overlay** using zoom thresholds & staged animations; individual pins (24 h TTL), rollups persist week; probe mode (synaptic network); A11y (focus rings, SR labels, reduced motion).
* Telemetry for bubbles/rollups/probe interactions; error states.

**DoD**

* Staged rollups render smoothly; probe toggles accessible; no stance/quote UI exists.
* Evidence: screenshots & videos; bubble/probe metrics visible.
* Reference visual/interaction details and thresholds from bubble spec; adapt to “collective summary only.”&#x20;

---

### **M5 — Observability hardening, chaos & load (Week 5)**

**Tasks**

* Alerts & dashboards: breaker, retry queue, rollup latency, cache, SSE clients; synthetic POP & SSE probes via cron; chaos drills; load tests (50 concurrent POPs; 100 `agent-states`; ≥50 SSE clients).
* Runbook validations; failover flags.

**DoD**

* No P1 alerts during 24‑hour soak; chaos run recovers using runbook; load meets SLOs.
* Evidence: Grafana screenshots; `npm run monitor:ops` passes; incident notes.  &#x20;

---

### **M6 — Launch readiness & cut (Week 6)**

**Tasks**

* App store readiness (privacy strings, Sign in with Apple); security review; env hardening; feature flag default **ON**; release notes & help docs.
* Go/No‑Go: exec demo; SLO trend check; error budgets; dashboards live.

**DoD**

* All SLO gates met; alerts quiet; approvals recorded; app binaries submitted.
* Evidence: acceptance checklist, SLO trend charts, release artifacts.&#x20;

---

## 4) Ticket breakdown (selected, Codex‑ready)

> Use IDs `POP‑API‑*`, `ENGINE‑*`, `MOB‑*`, `OPS‑*`. Each ticket lists **Inputs**, **Output**, **Tests**, **Metrics**, **SLO/AC**.

**ENGINE‑01 — Ingest & canonicalize POP**

* *Inputs:* `PopSubmission` fields.
* *Output:* persisted POP (original, detected\_lang, canonical\_en, region\_id), embeddings in Qdrant.
* *Tests:* unit (validation; language detect), integration (POST batch → persisted row), load (N=50).
* *Metrics:* `pop_submission_total`.
* *AC:* 201/202 responses; rejects illegal/spam; persists lineage.&#x20;

**ENGINE‑02 — Contribution weights & centroid**

* *Output:* `lineage_weight` rows; digest stats into `collective_state.x_meta`.
* *Tests:* math unit tests for normalization; duplicates dampening; histogram bins.
* *Metrics:* `rollup_processed_total` increments after calc.
* *AC:* weights normalized to 100%; top‑K populated.&#x20;

**ENGINE‑03 — GPT‑5 synthesis (JSON mode)**

* *Output:* `collective_summary` (50–1200 chars).
* *Tests:* schema guard; retry/backoff; timeout; prompt anchoring to weekly question.
* *Metrics:* `agent_state_refresh_last_latency_ms`.
* *SLO:* city synth P95 < 10 s.&#x20;

**ENGINE‑04 — Debounced ancestor rollups**

* *Output:* refreshed state/country `collective_state`.
* *Tests:* priority queues; debounce; latency probe.
* *Metrics:* `rollup_queue_size`, per‑level schedule/processed counters.
* *SLO:* ancestor P95 < 30 s.&#x20;

**ENGINE‑05 — Lineage API**

* *Output:* `{pop_public_id, weight_pct}[]` vector; model versions.
* *Tests:* pagination; large vector memory; anonymization.
* *AC:* no account identifiers exposed.&#x20;

**ENGINE‑06 — Region chat**

* *Output:* assistant replies (tone rules, prompt‑anchored), transcripts persisted.
* *Tests:* 20‑turn cap; 30‑min idle; per‑region rate limit 500/min; translation failover.
* *Metrics:* `chat_overlay_served_total`, throttles.&#x20;

**POP‑API‑01 — `/v1/pops`**

* *Output:* `{ pop_public_id, region_assignments[] }`; async refresh trigger.
* *Tests:* idempotency; breaker open degrades gracefully; retry queue.
* *Metrics:* `dual_write_success_rate`, `congregator_retry_queue_size`.&#x20;

**POP‑API‑02 — `/v1/agent-states` cache + SSE**

* *Output:* cached fetch (60 s TTL), `agent_state_update` SSE with region filter/backlog.
* *Tests:* ordering, dedupe, reconnect replay; partial results on breaker.
* *SLO:* cached P95 < 500 ms; SSE E2E < 1 s. &#x20;

**MOB‑01 — Auth & gating**

* *Output:* Google/Facebook/X; **Apple on iOS**; pre‑login read‑only.
* *Tests:* token exchange; age gate ≥13; chat/post login‑gated.
* *AC:* no identity ever displayed in UI.

**MOB‑02 — Map overlay (bubbles & rollups)**

* *Output:* chat bubble variants; staged roll/zoom animations; SR labels; reduced‑motion fallback.
* *Tests:* threshold hysteresis; focus order; TTL expiry (24 h pins; week rollups).
* *Metrics:* `bubble_pin_rendered_*`, `bubble_rollup_transition_*`.&#x20;

**OPS‑01 — Dashboards & alerts**

* *Output:* three dashboards (Ingestion, AgentState Health, Real‑time Delivery); alert routes per matrix.
* *Tests:* alert fire/drill; runbook links render; synthetic probes pass.&#x20;

---

## 5) Environments, configs & secrets (minimal, reproducible)

**Engine**
`OPENAI_MODEL=gpt-5`, `EMBEDDINGS_MODEL=text-embedding-3-large`, `CANONICAL_LANG=en`, `ROLLUP_DEBOUNCE_MS_STATE=6000`, `ROLLUP_DEBOUNCE_MS_COUNTRY=9000`, `CACHE_TTL_SEC=60`, `REGION_SESSION_RATE_LIMIT_PER_MIN=500`, `CHAT_TURN_LIMIT=20`, `CHAT_SESSION_TTL_MIN=30`.

**POP API**
`REGION_CACHE_TTL_SEC=60`, `SSE_BACKLOG_SIZE=500`, `AGENT_STATE_RATE_LIMIT_MAX=60`, breaker thresholds, compression toggles; Prometheus at `/metrics`.

**Mobile**
Remote config for feature flags; provider keys (Google/Facebook/X/Apple); Google Maps key; i18n language list.

> Dev bootstrap & engine bring‑up flow mirror the integration architecture and implementation checklist (compose stack; healthz checks; feature flags). &#x20;

---

## 6) SLO gates & evidence requirements (Go/No‑Go)

* **City update:** P95 < 10 s (POP submit → SSE → UI). Evidence: latency gauges + probe log.&#x20;
* **Ancestor update:** P95 < 30 s (state/country). Evidence: rollup metrics plots.&#x20;
* **Cached read:** P95 < 500 ms (`/v1/agent-states`). Evidence: API timing histogram.&#x20;
* **SSE E2E:** P95 < 1 s; no ordering gaps; backlog bounded. Evidence: SSE probe, `sse_active_clients` stable.&#x20;
* **Availability:** ≥99.9% in soak; 0 P1s. Evidence: alert history.

---

## 7) Risk log & guardrails

* **Moderation/store risk (minimal hard‑blocks):** ship **strict‑mode feature flag** in case of review feedback; keep chat region‑mute on spike.&#x20;
* **GPT‑5 instability/cost:** breaker + retries; cached reads; queue + runbook; fallback flags.&#x20;
* **SSE scaling on mobile:** region filters; backlog cap; reconnect backoff; synthetic client in CI.&#x20;
* **Global latency (single region):** CDN for reads; accept sub‑2 s drift for far users; multi‑region considered post‑MVP.&#x20;

---

## 8) Compliance & data policy (greenfield)

* **Retention:** POPs, collectives, chat transcripts retained **indefinitely**; no self‑service export/delete.
* **Anonymity:** store stable account ID internally; never render identities.
* **Location:** store region IDs + rounded coords permanently.
* **Legal hard‑blocks only**; admin removal reserved for illegal content.
* **App Stores:** iOS requires **Sign in with Apple** if other providers are present.

---

## 9) Acceptance checklist (summarized for release)

* [ ] Read‑only map + region summaries load without login; cached <500 ms P95.
* [ ] Submit POP (≤1000 chars) → city collective updates <10 s; pop pin inflates; TTL 24 h.
* [ ] State/country recompute <30 s; SSE **`agent_state_update`** delivered with correct payload.&#x20;
* [ ] Chat with any region (20 turns, 30‑min idle) with translation; transcripts persisted; per‑region caps enforced.
* [ ] Map overlay renders staged rollups; probe mode accessible; no stance bars/quotes.&#x20;
* [ ] Metrics dashboards & alerts operational; breaker/queue runbook validated. &#x20;
* [ ] Integration tests pass: POP→Engine→SSE; rollup probes; SSE ordering; load.&#x20;

---

### Notes on alignment with prior materials

* We **reuse** the API/event **shapes and patterns** (SSE event type, proxy routes, error envelopes) while changing the payload to **`CollectiveAgentState`** (single `collective_summary`, optional weight digest; **no stances/quotes**). Update client rendering accordingly. &#x20;
* Milestone gates, monitoring metrics, and runbooks draw directly from the integration architecture, implementation checklist, monitoring plan, MVP plan, and testing strategy; thresholds are tuned to your new SLOs (ancestor <30 s, SSE <1 s).     &#x20;

---
