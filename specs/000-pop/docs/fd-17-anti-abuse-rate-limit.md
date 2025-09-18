**Focused Document #17 — Anti‑Abuse, Spam & Rate‑Limit Spec (Legal‑Only Moderation, Automation Defense, Region Mutes, Greenfield, Codex‑ready)**
*Goal:* Ship a **commercial‑grade** guardrail layer that preserves POP’s authenticity‑first philosophy—**only block what is illegal or clearly automated/spam**—while protecting reliability/SLOs and keeping the public surface strictly **collective** (no identity leakage). This spec defines **what to block**, **how to detect automation**, **rate‑limit envelopes**, **region chat mute logic**, **error/metrics contracts**, and **runbook hooks**, aligned with the existing API/Integration/Monitoring artifacts.   &#x20;

---

## 0) Product stance & non‑negotiables

* **Authenticity first; legal compliance only.** Hard‑block *only* content that is illegal or violates platform safety baselines. Borderline or distasteful speech **is allowed** and simply flows into the collective aggregate; no warning banners, no shadow review. *(UI remains aggregate‑only; no personal identifiers.)*&#x20;
* **Zero human‑in‑the‑loop moderation** (aside from weekly prompt authoring). All enforcement is automated and minimal.&#x20;
* **One POP per prompt per account** enforced at data layer; public map shows collective summaries only. *(Server/API contracts & hierarchy remain authoritative.)* &#x20;
* **SLO coupling:** Guardrails must not push us over **city < 10 s**, **ancestor < 30 s**, **cached reads < 500 ms**, **SSE E2E < 1–2 s** targets; abuse checks run **fast‑lane** (regex/rate/dupe) on the request path; anything heavier is async.&#x20;

---

## 1) What we hard‑block (and why)

**HARD BLOCK = reject at ingest (HTTP 422/400), do not forward to engine, do not pin.**

1. **Illegal sexual content involving minors** (CSAM, grooming enticement).
2. **Illegal explicit content**: credible threats of imminent violence, terrorism promotion, criminal coordination.
3. **Spam/automation/flooding** that threatens platform stability (bots, scripts, obvious mass duplication).
4. **Direct contact/solicitation vectors** (URLs, emails, phone numbers) — blocked to curb spam and off‑platform abuse per POP input validation.&#x20;

> **NOTE:** API contracts already specify POP text constraints and prohibit URLs/emails/phones; we honor those validations (422) with structured error envelopes and `trace_id`.&#x20;

**Borderline content** (insults, profanity, political extremity, etc.) **is NOT blocked** if legal; it is aggregated as‑is and may be translated like any other content. (No warnings.)

---

## 2) Detection strategy (fast‑lane on path, heavy checks off path)

### 2.1 Request‑path “fast‑lane” checks (≤10–15 ms budget)

* **Length & charset guard** (1–1000 chars) + forbidden pattern detectors (URL/email/phone).&#x20;
* **Duplicate/near‑duplicate burst check** (same `account_id`, same text hash, same prompt) → reject as **spam\_duplicate**.
* **Velocity/fingerprint check** (per‑account, per‑device, per‑IP): one‑POP/ prompt rule plus token‑bucket limits on auxiliary write routes; exceed → **429**. &#x20;
* **Region resolvability**: if GPS denied and **IP→city fails**, block with `city_required` (422).&#x20;

### 2.2 Asynchronous checks (post‑accept)

* **Automation & burst scoring:** rolling, per‑region counters for “blocked‑as‑automation”, “dupe‑hash rates”, “velocity anomalies.”
* **LLM/text classifier gates** *(optional, disabled by default to minimize moderation bias)*: if enabled for experiments, it **never hard‑blocks** on its own; it only increments soft signals for ops analytics.

> All async signals drive **regional chat mutes** (see §4) and ops visibility; they never remove already accepted POPs (indefinite retention).&#x20;

---

## 3) Rate‑limit envelopes (public + s2s)

**Client‑facing POP Edge (examples; tune via envs):**

* `POST /api/pop`: **Account**: 1 per active prompt (enforced in DB); **burst** guard 5/min per account to absorb edit retries (returns 422 for second final submit).
* `GET /api/agent-states`: **Per‑IP** 60 req/min; response includes `X‑RateLimit‑*` headers. *(Server also batches/ caches upstream calls.)* &#x20;
* `GET /api/events` (SSE): **Per‑IP** 3 concurrent streams; global cap with back‑pressure; reads are never cached at CDN.&#x20;

**Service‑to‑service (as in contracts; keep or tighten in prod):**

