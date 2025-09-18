**Focused Document #7 — POP API (Public Edge) Service Spec & Reference Implementation Plan**
*Greenfield, Codex‑ready. This service is the client‑facing backend for the POP mobile app and the single integration point to the GPT‑5–powered Semantic Congregator. It exposes submission, read, chat, and real‑time streaming endpoints and enforces the commercial MVP guardrails and SLOs.* &#x20;

---

## 0) Goals & non‑negotiables

* **What this service does:** (1) Accepts POP submissions; (2) returns **one collective summary** per region (no stance distribution, no quotes); (3) streams real‑time updates; (4) fronts region‑agent chat; (5) caches hot reads; (6) degrades gracefully if the engine is slow/unavailable.&#x20;
* **SLOs at the edge:** City update **P95 < 10 s** (submit→visible); ancestor rollups **P95 < 30 s**; cached reads **P95 < 500 ms**; SSE **E2E < 1 s**; ≥99.9% availability over the MVP period.&#x20;
* **Policy:** Anonymous UI (no identities); one POP per account per prompt; indefinite retention; automated hard‑blocks for illegal content & spam only; pre‑login map/read allowed—submit/chat gated to auth.&#x20;

---

## 1) Tech stack & core components

* **Runtime:** Node 20 + TypeScript; **Fastify** (or Express with equivalent middlewares) + **pino** logging.
* **Data:** PostgreSQL (authoritative POPs, collectives, lineage, conversations), Redis (agent‑state cache, rate limits, SSE backlog), Qdrant used by the engine (not directly by edge).
* **Integration:** **Semantic Congregator** (HTTP, private network, API‑key auth). Edge wraps a **circuit breaker** + retry policies around engine calls and supplies a **feature flag** to disable the engine if needed, serving cache/stale. &#x20;
* **Observability:** /metrics (Prometheus), JSON snapshot, dashboards & alerts per Monitoring Plan; runbook hooks documented. &#x20;

---

## 2) Public API surface (v1)

> **Canonical DTO:** `CollectiveAgentState` with a single `collective_summary` plus optional digest metadata; no stance/quotes fields exist in this greenfield API. The event stream uses **`agent_state_update`** with this payload.&#x20;

### 2.1 Submit a POP

`POST /v1/pops` — *Auth required*

**Body**

```json
{
  "prompt_id": "2025-W42",
  "text": "≤1000 chars",
  "lat": 37.77, "lng": -122.42,             // optional (GPS); if absent, IP city must resolve
  "city": "san-francisco", "state": "ca",    // optional hints
  "country": "US"
}
```

**Behavior**

* Validates inputs; **enforces one active POP per (account\_id, prompt\_id)** with supersession for edits inside the edit window. If city cannot be reliably resolved (GPS/IP), **reject** (422) to protect aggregation quality.&#x20;
* Persists POP (Postgres).
* **Dual‑write** to the engine (async—breaker protected). On success, force **city synthesis now** and schedule debounced **ancestor** rollups; publish **SSE** when fresh agent state arrives. &#x20;
* **201** with `{ pop_public_id, region_assignments[] }`.

**Errors**
`409 already_submitted`, `422 invalid_location`, `429 too_many_requests`, `503 upstream_unavailable` (with `retry_after`). Error envelope includes `trace_id`.&#x20;

---

### 2.2 Read collective agent states

`GET /v1/agent-states?ids=city:US:ca:san-francisco,state:US:ca` — *Public (no auth)*

**Returns (cached)**

```json
{
  "agents": [ { "id":"city:US:ca:san-francisco", "level":"City",
    "prompt_id":"2025-W42", "collective_summary":"…", "updated_at":"…",
    "x_meta":{"pop_count":257,"weight_digest":{"gini":0.21}} } ],
  "metadata": { "cached_at":"…", "ttl_seconds":60, "source":"cache", "partial_results":false }
}
```

* **Cache first** (Redis 60 s TTL), with **`refresh=true`** to force a fetch. Partial results surface when the breaker is open. **P95 < 500 ms** from cache.&#x20;
* Validates region IDs (`^(city|state|country):[A-Z]{2}(:[a-z0-9-]+)*$`).&#x20;

---

### 2.3 Lineage vector (anonymized)

`GET /v1/agent-lineage/{regionId}?prompt_id=2025-W42` — *Public*

* Returns `{ pop_public_id, weight_pct }[]`, model versions, and prompt template hashes for auditability; **never** exposes user identity.&#x20;

---

### 2.4 Region agent chat

`POST /v1/agent-conversation/{regionId}` — *Auth required*

**Body**

```json
{ "prompt_id":"2025-W42","locale":"es",
  "messages":[{"role":"user","content":"¿Qué piensa esta región?"}] }
```

* **Limits:** 20 turns/session, 30‑min idle ttl, per‑region **500 new sessions/min** cap; 429 on overage. Stores transcripts server‑side only.&#x20;

---

### 2.5 Real‑time updates (SSE)

`GET /v1/events?regions=city:US:ca:san-francisco,state:US:ca`

