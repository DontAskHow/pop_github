**Focused Document #2 — Semantic Congregator (GPT‑5) & Integration Architecture**
*Greenfield spec; commercial‑grade; Codex‑ready. This document defines the semantic engine that powers POP’s collective regional voices and the contracts by which the mobile app and POP API use it.*

---

## 0) Purpose & Responsibilities

**The Semantic Congregator** is a stateless HTTP service (with backing stores) that:

1. **Ingests POPs** (location‑anchored user messages for the current weekly prompt).
2. **Canonicalizes & screens** inputs (language detection, translation to canonical EN, automated hard‑block/anti‑spam only).
3. **Computes per‑POP contribution weights** for *(region, prompt)* and **synthesizes a single collective summary** for each region tier (city → state → country).
4. **Exposes read APIs** for collective states and full lineage (including per‑POP weights for tracing—anonymized).
5. **Supports chat** with any region’s collective agent (prompt‑anchored, playful tone, translated as needed).
6. **Emits real‑time updates** so clients refresh within SLOs.

> Integration patterns—proxy read APIs, SSE event type, and lineage endpoints—mirror the established POP↔Engine contracts and observability approach.  &#x20;

---

## 1) High‑Level Architecture

**Components**

* **Congregator API** (Hono/Fastify or similar) — stateless HTTP + SSE publisher.
* **Ingestion Worker** — validates POPs, canonicalizes text, computes embeddings, persists raw docs.
* **Aggregation Orchestrator** — schedules synth jobs per *(region, prompt)*; debounces ancestor rollups.
* **Synthesizer** — calls **GPT‑5** Chat Completions in JSON mode to produce one **collective\_summary** string; no stances/quotes.
* **Contribution Weighter** — computes per‑POP influence (%); stores full vector for lineage + reduces to digests for read path.
* **Conversation Service** — region‑agent chat (20‑turn/session cap, prompt‑anchored), with translation in/out.
* **Stores** —

  * **Relational** (Postgres/Neon): POPs, regions, prompts, conversations, collective states.
  * **Vector** (Qdrant): POP embeddings per *(prompt, region)* for weighting & retrieval.
  * **Cache** (Redis/Upstash): hot collective states + chat persona priming.
* **Observability** — Prometheus metrics + structured logs; runbooks + alert thresholds. &#x20;

**Traffic flow (write)**

1. Mobile → **POP API** → `POST /engine/pops:batch` (internal edge)
2. Congregator persists POPs, recomputes **city** collective immediately; **state/country** via **debounced rollup** (<30s P95), then **pushes update**.&#x20;

**Traffic flow (read)**

* Mobile → POP API proxy → `GET /engine/collectives?ids=…` (cached), and stream **`agent_state_update`** SSE for changes.&#x20;

---

## 2) Data Contracts (greenfield, minimal surface)

### 2.1 Types

```ts
type RegionLevel = 'City' | 'State' | 'Country';

type Locale = 'en'|'es'|'pt'|'fr'|'de'|'hi'|'ja'|'ko'|'zh-CN'|'zh-TW';

interface PopIngest {
  pop_id: string;            // server-issued UUIDv7
  account_public_id: string; // stable, non-public hash; not shown in UI
  prompt_id: string;         // e.g., "2025-W42" (global weekly)
  original_text: string;     // 1..1000 chars
  detected_lang?: string;    // ISO 639-1
  lat?: number; lng?: number; // if provided
  city?: string; state?: string; country: string; // when derived
  submitted_at: string;      // ISO
}

interface CollectiveAgentState {
  id: string;                // region ID e.g., "city:US:ca:san-francisco"
  level: RegionLevel;
  prompt_id: string;
  collective_summary: string; // 50..1200 chars; no stance/quotes
  updated_at: string;        // ISO
  x_meta?: {
    pop_count: number;
    // Optional digest for future tracing visuals (no identities exposed)
    weight_digest?: {
      mean: number; stddev: number; gini: number;
      topk?: Array<{ pop_public_id: string; weight_pct: number }>; // k ≤ 20
      histogram?: Array<{ bin: [number, number]; count: number }>;
    };
  };
}

interface CollectiveLineage {
  id: string;                 // region ID
  prompt_id: string;
  pop_weights: Array<{ pop_public_id: string; weight_pct: number }>; // full vector
  model_versions: { synthesizer: string; embedder: string; translator: string };
  prompts: { synth_template_hash: string; chat_template_hash: string };
  created_at: string;
}

interface CollectiveChatRequest {
  region_id: string;
  prompt_id: string;
  locale?: Locale;            // desired display language (default device locale)
  messages: Array<{ role: 'user'|'assistant'|'system'; content: string; }>;
  session_id?: string;        // for 20-turn cap tracking
}

interface CollectiveChatResponse {
  region_id: string;
  prompt_id: string;
  message: { role: 'assistant'; content: string; };
  tokens?: { prompt: number; completion: number };
  translated?: boolean;
}
```