* `POST /congregator/_internal/pops-batch`: **100 req/min**.
* `GET /congregator/congregates`: **1000 req/min**.
* `GET /api/agent-states` (proxy surface): **500 req/min**.
  All emit standard **`X‑RateLimit‑*`** headers and structured 429 payloads with `retry_after`.&#x20;

**Region‑agent chat caps:**

* **Session starts:** policy target **≤500 new sessions/min/region** (server 429 + banner).
* **Session lifetime:** 20 turns, 30‑minute idle timeout; per‑account concurrent chat sessions = 1 per region. *(UI already expects the cooldown banner.)*&#x20;

**Implementation notes:**
Use Express middleware with Redis buckets (token‑bucket or leaky‑bucket); env‑controlled windows/limits; emit `X‑RateLimit-*`. Checklist already uses `express-rate-limit` and exports metrics.&#x20;

---

## 4) Regional **chat mute** control (automation spike safety valve)

**Trigger:** If a region shows sustained automation pressure—e.g.,

* `automation_block_rate` ≥ **50/min** OR
* `automation_block_ratio` (blocked/accepted) ≥ **0.5** for **2 consecutive minutes**,

…then **mute chat** for that `(region_id, prompt_id)` via `region_chat_mutes` until the rate normalizes (initial `muted_until = now()+5m`, auto‑extend if the spike continues). Reads remain unaffected; POP submissions continue; only **new chat sessions** are blocked with a gentle “cooling off” banner. Unmute automatically when pressure < thresholds for 2 min.&#x20;

* Persistence & ops: `region_chat_mutes` table is authoritative; Admin API allows **manual override** (mute/unmute).&#x20;
* Metrics: `region_chat_mute_active{region}` gauge; `region_chat_mute_total` counter; alerts on sustained mutes (see §6).&#x20;

---

## 5) Enforcement responses (errors & envelopes)

All errors follow the **standard ErrorResponse** with `error`, `message`, optional `details`, `retry_after`, and **`trace_id`** for correlation; use appropriate HTTP codes:

* **422** `illegal_content`, `city_required`, `prohibited_contact_info`, `spam_duplicate`.
* **429** `too_many_requests` (+ `retry_after`).
* **503** `service_unavailable` when upstream is degraded (breaker open).&#x20;

SSE is **never** used to push moderation decisions to clients; if chat is muted, the **chat start** route returns 429 with a cooling‑off hint, and the UI shows the banner. (No retroactive removals.)

---

## 6) Observability & alerts (new counters + existing dashboards)

**Add these counters/gauges to POP Edge `/metrics` & `/api/metrics`:**

* `abuse_block_total{reason=illegal|prohibited_contact|spam_duplicate}`
* `automation_block_total{reason=velocity|dupe|fingerprint}`
* `region_chat_mute_active{region}` (gauge), `region_chat_mute_total` (counter)
* `rl_reject_total{route}` (rate‑limit rejections)
* `pop_input_validation_failure_total{reason}`

Tie these into the existing **Ingestion**, **AgentState Health**, and **Real‑time Delivery** dashboards; reuse monitor CLI and alert matrix:

* **P1**: `automation_block_ratio ≥ 0.5` for 2 min (per region).
* **P2**: `rl_reject_total{route="/api/agent-states"}` spikes 5× baseline.
* **P1**: `congregator_breaker_state == 1` for 2 min (from existing plan).&#x20;
  Runbook hand‑off: **Breaker & Retry Queue Recovery** stays the first stop for upstream issues.&#x20;

> Metrics plumbing, dashboards, and CLI hooks are already standardized (Prometheus text at `/metrics`, JSON at `/api/metrics`, alert scripts in `monitor:ops`). Extend the inventories above and link panels to the chat‑mute Admin page.&#x20;

---

## 7) Systems view & request flow (enforcement points)

```
(Client) ──POST /api/pop────────> [POP Edge]
                                 ├─ Fast-lane checks (length, URL/email/phone, dupe, velocity)
                                 │   ├─ reject 422/429 (structured) → return
                                 │   └─ accept → persist POP (DB)
                                 ├─ derive region (GPS/IP)  → forward to Engine
                                 ├─ schedule rollups / cache AgentState / SSE
                                 └─ async abuse signals (per region) → may trigger region chat mute

(Client) ──POST /api/chat/start─> [POP Edge]
                                 ├─ check region_chat_mutes → 429 + banner if active
                                 └─ enforce session/turn limits → proceed with chat
```

Integration points & contracts (AgentState proxy, SSE `agent_state_update`, envelopes/rate‑limit headers) remain unchanged. &#x20;

---

## 8) Implementation blueprint (files, env, toggles)