* Emits **`agent_state_update`** events with the fresh `CollectiveAgentState`. Supports **region filters**, per‑region sequence numbers, **backlog replay**, and **reconnect** with exponential backoff. **E2E < 1 s** target. &#x20;

---

## 3) Internal integration with the Semantic Congregator (engine)

* **Endpoints used by edge:**

  * `POST /engine/pops:batch` (ingest & canonicalize; returns region assignments)
  * `GET /engine/collectives?ids=…` (fetch compute/collective for regions; may trigger synth)
  * `GET /engine/collectives/{regionId}/lineage?prompt_id=…` (audit vector)
  * `POST /engine/collectives/{regionId}/chat` (chat handler)
* **Hardening:** API‑key auth; **circuit breaker** with timeouts/retries and **observability counters**; async **retry queue** for failed dual‑writes; configurable **debounce** for ancestor rollups to hit SLOs. &#x20;

> **Operational pattern:** On POP submission, the edge stores the pop, forwards to engine, and immediately attempts a city refresh; ancestor refreshes are **debounced** (e.g., state \~6 s, country \~9 s) to meet **<30 s** roll‑up. Track with `rollup_queue_size` and `agent_state_refresh_last_latency_ms`.&#x20;

---

## 4) Security, auth & rate limits

* **Auth:** OAuth JWT (Google, Facebook, X) and **Sign in with Apple** on iOS. Age gate **13+** enforced in app; server trusts verified tokens.&#x20;
* **Rate limits (headers `X‑RateLimit-*`):**

  * POP submit: 10/min/account
  * Agent states: 60/min/IP
  * Chat session init: **500/min/region** (global cap enforced in Redis)
  * SSE connections: 1 concurrent/client (soft), total server cap enforced. &#x20;
* **PII/Privacy:** Edge never returns any user identifiers; lineage IDs are `pop_public_id` only. Logs strip content; metrics contain aggregates.&#x20;

---

## 5) Caching, SSE & resilience design

### 5.1 Agent‑state cache (Redis)

* Keys: `pop:agent:v1:{region_id}:{prompt_id}` (payload `CollectiveAgentState`, **TTL 60 s**); ETag key; hit/miss/stale/store counters; background refresh loop optional. **Cached P95 < 500 ms**.&#x20;

### 5.2 SSE manager

* Region‑filtered broadcasting; monotonic per‑region sequences; backlog list `pop:sse:backlog:{stream_id}` (≈500 events); reconnect replay; connection gauges. **Drop duplicates**, maintain order. &#x20;

### 5.3 Circuit breaker & retry queue

* Breaker around engine calls (closed/half‑open/open gauges); async retry on failed dual‑writes; automatic recovery when engine health returns; **runbook** linked from alerts. &#x20;

---

## 6) Error envelopes (all endpoints)

```json
{
  "error": "invalid_region_id | already_submitted | too_many_requests | synthesis_timeout | upstream_unavailable",
  "message": "human readable",
  "retry_after": 30,
  "trace_id": "req_abc123"
}
```

* 4xx for validation/auth; 429 for rate limits; 5xx for upstream or internal errors. Log structured context; increment `log_error_total`. &#x20;

---

## 7) Reference implementation (file layout & scaffolding)

**Node/TS service layout**

```
/src
  /config             // env, flags (ENABLE_SEMANTIC_CONGREGATION, etc.)
  /lib
    congregatorClient.ts      // timeouts, retries, API-key
    circuitBreaker.ts         // closed/open/half-open with metrics
    agentStateCache.ts        // Redis cache ops + metrics
    sseManager.ts             // region-filtered broadcast, backlog, seq
    rateLimiter.ts            // per-route sliding windows
  /routes
    pops.ts                   // POST /v1/pops
    agentStates.ts            // GET /v1/agent-states
    lineage.ts                // GET /v1/agent-lineage/:regionId
    conversation.ts           // POST /v1/agent-conversation/:regionId
    events.ts                 // GET /v1/events (SSE)
  /services
    popSubmissionService.ts   // dual-write & refresh trigger
    rollupService.ts          // schedule ancestor refresh (debounced)
  /metrics           // Prometheus exporter wiring
  /middleware        // auth, validation, request-id, logging
```

* Include unit tests for breaker/HTTP client/cache/SSE; integration tests for POP→Engine→SSE, per Testing Strategy.&#x20;

**Engine client (sketch)**

```ts
class EngineClient {
  constructor(private baseURL: string, private apiKey: string, private timeout=5000) {}
  async popsBatch(pops: any[]) { /* POST /engine/pops:batch with retries */ }
  async fetchCollectives(ids: string[]) { /* GET /engine/collectives?ids=... */ }
  async fetchLineage(regionId: string, promptId: string) { /* GET lineage */ }
  async chat(regionId: string, body: any) { /* POST chat */ }
}
```

Instrument with `congregator_breaker_state`, `agent_state_batch_success|failure`, and request logs (redacting secrets).&#x20;

---

## 8) Configuration & environment

**Edge service (examples)**

