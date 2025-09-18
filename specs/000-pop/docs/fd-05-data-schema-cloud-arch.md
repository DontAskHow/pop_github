**Focused Document #5 — Data Storage, Schema & Cloud Architecture (Greenfield, Codex‑ready)**
*This document specifies the persistent data model, caches, vector/indexing strategy, and a single‑region production deployment blueprint for the POP MVP and the GPT‑5–powered Semantic Congregator. It encodes: one weekly global prompt, one POP per account per prompt, anonymous UI, per‑POP contribution weights, a **single collective summary** per region (no stances/quotes), real‑time SSE updates, and indefinite retention.*
*Event shapes, proxy patterns, and observability hooks align with the API contract and integration/monitoring plans referenced throughout.*  &#x20;

---

## 1) Storage Overview & Rationale

**Stores**

* **PostgreSQL (primary):** authoritative system of record for prompts, accounts, regions, POPs, collective states, lineage weights, conversations. Optimized for *append‑only* retention with selective materialized views for fast reads.
* **Qdrant (vector):** embeddings per *(prompt, region)* to drive **contribution weights** and retrieval‑augmented synthesis.
* **Redis (cache + rate/coordination):** hot `CollectiveAgentState` cache, SSE session metadata and small backlogs, region/chat rate limits.
* **Object storage (optional):** static assets & large offline exports (not required for MVP).

**Why this split:** PostgreSQL guarantees integrity and auditability (lineage, versions); Qdrant keeps similarity math fast; Redis makes the *read‑heavy map/chat* snappy and under the **<500 ms** cached SLO; SSE freshness is coordinated without overloading the DB. These are the same patterns assumed by the public/read proxies and event streaming contract.&#x20;

---

## 2) Relational Schema (PostgreSQL DDL)

> The schema below encodes **one POP per account per prompt**, the **collective summary** per region (no stance/quotes), anonymized **lineage weights**, and chat transcripts. It mirrors the read/write contracts and SSE update payloads.&#x20;

```sql
-- 2.1 Core catalogs
create table prompt (
  prompt_id text primary key,                 -- e.g., '2025-W42'
  semantics text not null,                    -- canonical EN semantics
  starts_at timestamptz not null,             -- week start
  ends_at   timestamptz not null              -- week end
);

create table account (
  account_id uuid primary key,                -- stable internal id
  created_at timestamptz not null default now()
);

create table region (
  region_id text primary key,                 -- e.g., 'city:US:ca:san-francisco'
  level text check (level in ('City','State','Country')) not null,
  country char(2) not null,
  state text,
  city text,
  centroid_lat double precision,
  centroid_lng double precision
);

-- 2.2 POP submissions (append-only with supersession)
create table pop (
  pop_id uuid primary key default gen_random_uuid(),
  pop_public_id text not null unique,         -- salted, anonymized id (safe to expose in lineage)
  account_id uuid not null references account(account_id),
  prompt_id text not null references prompt(prompt_id),
  region_id text not null references region(region_id),
  original_text text not null check (char_length(original_text) between 1 and 1000),
  detected_lang char(2),
  canonical_en text not null,                 -- canonical text used for embeddings/synthesis
  lat double precision,                       -- precise coords if granted
  lng double precision,
  submitted_at timestamptz not null default now(),
  editable_until timestamptz not null,        -- computed at insert (prompt end or now()+15m, min)
  pin_expire_at timestamptz not null,         -- now() + interval '24 hours' (UI TTL only)
  supersedes_pop_id uuid,                     -- previous version, if edit
  is_active boolean not null default true,
  constraint uq_one_active_per_prompt unique (account_id, prompt_id) deferrable initially immediate
);

create index idx_pop_region_prompt_time on pop(region_id, prompt_id, submitted_at desc);
create index idx_pop_active on pop(prompt_id, account_id) where is_active;

-- 2.3 Collective state (the only public-facing aggregate string)
create table collective_state (
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  collective_summary text not null check (char_length(collective_summary) between 50 and 1200),
  pop_count integer not null default 0,
  weight_digest jsonb,                        -- {mean,stddev,gini,topk[],histogram[]}
  updated_at timestamptz not null default now(),
  primary key (region_id, prompt_id)
);

-- 2.4 Lineage weights (anonymized)
create table lineage_weight (
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  pop_public_id text not null,                -- never join back to account on the read path
  weight_pct numeric(6,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  primary key (region_id, prompt_id, pop_public_id)
);

-- 2.5 Conversations (persisted; internal only)
create table conversation (
  session_id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account(account_id),
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table conversation_message (
  session_id uuid not null references conversation(session_id) on delete cascade,
  seq bigserial primary key,
  role text check (role in ('user','assistant','system')) not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- 2.6 Helpers (views)
create view v_public_pins as
  select pop_public_id, region_id, lat, lng, submitted_at, pin_expire_at
  from pop
  where now() < pin_expire_at;                -- UI uses this to show 24h pins
```