> The **CollectiveAgentState** replaces earlier “AgentState” (stance/quotes) with a single summary and optional weight digests. SSE continues to broadcast **`agent_state_update`** events with this payload.&#x20;

### 2.2 Endpoints (internal; POP API proxies external calls)

**Ingestion**

* `POST /engine/pops:batch` → `{ accepted, rejected, region_assignments[], processing_time_ms }`

  * Region assignment is returned for city/state/country keys; used to trigger cache refresh + SSE.&#x20;

**Collectives (read)**

* `GET /engine/collectives?ids=city:US:ca:san-francisco,state:US:ca`
  → `{ agents: CollectiveAgentState[], metadata: { cached_at, ttl_seconds, source, partial_results } }`

  * POP API exposes this as `GET /api/agent-states` (internal‑only).&#x20;

**Lineage (weights vector)**

* `GET /engine/collectives/:regionId/lineage?prompt_id=…` → `CollectiveLineage`

  * POP API proxies as `GET /api/agent-lineage/:regionId`.&#x20;

**Collective chat**

* `POST /engine/collectives/:regionId/chat` (JSON; supports text‑stream) → `CollectiveChatResponse`

  * POP API exposes `POST /api/agent-conversation/:regionId` (auth required).

**Real‑time**

* SSE event **`agent_state_update`**

  ```json
  // event: agent_state_update
  // data:
  {
    "region_id":"city:US:ca:san-francisco",
    "agent_state": { ...CollectiveAgentState },
    "updated_at":"2025-10-16T10:30:00Z",
    "change_type":"updated",
    "trigger_reason":"new_pop"
  }
  ```

  Clients may filter by `?regions=` and reconnect with backlog replay.&#x20;

> Rate limits, API‑key auth, error envelopes, and 429/503 behaviors follow the same standards referenced in the POP↔Engine contract.&#x20;

---

## 3) Ingestion & Canonicalization Pipeline

**Steps (per POP):**

1. **Validate** (length ≤1000; coordinates or resolvable city/state/country required when GPS denied).
2. **Region Derivation** — reverse geocode with Google Maps; normalize to canonical region IDs:
   `city:US:ca:san-francisco` → ancestors `['state:US:ca','country:US']`.
3. **Language Detect** (CLD3 or provider); **translate to EN** (canonical) for synthesis; store **original** + **detected\_lang** + **canonical\_en**.
4. **Automated screening** — hard‑block CSAM/credible criminal/terror threats and **spam/automation**. No other content suppression (authenticity first).
5. **Embeddings** — compute vector on *canonical\_en* (e.g., text‑embedding model), store in Qdrant with tags *(prompt\_id, region\_id)*.
6. **Persist** POP in Postgres with a **public POP ID** (`pop_public_id = hash(salt, prompt_id, pop_id)`) for anonymized lineage.
7. **Schedule aggregation** immediately for **city** and **debounced** for **ancestors** (<30 s P95).

> Region ID formats and ancestor derivation follow the region hierarchy model.&#x20;

---

## 4) Contribution Weights (for tracing & quality)

**Goal:** produce a **weight % per POP** within *(region, prompt)* that reflects representativeness and influence—without revealing identities.

**Definition (per region, prompt):**
For each POP $i$, compute:

* **Similarity** to the region centroid in embedding space: $s_i \in [0,1]$.
* **Recency factor** within the prompt week: $r_i \in [0.9,1.0]$ (light bias).
* **Length penalty** for extremely long/short texts: $\ell_i \in [0.9,1.0]$.
* **Anti‑spam dampening**: down‑weight near‑duplicates across accounts (MinHash/SimHash).

Raw score: $\tilde{w}_i = s_i \cdot r_i \cdot \ell_i$.
Normalize: $w_i = \tilde{w}_i / \sum_j \tilde{w}_j$.
Store **`w_i` as `weight_pct`** (0–100, 2 decimals).

**Storage & exposure**

* **Full vector** stored in lineage (`pop_public_id` → `weight_pct`).
* **Digest** in **`CollectiveAgentState.x_meta.weight_digest`**: `{ mean, stddev, gini, topk, histogram }` to support lightweight visuals now and richer tracing later—without exposing identities on the map.
* **No quotes** and **no stances** are produced anywhere.

---

## 5) Synthesis (GPT‑5) — prompt templates & JSON mode

**SLO Targets**: City synthesis P95 < **10s**; ancestor P95 < **30s**; cached reads < **500ms**; SSE E2E < **1s**. &#x20;

