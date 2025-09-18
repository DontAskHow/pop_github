**Focused Document #8 — Semantic Engine (GPT‑5) Implementation Spec & Pipeline Contracts**
*Greenfield, Codex‑ready. This document defines the GPT‑5–powered “semantic congregator” service that turns raw POPs into a **single collective summary per region** (city/state/country), exposes lineage weights per POP, and powers region‑agent chat. It is the POP API’s only upstream dependency for aggregation/agent content and integrates via stable HTTP contracts and the `agent_state_update` SSE flow.* &#x20;

---

## 0) Role in the system & non‑negotiables

* **What it does:**

  1. Ingest POPs, canonicalize & screen; 2) compute **per‑POP contribution weights** for each `(region, prompt)`; 3) synthesize the **single collective summary** for each region; 4) maintain an **anonymized lineage vector** `{pop_public_id, weight_pct}`; 5) serve **region chat** anchored to the weekly prompt; 6) support **debounced ancestor rollups** (state/country) to meet SLOs.&#x20;
* **What it does not do:** expose stances or quotes in public payloads (UI shows **collective summary only**). The `agent_state_update` event remains the transport, but payloads omit stance/quote fields. &#x20;
* **SLOs:** City update **P95 < 10 s**, ancestor **P95 < 30 s** from submission; reads served from cache **P95 < 500 ms** via POP API; real‑time update propagation **< 1 s** end‑to‑end. Engine must instrument and expose the metrics POP relies on to enforce these SLOs. &#x20;

---

## 1) Service architecture (containers, modules, tech)

**Runtime:** Node 20 + TypeScript; **Hono** or Fastify HTTP server; pg driver for Postgres; Qdrant client; Redis client; OpenAI client (Chat Completions JSON‑mode).
**Processes:**

* **API** (sync): receives POP batches; returns region assignments; serves **collectives**, **lineage**, and **chat**.
* **Worker** (async): performs embeddings, weight calc, synth, **debounced ancestor rollups**, cache set, and publishes updated state (POP API will fetch & broadcast SSE).&#x20;
  **Data:** Postgres (authoritative), Qdrant (vectors), Redis (hot cache + coordination). Schema and keyspaces are defined in Doc #5 (used as‑is by engine).&#x20;

---

## 2) External contracts (POP API ↔ Engine)

> These replace legacy “stance/quotes” responses with **`CollectiveAgentState`** that contains a single `collective_summary` plus digest metadata. The **event type** remains `agent_state_update` and is emitted by POP API after it fetches updated state.&#x20;

### 2.1 Ingest POPs (idempotent batch)

`POST /engine/pops:batch` *(internal, API‑key)*

**Request**

```json
{
  "pops": [{
    "pop_public_id": "p_abc123",        // stable, anonymized (dedupe key)
    "account_id": "internal-stable-id", // not exposed downstream
    "prompt_id": "2025-W42",
    "text": "user text (≤1000 chars)",
    "detected_lang": "es",              // optional; engine will detect if absent
    "lat": 37.77, "lng": -122.42,       // optional; POP API provides region_id if known
    "region_id": "city:US:ca:san-francisco" // preferred if available
  }]
}
```

**Response (202)**

```json
{
  "accepted": 1,
  "rejected": 0,
  "region_assignments": [{ "pop_public_id": "p_abc123",
                           "region_id": "city:US:ca:san-francisco",
                           "confidence": 0.99 }]
}
```

* **Semantics:** Accepts and enqueues work; returns canonical `region_id` for immediate POP API refresh + SSE broadcast. Circuit‑breaker and retry behaviors live in POP API; engine stays simple and synchronous on this edge. &#x20;

### 2.2 Fetch collectives (region summary only)

`GET /engine/collectives?ids=city:US:ca:san-francisco,state:US:ca`

**Response (200)**

```json
[{
  "id":"city:US:ca:san-francisco",
  "level":"City",
  "prompt_id":"2025-W42",
  "collective_summary":"… (50–1200 chars) …",
  "updated_at":"2025-10-16T10:30:45Z",
  "x_meta":{ "pop_count":257, "weight_digest":{"gini":0.21,"mean":0.39} }
}]
```

* POP API caches this payload (TTL \~60 s) and serves it to mobile; when engine is slow/unavailable, POP API serves cache and sets “partial results” flags per Monitoring Plan.&#x20;

### 2.3 Fetch lineage (audit/tracing)

`GET /engine/collectives/:regionId/lineage?prompt_id=2025-W42`

**Response (200)**