**Notes & rules encoded**

* **Supersession + editability:** on new POP by the same `(account_id, prompt_id)`, flip previous `is_active=false`, link via `supersedes_pop_id`, and set `editable_until` at insert (the lesser of prompt end or **now()+15 min**).
* **Retention:** no deletes; pins “expire” visually via `v_public_pins` while raw rows persist.
* **Aggregate integrity:** `collective_state` is *the* read model for map/chat; it holds the single **`collective_summary`** string plus digest metadata—*no stance or quotes fields exist*.&#x20;

> **Partitioning (optional from day‑1, recommended):** create weekly partitions on `collective_state` and `lineage_weight` by `prompt_id`, and time partitions on `pop` by `submitted_at` (monthly). This contains index growth while honoring indefinite retention.

---

## 3) Vector Store (Qdrant) Layout

**Collections**

* Name: `pop_embeddings_{prompt_id}` (one per active prompt week).
* Distance: **cosine**; Vector size matches embeddings model.
* Payload: `{ pop_public_id, region_id, level, submitted_at }` with indexed `region_id` filter.
* HNSW config (starter): `{ m: 64, ef_construct: 128, ef_search: 64 }`.
  Weights are computed by centroid similarity + light recency/length normalization; full vector persisted to `lineage_weight`, digest written to `collective_state.weight_digest`.&#x20;

---

## 4) Cache, SSE & Rate‑Limit Namespaces (Redis)

> Caching, real‑time delivery and coordination align with the read proxy and event stream described in the API contract & integration plan. Keys below are deterministic and safe to generate in Codex. &#x20;

**Key spaces (prefix `pop:`)**

* **Agent state cache**

  * `pop:agent:v1:{region_id}:{prompt_id}` → JSON `CollectiveAgentState`, **TTL 60s**.
  * `pop:agent:etag:{region_id}:{prompt_id}` → weak ETag/version for coalescing refresh.

* **SSE coordination**

  * `pop:sse:backlog:{stream_id}` → list of last N `agent_state_update` events (N≈500).
  * `pop:sse:seq:{region_id}` → monotonic sequence for ordering/dedupe.
  * `pop:sse:clients` → gauge for monitoring.

* **Rate limits**

  * `pop:rl:chat_init:{region_id}` (sliding window) — cap **500 new sessions/min** per region.
  * `pop:rl:submit:{account_id}:{prompt_id}` — hard gate to **1 POP per prompt** (enforce also in DB).

* **Operational**

  * `pop:rollupq:{level}` → lightweight queue counters for roll‑up orchestration.

These keys support **cached P95 < 500 ms** reads and **< 1 s** SSE propagation when the engine publishes fresh state.&#x20;

---

## 5) Triggers & Procedures (SQL/Pseudocode)

**A. Enforce one active POP per prompt with supersession**

```sql
create or replace function pop_before_insert() returns trigger as $$
begin
  -- deactivate any prior active entry for this (account, prompt)
  update pop
     set is_active=false
   where account_id = new.account_id and prompt_id = new.prompt_id and is_active=true;

  -- set editability window and pin TTL
  new.editable_until := least((select ends_at from prompt where prompt_id=new.prompt_id),
                              now() + interval '15 minutes');
  new.pin_expire_at := now() + interval '24 hours';
  return new;
end; $$ language plpgsql;

create trigger trg_pop_before_ins
before insert on pop
for each row execute function pop_before_insert();
```

**B. Materialize digest after synthesis (optional)**
A small worker can refresh `collective_state` and cache it in Redis, then publish the SSE **`agent_state_update`** event with the **new `CollectiveAgentState`** payload.&#x20;

---