**New server modules**

```
server/lib/abuse/
  fastLane.ts            // regex + counters + velocity/dupe checks
  automationSignals.ts   // async region-level spikes & ratio calculators
  regionChatMute.ts      // CRUD against region_chat_mutes + policy engine
  rateLimits.ts          // Redis buckets; emit X-RateLimit-*
```

**Env knobs (examples)**

```
ABUSE_POLICY_LEGAL_ONLY=true
RL_AGENT_STATES_WINDOW_SEC=60
RL_AGENT_STATES_MAX=60
RL_SSE_MAX_CONN_PER_IP=3
AUTOMATION_RATE_THRESHOLD_PER_MIN=50
AUTOMATION_RATIO_THRESHOLD=0.5
CHAT_SESSION_RATE_PER_REGION_PER_MIN=500
```

**Express wiring**

* Mount `fastLanePopMiddleware` on `POST /api/pop`.
* Mount `rateLimits` on `GET /api/agent-states*`, `POST /api/chat/*`. (Checklist already has limiter scaffolding & metrics.)&#x20;

---

## 9) Data & contracts touched

* **DB:** `region_chat_mutes` table (already in schema) drives mutes; no additional PII.&#x20;
* **API responses:** continue to use standardized error envelope and rate‑limit headers per contracts.&#x20;
* **SSE:** unchanged; still broadcasting `agent_state_update` for aggregates.&#x20;

---

## 10) Testing & acceptance

**Unit**

* Fast‑lane validators: URL/email/phone patterns; dupe hash; velocity bucket; 422/429 envelopes.&#x20;
* Region mute policy: triggers, auto‑extend, auto‑unmute; Admin override.
* Rate‑limit middleware: per‑route bucketing + headers; gauges/counters. *(Checklist includes limiter tests—extend.)*&#x20;

**Integration**

* Burst spam simulation → expect 422/429 on POP/chat; aggregates still update from valid traffic; SSE remains healthy.
* Automation spike drill → region chat mutes within 1–2 min; banner displayed; unmute after normalization.
* Breaker outage drill → system degrades gracefully per runbook; mutes *not* used for upstream outages. &#x20;

**Load & UAT**

* 50 concurrent POPs + 50 SSE clients: verify rate‑limit/dupe guards, no identity leakage; dashboards show expected counters. *(Reuse existing load/SSE probes & acceptance flows.)*&#x20;

**Acceptance checklist**

* [ ] Only illegal/spam/automation is hard‑blocked; borderline content flows into aggregates with **no warnings**.
* [ ] 422/429/503 use standard envelopes + `trace_id`; `X‑RateLimit-*` present on 429.&#x20;
* [ ] Region chat mute engages on automation spikes; reads unaffected; banner shown; auto‑recovery works.&#x20;
* [ ] New abuse metrics/alerts live in dashboards and `monitor:ops` raises signals.&#x20;
* [ ] SLOs preserved under enforcement (city <10 s; ancestor <30 s; cached <500 ms; SSE <1–2 s).&#x20;

---

## 11) Deliverables for Codex (tickets)

1. **ABUSE‑01**: Implement `fastLanePopMiddleware` with URL/email/phone/dupe/velocity guards + tests + 422 envelopes.&#x20;
2. **ABUSE‑02**: Redis‑backed rate‑limits for `/api/agent-states`, `/api/chat/*`, SSE connection caps; emit `X‑RateLimit-*` + metrics. &#x20;
3. **ABUSE‑03**: Region chat mute policy engine + `region_chat_mutes` CRUD + Admin endpoints + banner wiring.&#x20;
4. **ABUSE‑04**: Metrics: `abuse_block_total`, `automation_block_total`, `rl_reject_total`, `region_chat_mute_*`; Grafana panels and alerts.&#x20;
5. **ABUSE‑05**: Integration tests (spam burst, automation spike, breaker drill) using existing SSE/load harness + runbook hooks. &#x20;
6. **ABUSE‑06**: Documentation: ops guide for tuning thresholds & interpreting dashboards; link to **Breaker & Retry Queue Recovery**.&#x20;

---

## 12) Alignment & compatibility

* Preserves **API Contracts** (errors, rate‑limit headers) and **Integration Architecture** (AgentState proxy, SSE event). No client changes for public reads beyond showing the **chat cooling‑off** banner when starting a session under mute. &#x20;
* Extends existing **Monitoring Plan** and runbooks; uses the same `/metrics`/`/api/metrics` surfaces and alerting CLI. &#x20;
* Meets MVP **performance & reliability** gates (SLOs + graceful degradation paths).&#x20;

---