```json
{
  "region_id":"city:US:ca:san-francisco",
  "prompt_id":"2025-W42",
  "lineage":[{"pop_public_id":"p_abc123","weight_pct":1.37}, ...],
  "model_versions":{"synthesizer":"gpt-5.2025-10","embedder":"text-embedding-3-large"},
  "prompts":{"synth_template_hash":"...","chat_template_hash":"..."},
  "created_at":"2025-10-16T10:30:45Z"
}
```

* **No user identifiers** are ever exposed; lineage is `pop_public_id` + weight only.&#x20;

### 2.4 Region agent chat

`POST /engine/collectives/:regionId/chat` *(internal, POP‑gated auth)*

**Request**

```json
{
 "prompt_id":"2025-W42",
 "locale":"pt",
 "messages":[{"role":"user","content":"…"}],
 "session": {"turn_limit":20,"idle_ttl_min":30}
}
```

**Response (stream or chunked)**

```json
{ "role":"assistant","content":"…reply in pt…" }
```

* **Behavior rules**: 20 turns/session; 30‑minute idle timeout; per‑region chat initiation cap (500/min) enforced by POP API/Redis. Replies are **anchored to the weekly prompt & region’s collective voice** (tone may be witty/blunt within platform safety).&#x20;

---

## 3) Ingestion & synthesis pipeline (step‑by‑step)

> The following pipeline is executed for **direct region (city)** immediately and for **ancestors (state, country)** via a **debounced rollup** (see §4). All steps write metrics and are observable by POP dashboards.&#x20;

1. **Validate & screen**

   * Enforce: 1–1000 chars; reject illegal content (CSAM, credible threats/terrorism) and spam/automation; otherwise accept. Map coordinates/IP to canonical `region_id` if missing. *(Hard‑block minimalism aligns with product policy.)*&#x20;

2. **Language detect & canonicalize**

   * Detect language; **translate to English** for embeddings/synthesis (“canonical\_en”); retain original for lineage. Translation providers: MT for bulk; LLM for expressive chat/summaries when needed.&#x20;

3. **Embeddings & vector insert (Qdrant)**

   * Upsert vector for `(pop_public_id, region_id, prompt_id)`; payload includes level and timestamps. Collection per prompt: `pop_embeddings_{prompt_id}` (cosine).&#x20;

4. **Contribution weights** *(per region,prompt)*

   * Compute centroid `c = normalize(mean(v_i))` over active POP vectors.
   * For each `v_i`, `raw_i = max(0, cos(v_i, c))`.
   * Normalize: `weight_pct_i = 100 * raw_i / Σ raw_i` (if all zeros, use uniform weights).
   * Persist `lineage_weight(region_id,prompt_id,pop_public_id,weight_pct)`; compute a **digest** (`mean,stddev,gini,topK,hist`) and store in `collective_state.weight_digest`. *(Satisfies the **per‑POP % weight** requirement for future tracing.)*
   * **Edits/deletes:** on edit, supersede prior POP and recompute weights; on delete within window, drop vector and recompute. (POP API guarantees one active POP per account per prompt.) &#x20;

5. **Synthesis (GPT‑5, JSON‑mode)**

   * Select **top‑K by weight** (e.g., K=400 cap) + low‑weight sample for diversity; construct prompt with **weekly question**, **region label**, **language hints**, and **weight bins**.
   * Ask GPT‑5 to output **only**: `{"collective_summary": "<50–1200 chars>","language":"<bcp47>"};` reject if outside bounds or if unsafe.
   * Write `collective_state(region_id,prompt_id,collective_summary,pop_count,weight_digest)`; cache in Redis; return to POP API on next fetch. *(This replaces legacy stance/quotes; UI renders **summary only**.)* &#x20;

6. **Publish & metrics**

   * Update gauges/counters: `rollup_processed_total`, `agent_state_refresh_last_latency_ms`, cache hit/miss/store, etc. POP API will **fetch and broadcast** `agent_state_update` to clients.&#x20;

---

## 4) Ancestor rollups (debounced orchestration)

* **When:** After a city update, **schedule** state then country refresh with staggered **debounce** (e.g., 6 s / 9 s).
* **How:** A `RollupProcessor` queues `state:` and `country:` refreshes; coalesces bursts; tracks `rollup_queue_size`, per‑level scheduled/processed counters, and latency.
* **SLOs:** P95 **< 30 s** to visible POP‑side refresh for ancestors; tune delays to hit target under load. *(POP plan and checklist already instrument rollup telemetry.)* &#x20;

---

## 5) Caching & consistency

* **Redis cache** for `CollectiveAgentState` keyed by `(region_id,prompt_id)`, TTL \~60 s; POP API is cache client of record.
* **Consistency model:** eventual across hierarchy; direct city updates are near‑immediate; ancestors are debounced.
* **Failure mode:** if synthesizer is slow/unavailable, POP API serves cached states and marks **partial results**; breaker/runbook guide recovery. &#x20;