## 6) Cloud Architecture (Single‑Region, Production‑ready)

> *Goal:* simple, reliable MVP with global read performance and clear SLOs. Hierarchical roll‑ups and SSE are monitored and debounced as specified. &#x20;

**Compute**

* **POP API (Edge) + SSE:** containerized service behind an HTTPS LB + WAF. Sticky sessions are acceptable for SSE.
* **Semantic Congregator (Engine):** separate service (private subnet), exposed only to POP API via service‑to‑service auth.

**Data**

* **PostgreSQL:** managed instance (primary zone), automated nightly backups + PITR.
* **Qdrant:** managed or VM cluster (single zone), SSD, private networking.
* **Redis:** managed (HA), TLS, single region.

**Network**

* VPC with private subnets for data services; POP API in public subnets behind LB; engine in private subnets; security groups restrict East‑West traffic.
* **CDN:** edge cache for static & map assets; API traffic terminates TLS at LB.

**Security**

* TLS everywhere; managed secrets; per‑service API keys; IP allow‑lists for admin endpoints. JWT verification at POP API; **Sign in with Apple** on iOS in addition to other social providers to satisfy store rules.&#x20;

**Observability**

* Prometheus/Grafana (or provider equivalent); dashboards + alerts using the metrics named in the monitoring plan (dual‑write success, breaker state, roll‑up queue, SSE clients, cache hit‑rate, refresh latency). Link dashboards to the breaker/queue runbook. &#x20;

**Performance budgets (MVP SLOs)**

* City synth **P95 < 10 s**, ancestor **< 30 s**; cached read **< 500 ms**; SSE E2E **< 1 s** with graceful degradation under engine outage (serve cache & stale states). &#x20;

---

## 7) Migrations & Seeders (Codex tasks)

**Migration tool:** any Node‑friendly migrator (e.g., Drizzle SQL, Knex) generating the DDL above. On new environment boot:

1. **Create base catalogs** (`prompt`, `account`, `region`).
2. **Create app tables** (`pop`, `collective_state`, `lineage_weight`, `conversation`, `conversation_message`).
3. **Create helper view** (`v_public_pins`) and triggers.
4. **Seed regions**: the table can start empty—insert on demand during reverse‑geocode (idempotent UPSERT) to keep MVP simple; a separate offline job can enrich names/centroids.
5. **Seed current prompt** with `prompt_id = YYYY-Www`, `semantics`, and `starts_at/ends_at`.

**Verification steps** (automatable):

* Insert two POPs for same `(account, prompt)` → prior row `is_active=false`.
* Collective upsert produces a single `collective_state` row and caches it → API returns **<500 ms**.
* SSE publish after state change emits **`agent_state_update`** with the new payload. &#x20;

---

## 8) Data Retention & Lifecycle

* **Indefinite retention** for POPs, collectives, chats. Pins disappear from the map after 24h (view‑level TTL) but rows persist for analytics/personality drift.
* **Cold storage policy:** after 365 days, optional move of inactive `pop` & `conversation_message` partitions to slower storage; keep indexes lean by partitioning.
* **Anonymity:** no public user identifiers; only `pop_public_id` appears in lineage. Location is coarse (region IDs + rounded lat/lng) and stored permanently per product directive.
* **Edits/deletes:** edit within window; **undo (delete) within 15 minutes** then permanent. These rules match product policy and are enforced by schema + trigger above.

---

## 9) Secrets & Environment Catalog (prod/stage/dev)

> Names align with the integration and implementation checklists so POP API and Engine can be stood up consistently. Use separate secrets per environment. &#x20;

**POP API**

* `PORT`
* `JWT_ISSUERS=google,facebook,x,apple`
* `REGION_CACHE_TTL_SEC=60`
* `SSE_BACKLOG_SIZE=500`
* `CHAT_TURN_LIMIT=20`
* `CHAT_SESSION_TTL_MIN=30`
* `REGION_SESSION_RATE_LIMIT_PER_MIN=500`
* `DATABASE_URL=postgres://...`
* `REDIS_URL=...`
* `ENGINE_BASE_URL=https://engine.internal`
* `ENGINE_API_KEY=...`
* Flags: `ENABLE_SEMANTIC_CONGREGATION=true`, `ENABLE_HIERARCHICAL_ROLLUP=true`

