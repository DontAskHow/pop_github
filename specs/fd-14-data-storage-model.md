**Focused Document #14 — Data & Storage Model (Authoritative Schemas & DTOs, Greenfield, Codex‑ready)**
*Purpose:* Define the **single source of truth** for POP data (users → POPs → regions → aggregates → chat), cache & streaming layers, and public/admin DTOs. This model enforces product non‑negotiables: **collective‑only public output**, anonymity, one‑POP‑per‑prompt, global region hierarchy, SSE real‑time updates, lineage weights (% contribution), and indefinite retention. It aligns with the POP↔Semantic Engine contracts, SSE event shape, and the integration/monitoring plans already in place.  &#x20;

---

## 0) Design stance & scope

* **Collective‑only public surface:** Public reads (API/SSE) expose a **single `collective_summary`** per region×prompt; no stance bars or quotes on client responses—even if upstream or older assets can produce them. Lineage is exposed only as anonymized `{pop_public_id, weight_pct}` for tracing.&#x20;
* **Region hierarchy is canonical:** `region_id = {level}:{CC}[:{state}[:{city}[:{neighborhood}|{zip}]]}`; levels ∈ `{neighborhood|zip|city|state|country}` with strict casing/slugs. Ancestors are derived deterministically. &#x20;
* **Retention:** All POPs, aggregates (snapshots), lineage, and chats retained indefinitely. Pins expire **visually** after 24 h; data persists.&#x20;
* **Performance SLO coupling:** The model supports server cache, Redis SSE backlog, and ancestor roll‑ups to meet city<10 s, ancestor<30 s, cached<500 ms, SSE<1 s.&#x20;

---

## 1) Entity map (ER overview)

```
Account ─┬──< Pop
         │      └─ belongs_to → Prompt
         │
         ├──< ChatSession ──< ChatMessage
         │
Prompt ──┬──< AgentStateLatest  (region_id, prompt_id)  -- public read path
         └──< AgentStateSnapshot (region_id, prompt_id, snapshot_id)  -- archival

Region (registry, optional bootstrap) 
   ▲
   └─ AgentState* / LineageWeights keyed by region_id (+ prompt_id)

LineageWeights (region_id, prompt_id, pop_public_id, weight_pct)  -- audit/tracing
RegionChatMute (region_id, prompt_id, muted_until, reason)        -- ops control
```

**Caches/streams (Redis):** agent state cache, limited SSE backlog per region, per‑route rate‑limit buckets. **Vectors (Qdrant, engine‑side):** POP embeddings and auxiliary payloads (engine concern; not public). &#x20;

---

## 2) Canonical identifiers & region model

* **`region_id` format (strict):**
  `^(neighborhood|zip|city|state|country):[A-Z]{2}(:[a-z0-9-]+)*$`
  Examples: `city:US:ca:san-francisco`, `state:US:ca`, `country:US`. Store as **text**; validate on write. &#x20;
* **Ancestor derivation:** pure string rules (e.g., `city:US:ca:san-francisco` → `['state:US:ca','country:US']`). Keep a region registry table **optional** (labels, centroids) to improve UX; hierarchy can be computed without it.&#x20;

---

## 3) PostgreSQL — authoritative schema (DDL)

> SQL below is vendor‑agnostic and ready for migration tools (e.g., Drizzle). Timezone is UTC.

### 3.1 Accounts & prompts