---

## 6) Prompting & schemas (LLM contracts)

### 6.1 Collective synthesis (JSON‑mode)

**System**

```
You are the “collective voice” of {region_label}. Your job: write ONE concise
collective summary of what people in this region are expressing about:
"{weekly_prompt}". Do not include quotes, lists, hedging, or stance bars.
Length 50–1200 chars. Be faithful to weighted inputs.
```

**Developer**

```
- Language to write in: {display_locale}. If missing, write in English.
- You receive weighted clusters: [{weight_pct, text_en}, ...] (already canonicalized).
- Capture prevailing sentiment, themes, and distinctive local tone (playful, blunt, etc.)
- Safety: remove illegal content; otherwise reflect the collective honestly.
- Output JSON: {"collective_summary":"...", "language":"<bcp47>"}
```

**Checks:** Reject outputs that violate schema/length or include identities/PII; retry with stricter instructions; if still invalid, fallback to shorter deterministic template, then mark `x_meta.stale=true` for POP API to display a freshness cue.&#x20;

### 6.2 Region chat

**System**

```
You are the regional agent for {region_label}. Stay anchored to the weekly prompt:
"{weekly_prompt}". Respond in {user_locale}. Tone mirrors the region’s aggregate voice.
Never reveal individual sources or identities; speak as “we”.
```

**Developer**

```
Context:
- Latest collective summary (EN + {user_locale})
- Weight digest {gini, topK bins}
- Safety: block illegal; otherwise reflect authentic sentiment.
- Hard limits: 20 turns per session; close politely after 20; idle timeout 30 min.
```

**User**: freeform text (translated to EN for reasoning; reply in user locale).
**Output**: streaming assistant text; POP API enforces session/rate caps and persists transcripts (internal only).&#x20;

---

## 7) Data model usage (from Doc #5)

* **Postgres**: read/write `collective_state`, `lineage_weight`, `conversation*` tables; never store public user identifiers.
* **Qdrant**: `pop_embeddings_{prompt_id}` collection; payload includes `{pop_public_id, region_id, level, submitted_at}` (filters on `region_id`, `prompt_id`).
* **Redis**: agent‑state cache entries + light coordination (optional engine‑side, required POP‑side). *(Matches the integration plan and schema previously agreed.)*&#x20;

---

## 8) Internationalization & translation

* **Guaranteed locales:** en, es, pt, fr, de, hi, ja, ko, zh‑CN, zh‑TW.
* **Display choice:** POP chooses device locale by default with manual override; engine obeys requested `locale` for chat and `display_locale` for summaries.
* **Fallback:** if translation fails, engine returns original language and a flag for POP to show “auto‑translate unavailable.”&#x20;

---

## 9) Performance budgets & controls

* **Embedding pool & batching:** group vectors 32–128 per insert to Qdrant; reuse keep‑alive agents; cap parallel synth calls.
* **LLM knobs:** `OPENAI_TIMEOUT_MS` \~20 s, `OPENAI_MAX_RETRIES` = 2; city synth target 2–6 s average; ancestor synth amortized by debounce.
* **Memory & cache:** top‑K truncation of inputs to keep prompts under token budget; digest stats computed in‑process.
* **End‑to‑end SLO alignment:** POP probes measure POP→engine→POP latencies; engine exports gauges consumed by POP dashboards/alerts. &#x20;

---

## 10) Observability (metrics, dashboards, alerts)

Emit Prometheus/JSON metrics that **match POP’s Monitoring Plan** so one set of dashboards covers both services:

* `agent_state_refresh_last_latency_ms`, `agent_state_refresh_success_total|_failure_total`
* `rollup_queue_size`, `rollup_scheduled_<level>_total`, `rollup_processed_<level>_total`, `rollup_processed_latency_ms_total`
* `agent_state_cache_hit|miss|store|stale`, `agent_state_cache_size`
* `openai_request_total|error_total`, `embedding_request_total|error_total`
* `lineage_rows_written_total`, `collective_state_upserts_total`
* Health gauges & breaker state exported to POP where relevant (POP is alerting authority).&#x20;

**Runbooks & alerts:** POP monitors breaker/open states and retry queues; on sustained upstream faults follow **Congregator Breaker & Retry Queue Recovery** playbook.&#x20;

---

## 11) Security, privacy, and policy

* **Hard‑blocks only**: illegal content (CSAM; credible threats/terrorism) and spam automation; otherwise reflect authentic sentiment.
* **Anonymity:** only `pop_public_id` appears in lineage; no user identifiers on any read path.
* **Retention:** indefinite for POPs, collectives, chats; edits supersede within allowed window.
* **Auth:** service‑to‑service API‑key; engine never accepts public calls.&#x20;