**Input bundle to GPT‑5 (Synthesizer):**

* `prompt_id`, `region_id`, **canonical EN strings** for the top‑N weighted POPs (e.g., N=200 bounded by token budget), plus **weight summaries**.
* Instructional control tokens: “one cohesive summary; no lists; reflect collective tone; avoid quoting individuals; no stances; length ≤1200 chars.”

**System message (sketch)**

```
You are the collective voice for {region_name} responding to the global prompt:
"{prompt_text}" for week {prompt_id}.
Speak as a single personality that truthfully reflects the aggregate inputs.
Never include individual quotes or percentages. No stance bins.
Tone: playful, lively, truthful; witty or irreverent if the aggregate leans that way.
Output JSON exactly matching: {"collective_summary": "<string 50..1200 chars>"}.
```

**User content (sketch)**

```
Context:
- Region: {region_id}, Level: {level}
- Weighted inputs (canonicalized): [{text, weight_pct}, ... up to N]
- Overall signals: {pop_count, weight_digest}

Task:
Synthesize one paragraph that captures the collective point of view succinctly.
```

**Model call**

* **Endpoint**: Chat Completions, **strict JSON schema**, retries/backoff, timeouts; streaming not required for synthesis results.
* **Provider** settings (environment‑driven): `OPENAI_MODEL=gpt-5` (primary), `OPENAI_MAX_RETRIES`, `OPENAI_TIMEOUT_MS`. &#x20;

---

## 6) Collective Chat (region agent)

**Behavior**

* 20 turns per session; 30‑minute idle timeout; 500 new sessions/min per region cap.
* Always **anchor** replies to the week’s prompt; style mirrors region personality inferred from inputs.
* Automated safety (same hard‑blocks as ingestion).
* **Translation policy**: messages translated to canonical EN → GPT‑5 → result translated back to user’s locale. High‑impact outputs (chat + collectives) may be *polished* via LLM‑grade translation to preserve tone; standard MT is acceptable for raw POP text.

**API**

* `POST /engine/collectives/:regionId/chat` with `{ prompt_id, messages, locale }` → assistant message (optionally stream tokens).
* The POP API proxies as `/api/agent-conversation/:regionId` and increments chat metrics. &#x20;

---

## 7) Caching, Debounce & Real‑time

**Cache**

* Collective states cached for **60s TTL** with background refresh; POP API reports `source: 'cache'|'engine'` and `partial_results` on degradation.&#x20;

**Rollup debounce**

* City: immediate.
* State/Country: **debounced** (e.g., 4–8s base; exponential when busy) to meet **<30s P95** ancestor target. Queue metrics recorded. &#x20;

**SSE**

* On successful city synthesis (and each ancestor completion) publish **`agent_state_update`** with the **new `CollectiveAgentState`**.
* Server maintains region‑filtered subscriptions, sequence numbers, and reconnection backlog. &#x20;

---

## 8) Security, Privacy, Moderation

* **Auth**: POP API ↔ Congregator uses API keys and per‑endpoint rate limits; client traffic only hits POP API.&#x20;
* **Anonymity**: no usernames/avatars ever exposed; **`pop_public_id`** is a salted hash unique to *(prompt, pop\_id)*.
* **Retention**: **indefinite** for POPs, collectives, chats (per product directive).
* **Moderation**: automated **hard‑blocks only** (CSAM, credible violent/terror threats, and platform‑destabilizing spam/automation). Borderline speech is allowed and can influence the collective.
* **Regional mutes**: if automated block rate spikes, temporarily **mute chat** for that region with a subtle message; auto‑resume on stabilization.
* **Store compliance**: keep a **feature flag** to raise strictness if a store review requires it; maintain Sign in with Apple on iOS (when offering other providers).
* **Runbooks**: circuit‑breaker/open‑AI outage, retry queue drain, and failover paths documented and alertable.&#x20;

---

## 9) Observability & SLOs (minimum set)

**SLOs**

* City synth P95 < **10s**; Ancestor P95 < **30s**; Cached read P95 < **500ms**; SSE E2E < **1s**; Availability ≥ **99.9%**.

**Metrics (examples)**

* **Ingestion**: `pop_submission_total`, forward success/failure/queue gauges.
* **Synthesis**: `agent_state_refresh_last_latency_ms`, `rollup_queue_size`, scheduled/processed counters per level.
* **Cache**: hit/miss/store/stale and size gauges.
* **SSE**: active clients, update totals, backlog, reconnects.
* **Breaker**: state gauge + opens/half‑opens counters.
* **Chat**: overlay served totals, new sessions/sec per region, throttled count.
  Dashboards + alert thresholds follow the monitoring plan.&#x20;