```sql
create table accounts (
  account_id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google','facebook','x','apple')),
  provider_subject text not null,        -- stable external subject
  locale text,                           -- last known device locale (e.g., 'en-US')
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index ux_accounts_provider_subject on accounts(provider, provider_subject);

create table prompts (
  prompt_id text primary key,            -- e.g., '2025-W42'
  title text not null,
  text_en text not null,                 -- canonical
  locales jsonb not null default '{}'::jsonb,  -- {"es":"...",...}
  status text not null check (status in ('draft','localized','scheduled','active','closed','archived')),
  start_at timestamptz,
  end_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Matches Admin Ops lifecycle; public clients consume **`GET /v1/prompts/current`**.&#x20;

### 3.2 POP submissions (immutable, retained)

```sql
create table pops (
  pop_id uuid primary key default gen_random_uuid(),
  pop_public_id text not null,                   -- ULID/NanoID (no link to account_id on public surfaces)
  account_id uuid not null references accounts(account_id),
  prompt_id text not null references prompts(prompt_id),
  region_id text not null,                       -- validated format
  lat_rounded numeric(8,5),                      -- optional; privacy-friendly rounding
  lng_rounded numeric(8,5),
  lang text,                                     -- ISO code of original text
  text_original text not null,                   -- stored indefinitely
  text_canonical_en text,                        -- engine canonicalization
  submitted_at timestamptz not null default now(),
  blocked_reason text,                           -- illegal or spam (hard-block); else NULL
  constraint ux_one_pop_per_prompt unique (account_id, prompt_id)
);
create index ix_pops_region_prompt_time on pops(region_id, prompt_id, submitted_at desc);
create index ix_pops_public on pops(pop_public_id);
```

* **No user delete/export** while MVP: retention is indefinite; illegal content is **rejected** at ingest (blocked\_reason) and **excluded** from aggregation.&#x20;

### 3.3 Aggregates — latest & snapshots

```sql
-- Latest materialized collective per region × prompt (public read path)
create table agent_state_latest (
  region_id text not null,
  prompt_id text not null references prompts(prompt_id),
  collective_summary text not null,              -- the only public-facing text
  pop_count integer not null default 0,
  updated_at timestamptz not null default now(),
  model_versions jsonb not null default '{}'::jsonb,  -- { summarizer: "gpt-5-mini@...", embeddings: "..." }
  digest text,                                    -- optional hash of inputs → aids SSE/coalesce
  primary key (region_id, prompt_id)
);
create index ix_agent_state_latest_prompt on agent_state_latest(prompt_id);