---

## 12) Integration sequence (submission → user sees update)

1. Mobile submits POP → **POP API** writes DB → forwards to **Engine** `pops:batch`.
2. Engine ingests & **immediately** recomputes **city**; schedules **state/country** rollups (debounced).
3. POP API **fetches** `/engine/collectives?ids=…` for the affected regions, **caches**, then **broadcasts `agent_state_update`** to subscribed clients; reads hit **P95 < 500 ms** from POP cache. *(SSE behavior & cache policy per API contracts and monitoring plan.)* &#x20;

---

## 13) Testing & acceptance (engine)

* **Unit:** weighting math (normalization, zero‑vector guard), lineage serialization, JSON‑mode schema guards, translation fallbacks.
* **Integration:** POP→engine ingest; city synth latency; debounced state/country rollups under load; POP fetch & cache; SSE parity.
* **Load:** 100 POPs/min; ensure city **<10 s**, ancestor **<30 s**; cache hit rate ≥70% on read hotpaths (observed via POP metrics).
* **UAT:** collective‑only payloads; no quotes/stances; lineage safe; chat constraints enforced. *(Mirror POP’s Testing Strategy harnesses & SSE probes.)*&#x20;

---

## 14) Reference implementation blueprint (files & modules)

```
/engine
  /src
    server.ts                   // Hono/Fastify bootstrap, healthz, /metrics
    routes/
      pops.ts                   // POST /engine/pops:batch
      collectives.ts            // GET /engine/collectives
      lineage.ts                // GET /engine/collectives/:id/lineage
      chat.ts                   // POST /engine/collectives/:id/chat
    pipeline/
      ingest.ts                 // validate/screen/lang-detect/translate
      embeddings.ts             // batch Qdrant upserts
      weights.ts                // centroid, weights, digest
      synth.ts                  // GPT-5 JSON-mode, schema guard
      rollup.ts                 // debounced ancestor scheduler
    data/
      pg.ts, qdrant.ts, redis.ts
    observability/
      metrics.ts, logger.ts
    config.ts                   // timeouts, model names, debounce
```

* **Config (env):**
  `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5`, `EMBEDDINGS_MODEL=text-embedding-3-large`, `OPENAI_TIMEOUT_MS=20000`, `OPENAI_MAX_RETRIES=2`, `ROLLUP_DEBOUNCE_MS_STATE=6000`, `ROLLUP_DEBOUNCE_MS_COUNTRY=9000`, `CACHE_TTL_SEC=60`. *(Matches POP’s integration & checklist expectations.)* &#x20;

---

## 15) Deliverables Codex should generate (tickets)

* **ENG‑01**: HTTP server scaffolding + `/healthz`, `/metrics`; API‑key auth.
* **ENG‑02**: `pops:batch` handler (validate, region resolve, enqueue, return assignments).
* **ENG‑03**: `ingest` pipeline (detect, translate, screen) + Postgres writes.
* **ENG‑04**: Qdrant embeddings batcher; vectors per prompt; tests.
* **ENG‑05**: `weights` calculator + lineage/digest persistence; DDL hooks from Doc #5.&#x20;
* **ENG‑06**: `synth` (GPT‑5 JSON‑mode) + strict schema + retries; write `collective_state`.
* **ENG‑07**: `rollup` scheduler (debounced ancestors) + metrics.&#x20;
* **ENG‑08**: `collectives` read path + Redis cache; POP cache hints.
* **ENG‑09**: `lineage` endpoint (anonymized only).
* **ENG‑10**: `chat` endpoint (tone rules, prompt anchoring, translation I/O, session limits mirrored from POP).&#x20;
* **ENG‑11**: Observability: wire all gauges/counters named in the Monitoring Plan; runbook links. &#x20;
* **ENG‑12**: E2E tests with POP harness & SSE probe; load/rollup probes; pass SLO gates. &#x20;

---

## 16) Acceptance checklist (engine)

* [ ] City synthesis visible via POP within **<10 s** P95; **agent\_state\_update** fired to clients.&#x20;
* [ ] State/country rollups visible **<30 s** P95; queue/latency metrics green.&#x20;
* [ ] `CollectiveAgentState` contains **only** `collective_summary` (+ digest meta), no stance/quotes; lineage API safe.&#x20;
* [ ] Cache hit rate ≥70% on POP read path; cached reads **<500 ms** P95.&#x20;
* [ ] Chat replies obey tone rules, prompt anchoring, and session/rate limits; transcripts stored internally.&#x20;
* [ ] Monitoring dashboards & **Congregator Breaker** runbook validated in a chaos drill.&#x20;

---