**Semantic Congregator (Engine)**

* `OPENAI_API_KEY=...`
* `OPENAI_MODEL=gpt-5` *(prod)* / `gpt-5-mini` *(dev)*
* `OPENAI_TIMEOUT_MS=20000`, `OPENAI_MAX_RETRIES=2`
* `EMBEDDINGS_MODEL=text-embedding-3-large`
* `QDRANT_URL=...`, `DATABASE_URL=postgres://...`, `REDIS_URL=...`
* Debounce: `ROLLUP_DEBOUNCE_MS_STATE=6000`, `ROLLUP_DEBOUNCE_MS_COUNTRY=9000`
* Cache: `CACHE_TTL_SEC=60`
* Chat/session: same limits as POP API for symmetry.

> These variables are the same families referenced in the integration architecture and checklist; they are sufficient for Codex to generate bootstrapping code and health/metrics endpoints. &#x20;

---

## 10) Access Patterns (SQL & API expectations)

**Write path**

1. `POST /v1/pops` (POP API) validates input, derives region (GPS/IP/manual), writes `pop`, forwards to engine.
2. Engine ingests → embeddings → **weights** → synth → persist `collective_state`/`lineage_weight` → cache → publish **SSE**.
3. POP API invalidates cache entries and broadcasts **`agent_state_update`** (region‑filtered). &#x20;

**Read path**

* Map/overlay reads **`GET /v1/agent-states?ids=…`** → Redis (60s TTL) → DB fallback if necessary; P95 **<500 ms**.
* Lineage reads **`GET /v1/agent-lineage/:regionId`** (anonymized vector) for internal views/analytics.
* SSE `GET /v1/events` streams **`agent_state_update`** payloads; backlog supports reconnect ordering.&#x20;

---

## 11) Observability, SLOs & Runbooks

Wire the metrics listed in the monitoring plan (e.g., `agent_state_refresh_last_latency_ms`, `rollup_queue_size`, `agent_state_cache_hit/miss`, `sse_active_clients`, `dual_write_success_rate`) and link alerts to the **Congregator Breaker & Retry Queue Recovery** runbook for fast remediation. SLOs are: City **<10 s**, Ancestor **<30 s**, Cache **<500 ms**, SSE **<1 s**, with availability ≥99.9%.  &#x20;

---

## 12) Security & Privacy Controls

* **PII minimization:** store only stable internal `account_id`; never expose user identity in responses.
* **Auth:** OAuth‑based JWT at POP API; Engine behind API‑key and private networking.
* **Data at rest/in transit:** managed encryption; TLS 1.2+.
* **Content policy (hard‑blocks only):** enforce automated screening at ingestion and chat; regional chat mutes on abuse spikes; expose a **strict‑mode** feature flag for app‑store contingencies.&#x20;

---

## 13) Acceptance Checklist (Data & Infra)

* [ ] DDL applied; triggers working; seed prompt created.
* [ ] Engine writes populate `collective_state` and `lineage_weight`; Redis cache updated; **SSE `agent_state_update`** emitted.&#x20;
* [ ] Cached `GET /v1/agent-states` **P95 < 500 ms** under probe; City update **P95 < 10 s**; Ancestor **< 30 s**.&#x20;
* [ ] Metrics exported at `/metrics` and dashboards show cache hit‑rate, roll‑up latency, and SSE client counts with alert routing set.&#x20;
* [ ] Breaker/queue chaos drill completed; runbook steps validated end‑to‑end.&#x20;

---

## 14) Appendix — JSON Types (for caches & SSE)

**`CollectiveAgentState` (cache/SSE payload)**

```json
{
  "id": "city:US:ca:san-francisco",
  "level": "City",
  "prompt_id": "2025-W42",
  "collective_summary": "…",
  "updated_at": "2025-10-16T10:31:05Z",
  "x_meta": {
    "pop_count": 257,
    "weight_digest": { "gini": 0.21, "mean": 0.39 }
  }
}
```

**SSE `agent_state_update`** (one event per updated region)

```text
event: agent_state_update
data: {"region_id":"city:US:ca:san-francisco","agent_state":{...},"updated_at":"2025-10-16T10:31:05Z","change_type":"updated","trigger_reason":"new_pop"}
```

*Matches the event type and stream contract used by clients and the POP API proxy.*&#x20;

---