-- Immutable archival snapshot (e.g., on prompt close; optionally sampled mid-week)
create table agent_state_snapshots (
  snapshot_id bigserial primary key,
  region_id text not null,
  prompt_id text not null references prompts(prompt_id),
  collective_summary text not null,
  pop_count integer not null default 0,
  created_at timestamptz not null default now(),
  snapshot_type text not null default 'weekly_final'  -- 'weekly_final' | 'interim'
);
create index ix_agent_state_snapshots_region_prompt on agent_state_snapshots(region_id, prompt_id, created_at desc);
```

This preserves indefinite history while keeping reads fast from `agent_state_latest`. SSE broadcasts reference the **latest** entry.&#x20;

### 3.4 Lineage weights (public‑internal audit)

```sql
-- Percent contribution per POP → region × prompt
create table lineage_weights (
  region_id text not null,
  prompt_id text not null references prompts(prompt_id),
  pop_public_id text not null,               -- anonymized public id only
  weight_pct numeric(6,3) not null check (weight_pct >= 0 and weight_pct <= 100),
  created_at timestamptz not null default now(),
  primary key (region_id, prompt_id, pop_public_id)
);
create index ix_lineage_region_prompt_weight on lineage_weights(region_id, prompt_id, weight_pct desc);
```

This powers the future **visual tracing layer** and “Your contribution: X%” UX while never exposing account identifiers.&#x20;

### 3.5 Region chat (sessions & messages)

```sql
create table chat_sessions (
  session_id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(account_id),
  region_id text not null,
  prompt_id text not null references prompts(prompt_id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,                         -- set on close/timeout
  turn_count integer not null default 0,        -- server-enforced cap (20 turns)
  locale text                                   -- display locale for this session
);
create index ix_chat_sessions_user_recent on chat_sessions(account_id, started_at desc);
create index ix_chat_sessions_region_prompt on chat_sessions(region_id, prompt_id);

create table chat_messages (
  message_id bigserial primary key,
  session_id uuid not null references chat_sessions(session_id) on delete cascade,
  role text not null check (role in ('user','agent')),
  content text not null,
  lang text,
  model_versions jsonb,                         -- for 'agent' rows
  created_at timestamptz not null default now()
);
```

Transcripts are retained indefinitely for internal use; never visible publicly. Rate limits/mutes are enforced at the service layer (see §3.6).&#x20;

### 3.6 Ops: regional chat mutes

```sql
create table region_chat_mutes (
  region_id text not null,
  prompt_id text not null,
  muted_until timestamptz not null,
  reason text,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (region_id, prompt_id)
);
```

Used by Admin Ops to “cool off” a region during abuse spikes.&#x20;

---

## 4) Redis — keyspace (cache, SSE backlog, rate limits)

> Redis is used **only** for ephemeral performance features; no PII in keys/values.

* **Agent State Cache**
  `agentstate:{prompt_id}:{region_id} → JSON {summary, pop_count, updated_at, digest}` (TTL ≈ 60 s)
  Metrics: `agent_state_cache_hit/miss/store/size`.&#x20;
* **SSE Backlog (per region)**
  `sse:agent_state:{prompt_id}:{region_id} → list` (ring buffer of last N events; N≈100) for replay on reconnect; server tracks `sse_active_clients`.&#x20;
* **Rate‑limit buckets**
  `rl:{route}:{bucket_key} → counter` with windowed expiry (e.g., `/api/agent-states`, `/api/chat/start`).&#x20;

---

## 5) Vector store (Qdrant, engine concern)

The Semantic Engine owns vectorized POP content and clustering. Define **one collection per prompt** to keep payloads bounded:

* **Collection:** `pop_vectors_{prompt_id}`
  **Vector dim:** provided by engine (from embeddings model; do not hardcode).
  **Payload:** `{ pop_public_id, region_id, lang, submitted_at, prompt_id }`
  Used for **theme detection/selection**, not exposed to clients.&#x20;

> Graph relations (Neo4j) and pipeline sidecars are engine‑internal. Only their **outputs** feed `agent_state_latest` + `lineage_weights`.&#x20;

---

## 6) DTOs — **public vs admin** surfaces

> These DTOs intentionally **supersede** older shapes that included `stance_dist`/`quotes` in public responses. Public surfaces **must not** return those fields.&#x20;

### 6.1 Public read (mobile/web)

```ts
// GET /api/agent-states?ids=...
interface AgentStatePublic {
  id: string;                 // region_id
  summary: string;            // collective_summary
  updated_at: string;         // ISO
  x_meta?: { pop_count?: number };
}
interface AgentStatesResponsePublic {
  agents: AgentStatePublic[];
  metadata: {
    cached_at: string;
    ttl_seconds: number;
    source: 'cache' | 'congregator';
    partial_results: boolean;
  };
}
```

**SSE event** (`/api/events`):

```
event: agent_state_update
data: {"region_id":"city:US:ca:san-francisco",
       "agent_state":{"id":"...","summary":"...","updated_at":"...","x_meta":{"pop_count":42}},
       "updated_at":"...",
       "change_type":"updated",
       "trigger_reason":"new_pop"}
```

Matches Integration Architecture event semantics. &#x20;

### 6.2 Admin/audit (staff‑only)

```ts
// GET /v1/admin/lineage/:regionId?prompt_id=...
type LineagePublic = {
  region_id: string;
  prompt_id: string;
  weights: { pop_public_id: string; weight_pct: number }[];
  model_versions?: Record<string,string>;
  created_at: string;
}
```

Lineage excludes any account identifiers; `pop_public_id` is non‑reversible for end users.&#x20;

---

## 7) Constraints, indices & invariants (why they exist)

* **One POP per account per prompt:** `unique (account_id, prompt_id)` protects product rule.&#x20;
* **Region format validation:** regex check on **every** write path.&#x20;
* **Hot reads:** composite indexes (`agent_state_latest(region_id, prompt_id)`) + Redis cache keep P95 cached reads <500 ms.&#x20;
* **Lineage read:** index on `(region_id,prompt_id,weight_pct desc)` supports top‑K tracing without table scan.
* **Chat controls:** session indexes support per‑user/session limits (20 turns/30 min idle).&#x20;

---

## 8) Data flows (write/read/roll‑up)

**Write:** `POST /api/pop` → persist POP → dual‑write to engine → engine synthesizes **city** immediately → POP fetches and populates `agent_state_latest` + Redis → **SSE** `agent_state_update`. Ancestors scheduled with **debounce** (state/country), then updated similarly. &#x20;

**Read:** Client caches `AgentStatesResponsePublic`; server responds from Redis or engine and sets metadata (`source`, `ttl_seconds`, `partial_results`).&#x20;

**Snapshot:** On prompt close, POP copies `agent_state_latest` rows into `agent_state_snapshots` for archival history. (Optional: periodic “interim” snapshots.)&#x20;

---

## 9) Observability hooks at the data layer

* Export gauges/counters for cache hit/miss/size, roll‑up queues, SSE clients, and refresh latency; these names map 1:1 to the **Monitoring Plan** and test probes. &#x20;
* Store **no PII** in agent state tables or Redis. Logs increment `log_error_total` on validation failures and breaker events; lineage/summary writes measured by `agent_state_refresh_*`.&#x20;

---

## 10) Security & privacy (data‑model enforcement)

* Public DTOs omit any **raw POP text**, quotes, or stance distributions. Only the **collective summary** and `pop_count` meta flow to clients.&#x20;
* `lineage_weights` uses `pop_public_id` only; no join path from public APIs to `account_id`.
* Secrets, API keys, and model/provider settings live **outside** the DB (env/secret manager).
* Rate‑limit & SSE backlogs carry **no POP content**.&#x20;

---

## 11) Migrations & bootstrap (greenfield)

* Create tables in a **single migration batch** respecting FK order: `accounts` → `prompts` → `pops` → `agent_state_latest` → `agent_state_snapshots` → `lineage_weights` → `chat_sessions` → `chat_messages` → `region_chat_mutes`.
* Seed **one active prompt** and a minimal **region registry** (optional), or rely on on‑the‑fly derivation.
* Initialize Redis keyspace lazily on first write; set default TTLs (60 s).
* Ensure **health checks** and `/metrics` light up before enabling traffic/feature flags.&#x20;

---

## 12) Acceptance checks (Data & Storage)

* [ ] Public responses (`/api/agent-states`, SSE) contain **only** `{id, summary, updated_at, x_meta.pop_count}` + metadata. No stance/quotes leak.&#x20;
* [ ] `lineage_weights` populated with normalized `%` across contributing POPs; top‑K query returns in <50 ms for hot regions.
* [ ] `agent_state_latest` writes + Redis cache support **city<10 s** and **ancestor<30 s** from POP submit; cached reads **<500 ms**; SSE **<1 s** E2E.&#x20;
* [ ] One‑POP‑per‑prompt invariant enforced by DB and server.
* [ ] No PII in agent\_state\*, lineage, Redis, or SSE payloads; audit verifies no join path from lineage to account IDs.
* [ ] Snapshot on prompt close creates immutable rows for archival; sample read proves historical retrieval.&#x20;

---

## 13) Notes on alignment with existing docs

* **API & SSE shapes:** This spec binds to `GET /api/agent-states` metadata and `agent_state_update` SSE semantics; server continues to expose cache/source/TTL and partial‑results flags to enable graceful degradation & runbooks. &#x20;
* **Integration & roll‑ups:** Debounced ancestor updates and redis‑backed SSE replay reflect the Integration Architecture & Implementation Checklist. &#x20;
* **Monitoring & testing:** Metric names, probes, and acceptance thresholds map to the Monitoring Plan and Testing Strategy. &#x20;

---