```
PORT=5000
NODE_ENV=production
JWT_ISSUERS=google,facebook,x,apple
DATABASE_URL=postgres://...
REDIS_URL=rediss://...
ENGINE_BASE_URL=https://engine.internal
ENGINE_API_KEY=***
REGION_CACHE_TTL_SEC=60
SSE_BACKLOG_SIZE=500
CHAT_TURN_LIMIT=20
CHAT_SESSION_TTL_MIN=30
REGION_SESSION_RATE_LIMIT_PER_MIN=500
ENABLE_SEMANTIC_CONGREGATION=true
ENABLE_HIERARCHICAL_ROLLUP=true
```

Flags and env names align with the Integration Architecture & Implementation Checklist to keep CI and runbooks consistent. &#x20;

---

## 9) Observability (what to emit)

* **Ingest & dual‑write:** `pop_submission_total`, `dual_write_success_rate`, `congregator_retry_queue_size`, breaker transitions (`congregator_breaker_*`).
* **Rollups:** `rollup_queue_size`, `rollup_scheduled_*`, `rollup_processed_total`, `agent_state_refresh_last_latency_ms`.
* **Cache:** `agent_state_cache_hit|miss|stale|store`, `agent_state_cache_size`.
* **SSE:** `sse_active_clients`, `agent_state_update_total`.
* **Chat & overlay usage:** `chat_overlay_served_total`, selected chat event counters.
  Dashboards & alert thresholds per Monitoring Plan; on P1/P0 alerts, follow **Congregator Breaker & Retry Queue** runbook. &#x20;

---

## 10) Performance & capacity

* **Concurrency targets (MVP):** 100 POP/min peak; 50–100 concurrent viewers; 500 agent‑state rps during bursts. Edge holds steady via cache, pooling, and batch fetches to engine.&#x20;
* **Budgets:** POP → city fresh **<10 s**; ancestor **<30 s**; cached read **<500 ms**; **SSE <1 s**; soak tests & synthetic probes enforce these budgets in CI/stage.&#x20;

---

## 11) Security & privacy

* **Anonymity by design:** No user identifiers in any public payload; lineage exposes only `pop_public_id` + weight.
* **Content controls:** Only illegal content & spam are hard‑blocked at ingest; other content surfaces into the collective summary without editorial weighting.
* **Transport & storage:** TLS everywhere, at‑rest encryption, secrets rotated quarterly; rate limits & WAF at the edge.&#x20;

---

## 12) Acceptance tests (edge)

Map tests to the **Testing Strategy**; automate with Playwright + Node probes.

1. **Happy path E2E**
   Submit POP → city collective **<10 s** → SSE received → cached read **<500 ms** → ancestor updates **<30 s**. Verify payload shape (`collective_summary`) and event type.&#x20;

2. **Breaker & degradation**
   Kill engine → edge serves cache with `partial_results:true`, breaker metrics trip, runbook validation; recovery closes breaker; backlog drains.&#x20;

3. **SSE ordering & replay**
   N=50 clients; verify monotonic sequences; replay on reconnect (no gaps).&#x20;

4. **Rate‑limit & auth**
   POP submit limit per account; chat session per‑region cap (500/min); public reads without auth; auth required for submit/chat.&#x20;

5. **Cache hit‑rate**

> 70% under steady viewport reads; P95 **<500 ms**; metrics panel confirms.&#x20;

---

## 13) Deployment blueprint (single region, prod‑ready)

* **LB + WAF → POP API containers (2–3 replicas)** with sticky SSE allowed; auto‑scale on CPU or rps.
* **Private networking** to Engine service; Redis (HA) for cache/SSE; Postgres managed instance.
* **CDN** in front of static & map assets; API excluded from CDN (dynamic). Healthz, readiness probes, and metrics scrape enabled. &#x20;

---

## 14) Developer runbook (edge quick actions)

* **Toggle engine off (temporary):** `ENABLE_SEMANTIC_CONGREGATION=false` → serve cache/legacy minimal content while investigating.
* **Breaker alert fired:** check `/metrics` (`congregator_breaker_state`), inspect retry queue, verify engine health; follow recovery steps; validate with SSE and rollup probes.&#x20;

---

## 15) API examples

**A) SSE event**

```
event: agent_state_update
data: {"region_id":"city:US:ca:san-francisco","agent_state":{...},"updated_at":"2025-10-16T10:31:05Z","change_type":"updated","trigger_reason":"new_pop"}
```

Matches the public stream contract and the mobile client’s expectations.&#x20;

**B) Lineage read**
`GET /v1/agent-lineage/city:US:ca:san-francisco?prompt_id=2025-W42` →

```json
{ "lineage":[{"pop_public_id":"p_3h7k2...","weight_pct":1.37}, ...],
  "model_versions":{"synthesizer":"gpt-5.2025-10","embedder":"text-embedding-3-large"},
  "prompts":{"synth_template_hash":"…","chat_template_hash":"…"},
  "cached_at":"…"}
```

Vectors are anonymized and safe to expose in analytic views.&#x20;

---