---

## 10) Error Handling & Resilience

* **Idempotent ingestion** via `(prompt_id, account_public_id)` uniqueness (one POP per week).
* **Circuit breaker** around GPT‑5 calls with retries/backoff; queue failed synth tasks for replay.
* **Graceful degradation**: serve cached collectives when synthesis fails; lineages may lag without breaking the UI.
* **Chaos drills & runbooks** ensure fast recovery on upstream failures.&#x20;

---

## 11) Testing & Acceptance (engine‑centric)

**Unit**

* Validation, region mapping, weighting math, JSON schema guards for GPT‑5 replies, cache TTLs.

**Integration**

* POP→Ingest→Collective synth→SSE broadcast “happy path”.
* Debounced ancestor rollups under load; verify **<30s P95**.
* Chat sessions with 20‑turn cap; rate‑limit behavior; translation fallback.
* Breaker/queue chaos tests and recovery validation.

**UAT (selected)**

* Submit POP; **city updates <10s**, **SSE <1s**.
* Zoom out: **state/country** reflect update **<30s**.
* Chat references the week’s prompt and matches regional tone; transcripts persist; anonymity preserved.
  Testing structure and sample harnesses align to the strategy file.&#x20;

---

## 12) Configuration (env)

```bash
# Congregator
PORT=8789
OPENAI_API_KEY=***
OPENAI_MODEL=gpt-5            # production model for synth + chat
OPENAI_TIMEOUT_MS=20000
OPENAI_MAX_RETRIES=2
EMBEDDINGS_MODEL=text-embedding-3-large
CANONICAL_LANG=en
ROLLUP_DEBOUNCE_MS_CITY=0     # immediate
ROLLUP_DEBOUNCE_MS_STATE=6000 # tune to meet <30s P95
ROLLUP_DEBOUNCE_MS_COUNTRY=9000
CACHE_TTL_SEC=60
REGION_SESSION_RATE_LIMIT_PER_MIN=500
CHAT_TURN_LIMIT=20
CHAT_SESSION_TTL_MIN=30
HARD_BLOCK_ENABLED=true
# Stores
DATABASE_URL=postgres://...
QDRANT_URL=...
REDIS_URL=...
# POP API ↔ Engine
ENGINE_API_KEYS=pop-api:secret...
```

---

## 13) Implementation Plan (tasks Codex can execute)

**A. Service Skeleton**

* Create **/engine** service with endpoints in §2.2; wire API‑key auth & rate limits; add `/healthz`.

**B. Canonicalization**

* Modules: language detect, MT translate to EN, PII/hard‑block filters, embeddings writer.

**C. Weighting & Synthesis**

* Implement **Contribution Weighter** (embedding centroid + penalties).
* Implement **Synthesizer** (GPT‑5 JSON mode + schema enforcement); persist `CollectiveAgentState`.

**D. Rollups & SSE**

* Orchestrator with per‑level debounce; queue + worker; publish SSE **`agent_state_update`** on success.

**E. Lineage**

* Persist full `pop_weights` vector (anonymized IDs) and return via §2.2 lineage endpoint; compute digests for read path.

**F. Conversation**

* Build chat endpoint with turn/session limits, translation in/out, and assistant tone policy.

**G. Caching**

* Layer Redis (or in‑proc LRU) for state cache with TTL & background refresh.

**H. Observability**

* Expose metrics from §9; wire breaker/queue gauges; provide `RUNBOOK_CONGREGATOR_OUTAGE` link in dashboards.&#x20;

**I. Tests**

* Unit suites (validation/weighting/JSON schema); integration harness (ingest→synth→SSE); load probes for rollups and chat; follow testing strategy scaffolds.&#x20;

---

## 14) Mobile & POP API Integration (interfaces)

* Mobile (Flutter) calls **POP API** only.
* **POP API** proxies:

  * `POST /api/pop` → forwards to `POST /engine/pops:batch`.
  * `GET /api/agent-states?ids=` → proxies to `GET /engine/collectives`.
  * `GET /api/agent-lineage/:regionId` → proxies to `GET /engine/collectives/:regionId/lineage`.
  * `POST /api/agent-conversation/:regionId` → proxies chat.
* **SSE**: client subscribes to `/api/events` for **`agent_state_update`** and updates its view.
  These proxy patterns and event shapes match the existing contracts and integration architecture templates.  &#x20;

---

### Appendix: Error Envelopes & Rate Limits (summary)

* 400/401/403/422 for validation/auth; 429 for rate‑limit; 5xx with `retry_after` guidance when GPT‑5/upstreams are degraded. Standardized error body + trace id.&#x20;

---
