**Focused Document #3 — API & Data Contracts (Greenfield)
POP ↔ Semantic Congregator (GPT‑5) + Mobile Client**

> **Scope:** Canonical, build‑ready contracts for the end‑to‑end POP MVP: schemas, endpoints, SSE events, storage DDL, vector store layout, GPT‑5 prompt templates, auth/rate limits, examples, and acceptance hooks. This specification encodes your decisions: **one global weekly prompt**, **one POP per account per prompt**, **singular collective summary per region**, **per‑POP contribution weights**, **anonymous UI**, **auto‑translation**, **chat with region agent**, **indefinite retention**, **no human moderation**, **hard‑block legality only**. &#x20;

---

## 1) Domain model & identifiers

**Region hierarchy (global):** `City → State/Province → Country`.
**Region ID format (canonical, slugged):**
`{level}:{CC-ISO2}[:{state_code}[:{city_slug}]]` e.g., `city:US:ca:san-francisco`, `state:JP:13`, `country:BR`. Ancestors derive deterministically from any child.&#x20;

**Prompt of the week:** `prompt_id = YYYY-Www` (e.g., `2025-W42`), one semantics string, copy-localized for display.
**POP:** a user submission (≤1000 chars) tied to `(account_id, prompt_id, region)`. **Exactly one POP per account per prompt** (append‑only versions permitted until prompt window closes; no deletions).
**Collective Agent (per region, per prompt):** single `collective_summary` string + optional weight digest metadata; **no stances** and **no quotes**.
**Contribution weight:** normalized weight `%` for each POP within `(region, prompt)` used only in metadata/lineage, never to identify users.
**Chat session:** 20‑turn cap, 30‑minute idle timeout, per‑region initiation cap \~**500/min**. &#x20;

---

## 2) JSON Schemas (TypeScript definitions)

```ts
// region/core
export type RegionLevel = 'City' | 'State' | 'Country';
export type Locale =
  | 'en'|'es'|'pt'|'fr'|'de'|'hi'|'ja'|'ko'|'zh-CN'|'zh-TW';

export interface RegionIdParts {
  level: RegionLevel;
  country: string;      // ISO-3166-1 alpha-2
  state?: string;       // ISO/official code or numeric for prefectures
  city?: string;        // slug
}
export type RegionId = string; // e.g., 'city:US:ca:san-francisco'

// submission
export interface PopSubmission {
  account_id: string;         // stable internal ID; never public in UI
  prompt_id: string;          // e.g., "2025-W42"
  text: string;               // 1..1000 chars
  // location: either precise coords or resolvable city (manual/IP)
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  country: string;
  // client cap: exactly one POP per account per prompt
  submitted_at: string;       // ISO
  // client hints (optional)
  device_locale?: Locale;
}

export interface CollectiveAgentState {
  id: RegionId;
  level: RegionLevel;
  prompt_id: string;
  collective_summary: string; // 50..1200 chars
  updated_at: string;         // ISO
  x_meta?: {
    pop_count: number;
    weight_digest?: {
      mean: number; stddev: number; gini: number;
      topk?: Array<{ pop_public_id: string; weight_pct: number }>;  // k ≤ 20
      histogram?: Array<{ bin: [number, number]; count: number }>;
    };
  };
}

export interface CollectiveLineage {
  id: RegionId;
  prompt_id: string;
  pop_weights: Array<{ pop_public_id: string; weight_pct: number }>;
  model_versions: { synthesizer: string; embedder: string; translator: string };
  prompts: { synth_template_hash: string; chat_template_hash: string };
  created_at: string; // ISO
}

// chat
export interface CollectiveChatRequest {
  region_id: RegionId;
  prompt_id: string;
  locale?: Locale;     // display language; defaults device locale
  messages: Array<{ role: 'user'|'assistant'|'system'; content: string }>;
  session_id?: string; // server-issued
}
export interface CollectiveChatResponse {
  region_id: RegionId;
  prompt_id: string;
  message: { role: 'assistant'; content: string };
  tokens?: { prompt: number; completion: number };
  translated?: boolean;
}

// SSE event
export interface AgentStateUpdateEvent {
  type: 'agent_state_update';
  data: {
    region_id: RegionId;
    agent_state: CollectiveAgentState;
    updated_at: string; // ISO
    change_type: 'created'|'updated'|'refreshed';
    trigger_reason: 'new_pop'|'scheduled_refresh'|'manual_refresh';
  };
}
```

> The event naming and proxy pattern follow the POP platform’s event stream conventions; clients subscribe to **`agent_state_update`** and patch local summaries on change. &#x20;

---

## 3) OpenAPI 3.1 (excerpt)

```yaml
openapi: 3.1.0
info:
  title: POP API + Semantic Congregator
  version: 1.0.0
servers:
  - url: https://api.pop.example/v1
    description: POP Public API (mobile clients)
  - url: https://engine.pop.example
    description: Semantic Congregator (internal)
components:
  securitySchemes:
    userAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    engineKey:
      type: http
      scheme: bearer
      bearerFormat: APIKey
  schemas:
    RegionId:
      type: string
      pattern: '^(city|state|country):[A-Z]{2}(:[a-z0-9-]+)*$'
    CollectiveAgentState: { $ref: '#/components/schemas/_CollectiveAgentState' }
    _CollectiveAgentState:
      type: object
      required: [id, level, prompt_id, collective_summary, updated_at]
      properties:
        id: { $ref: '#/components/schemas/RegionId' }
        level: { type: string, enum: [City, State, Country] }
        prompt_id: { type: string }
        collective_summary: { type: string, minLength: 50, maxLength: 1200 }
        updated_at: { type: string, format: date-time }
        x_meta:
          type: object
          properties:
            pop_count: { type: integer, minimum: 0 }
            weight_digest:
              type: object
              properties:
                mean: { type: number }
                stddev: { type: number }
                gini: { type: number }
                topk:
                  type: array
                  items:
                    type: object
                    required: [pop_public_id, weight_pct]
                    properties:
                      pop_public_id: { type: string }
                      weight_pct: { type: number, minimum: 0, maximum: 100 }
                histogram:
                  type: array
                  items:
                    type: object
                    required: [bin, count]
                    properties:
                      bin: { type: array, minItems: 2, maxItems: 2, items: { type: number } }
                      count: { type: integer, minimum: 0 }
paths:
  /pops:
    post:
      summary: Submit a POP (one per account per prompt)
      security: [{ userAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [prompt_id, text, country]
              properties:
                prompt_id: { type: string }
                text: { type: string, minLength: 1, maxLength: 1000 }
                lat: { type: number } 
                lng: { type: number }
                city: { type: string } 
                state: { type: string }
                country: { type: string, minLength: 2, maxLength: 2 }
      responses:
        '201':
          description: Accepted
          content:
            application/json:
              schema:
                type: object
                properties:
                  pop_public_id: { type: string }
                  region_assignments:
                    type: array
                    items:
                      type: object
                      properties: { region_id: { $ref: '#/components/schemas/RegionId' }, confidence: { type: number } }
        '409':
          description: Already submitted for this prompt (idempotent)
  /agent-states:
    get:
      summary: Fetch collective states for regions
      security: []
      parameters:
        - in: query
          name: ids
          required: true
          schema: { type: string }
        - in: query
          name: refresh
          schema: { type: boolean, default: false }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [agents, metadata]
                properties:
                  agents:
                    type: array
                    items: { $ref: '#/components/schemas/CollectiveAgentState' }
                  metadata:
                    type: object
                    properties:
                      cached_at: { type: string, format: date-time }
                      ttl_seconds: { type: integer }
                      source: { type: string, enum: [cache, engine] }
                      partial_results: { type: boolean }
  /agent-lineage/{regionId}:
    get:
      summary: Full weight vector lineage (anonymized)
      security: []
      parameters:
        - name: regionId
          in: path
          required: true
          schema: { $ref: '#/components/schemas/RegionId' }
        - name: prompt_id
          in: query
          required: true
          schema: { type: string }
      responses:
        '200':
          description: OK
  /agent-conversation/{regionId}:
    post:
      summary: Chat with a region’s collective agent
      security: [{ userAuth: [] }]
      parameters:
        - name: regionId
          in: path
          required: true
          schema: { $ref: '#/components/schemas/RegionId' }
      requestBody:
        required: true
      responses:
        '200':
          description: Assistant reply
  /events:
    get:
      summary: SSE stream (agent_state_update)
      security: []
      responses:
        '200': { description: text/event-stream }
```

> Path shapes, query conventions, and the `agent_state_update` SSE are aligned to the POP integration patterns and error envelopes (400/429/5xx with `retry_after`, `trace_id`). &#x20;

---

## 4) Database schema (PostgreSQL DDL)

> **Principles:** append‑only retention, anonymity in public UI, strict idempotency per `(account_id, prompt_id)`, lineage preserved for tracing, and deterministic region hierarchy.&#x20;

```sql
-- prompts
create table prompt (
  prompt_id text primary key,                   -- e.g., '2025-W42'
  semantics text not null,                      -- canonical EN semantics
  published_at timestamptz not null default now()
);

-- accounts (auth handled by identity providers; store internal ID only)
create table account (
  account_id uuid primary key,                  -- internal only
  created_at timestamptz not null default now()
);

-- regions (catalog)
create table region (
  region_id text primary key,                   -- 'city:US:ca:san-francisco'
  level text check (level in ('City','State','Country')),
  country char(2) not null,
  state text,
  city text
);

-- POP submissions (append-only versions, but one active per account+prompt)
create table pop (
  pop_id uuid primary key default gen_random_uuid(),
  pop_public_id text not null unique,            -- salted hash; safe to share
  account_id uuid not null references account(account_id),
  prompt_id text not null references prompt(prompt_id),
  region_id text not null references region(region_id),
  original_text text not null check (char_length(original_text) between 1 and 1000),
  detected_lang char(2),
  canonical_en text not null,
  lat double precision,
  lng double precision,
  submitted_at timestamptz not null default now(),
  supersedes_pop_id uuid,                        -- if edited; for lineage only
  constraint uq_active_pop unique (account_id, prompt_id) deferrable initially immediate
);

-- collective states (per region, per prompt)
create table collective_state (
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  collective_summary text not null check (char_length(collective_summary) between 50 and 1200),
  pop_count integer not null default 0,
  weight_digest jsonb,
  updated_at timestamptz not null default now(),
  primary key (region_id, prompt_id)
);

-- lineage weights (full vector; anonymized)
create table lineage_weight (
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  pop_public_id text not null,
  weight_pct numeric(6,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  primary key (region_id, prompt_id, pop_public_id)
);

-- conversations (persisted; never public)
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
  seq serial primary key,
  role text check (role in ('user','assistant','system')) not null,
  content text not null,
  created_at timestamptz not null default now()
);
```

> DDL supports immutable retention and anonymized lineage while enabling strict idempotency and version supersession for edits within the prompt window (no deletion endpoints are exposed to users).&#x20;

---

## 5) Vector store (Qdrant) collections

* **Collection:** `pop_embeddings_{prompt_id}`
* **Vector size:** **3072** (OpenAI `text-embedding-3-large`, recommended)
* **Distance:** cosine
* **Payload fields:** `{ pop_public_id, region_id, level, submitted_at }`
* **Indexes:** filterable `region_id`, payload key for quick per‑region scans.
  Use this to compute **centroids** and contribution weights, then persist the normalized vector in `lineage_weight`.&#x20;

---

## 6) Contribution weights (spec & persistence)

For each `(region, prompt)`:

1. Embed **canonical\_en** for all POPs.
2. Compute region **centroid**; score each POP by cosine similarity `s_i ∈ [0,1]`.
3. Apply **light recency** `r_i ∈ [0.9,1.0]` and **length normalization** `ℓ_i ∈ [0.9,1.0]`.
4. **Anti‑spam dampening:** down‑weight near‑duplicate vectors (MinHash/SimHash buckets).
5. Normalize: `w_i = (s_i * r_i * ℓ_i) / Σ (s_j * r_j * ℓ_j)` → store as `weight_pct`.
6. Publish digest stats `{mean, stddev, gini, topK, histogram}` inside `collective_state.weight_digest`.

**Exposure:**

* Read path returns digest only (no identities).
* Lineage endpoint returns **full `{pop_public_id, weight_pct}`** vector; UI never surfaces account identity.&#x20;

---

## 7) GPT‑5 templates (JSON‑mode; strict)

**Synthesis (collective summary)**

* **Model:** `gpt-5`
* **Response format:** JSON strict, single key `collective_summary` (50‑1200 chars).
* **System:**

  ```
  You are the collective voice for {region_display} responding to:
  "{prompt_semantics}" (week {prompt_id}).
  Speak as a single personality that truthfully reflects aggregate inputs.
  Do NOT include individual quotes or numeric percentages. No stance bins.
  Tone: playful, lively, truthful; witty/irreverent iff the aggregate leans that way.
  Output EXACT JSON: {"collective_summary":"<50..1200 chars>"} with no extra fields.
  ```
* **User (truncated to fit token budget):**

  ```
  Context:
  - Region: {region_id} ({level})
  - POPs (canonical EN): [{text, weight_pct}, ... up to N]
  - Signals: {pop_count, weight_digest}
  Task: Synthesize one cohesive paragraph reflecting the collective.
  ```
* **Guardrails:** temperature 0.7, max\_tokens sized for 1200 chars, 2 retries with backoff; on schema mismatch, **repair** by re‑asking with the original system prompt and a JSON‑schema example.&#x20;

**Region chat (assistant)**

* **Model:** `gpt-5`
* **Policy:** Answers **anchor to the week’s prompt**, respect tone rules, and are translated to the user’s locale after generation if needed.
* **Limits:** 20 turns/session; block on legal hard‑blocks and spam automation triggers.&#x20;

---

## 8) Endpoints (behavioral details)

### Public (mobile → POP API)

* `POST /v1/pops` — submit POP

  * **Auth:** Bearer (Google/Facebook/X/Apple‑on‑iOS).
  * **Idempotency:** server enforces one active POP per `(account_id, prompt_id)`; edits create a new row that **supersedes** prior version.
  * **Returns:** `{ pop_public_id, region_assignments[] }`.
  * **Side‑effects:** schedule city synthesis immediately; ancestor rollups debounced to meet SLOs.&#x20;

* `GET /v1/agent-states?ids=...` — fetch `CollectiveAgentState[]` for map/overlay

  * **Cache:** 60s TTL, freshness hints included.
  * **Perf target:** **<500 ms P95** served from cache.&#x20;

* `GET /v1/agent-lineage/{regionId}?prompt_id=...` — weight vector (anonymized)

* `POST /v1/agent-conversation/{regionId}` — chat with region agent

  * **Limits:** 20 turns, 30‑min idle, per‑region 500 new sessions/min; 429 on limit.

* `GET /v1/events` — **SSE**; emits `agent_state_update` with new `CollectiveAgentState`.

### Internal (POP API ↔ Congregator)

* `POST /engine/pops:batch` — ingest & canonicalize; return region assignments.
* `GET /engine/collectives?ids=...` — compute/return `CollectiveAgentState[]`.
* `GET /engine/collectives/{regionId}/lineage?prompt_id=...` — lineage.
* `POST /engine/collectives/{regionId}/chat` — region chat API.
* **Security:** engine API key, request/response logging, circuit breaker, retries.&#x20;

**Error envelopes (all APIs):**

```json
{
  "error": "invalid_region_id | too_many_requests | synthesis_timeout | upstream_unavailable",
  "message": "Human-readable detail",
  "retry_after": 30,
  "trace_id": "req_abc123"
}
```

> Error codes, 429/503 handling, and rate‑limit headers follow the API contract norms.&#x20;

---

## 9) Auth, privacy, moderation

* **Auth providers:** Google, Facebook, X/Twitter; **Sign in with Apple** required on iOS when any third‑party login is present.
* **Pre‑login:** read‑only exploration of map & collective outputs; submission/chat gated.
* **Anonymity:** no public usernames/avatars; UI never shows account IDs; **only `pop_public_id`** (salted hash) may appear in lineage.
* **Retention:** **indefinite** for POPs, collectives, chats; no user deletion/export endpoints.
* **Hard‑blocks:** CSAM/child harm, credible criminal/terror threats, spam/automation. No down‑ranking or “warnings” for lawful but offensive content.
* **Regional mutes:** if automated block spikes in a region, temporarily **mute chat** with a soft banner; resume automatically.&#x20;

---

## 10) SLOs, observability, resilience

**SLOs:** City P95 **<10 s**; Ancestors **<30 s**; Cached reads **<500 ms**; SSE E2E **<1 s**; ≥**99.9%** availability.&#x20;

**Metrics to emit (names consistent across services):**

* Ingest: `pop_submission_total`, `dual_write_success_rate`, breaker gauges/counters.
* Synth/Rollup: `agent_state_refresh_last_latency_ms`, `rollup_queue_size`, `rollup_processed_total`.
* Cache: `agent_state_cache_hit|miss|stale|store`, `agent_state_cache_size`.
* SSE: `sse_active_clients`, `agent_state_update_total`.
* Chat: `chat_overlay_served_total`, `chat_event_*` (interaction counters).&#x20;

**Resilience patterns:** circuit breaker around GPT‑5, retry queues, cached reads on engine outage, SSE reconnection with backlog replay, runbook for breaker/queue recovery.&#x20;

---

## 11) Examples

**A) Submit a POP (mobile → POP API)**

```http
POST /v1/pops
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "prompt_id": "2025-W42",
  "text": "I feel our city is buzzing with creative energy!",
  "lat": 37.7749, "lng": -122.4194,
  "country": "US"
}
```

**201**

```json
{
  "pop_public_id": "p_3h7k2...",
  "region_assignments": [
    {"region_id":"city:US:ca:san-francisco","confidence":0.98},
    {"region_id":"state:US:ca","confidence":1.0},
    {"region_id":"country:US","confidence":1.0}
  ]
}
```

**B) Read collectives (map overlay)**

```http
GET /v1/agent-states?ids=city:US:ca:san-francisco,state:US:ca
```

**200**

```json
{
  "agents": [
    {
      "id": "city:US:ca:san-francisco",
      "level": "City",
      "prompt_id": "2025-W42",
      "collective_summary": "San Francisco sounds exuberant this week—... ",
      "updated_at": "2025-10-16T10:30:45Z",
      "x_meta": { "pop_count": 257, "weight_digest": { "gini": 0.21, "mean": 0.39 } }
    }
  ],
  "metadata": { "cached_at": "2025-10-16T10:30:46Z", "ttl_seconds": 60, "source": "cache", "partial_results": false }
}
```

**C) SSE update**

```
event: agent_state_update
data: {"region_id":"city:US:ca:san-francisco","agent_state":{...},"updated_at":"2025-10-16T10:31:05Z","change_type":"updated","trigger_reason":"new_pop"}
```

> Event type and envelope match the streaming pattern used throughout the platform.&#x20;

**D) Chat with a region**

```http
POST /v1/agent-conversation/city:US:ca:san-francisco
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "prompt_id": "2025-W42",
  "locale": "es",
  "messages": [
    {"role":"user","content":"¿Cómo se siente SF respecto al tema de esta semana?"}
  ]
}
```

**200**

```json
{
  "region_id": "city:US:ca:san-francisco",
  "prompt_id": "2025-W42",
  "message": {
    "role": "assistant",
    "content": "Esta semana, San Francisco suena creativo y un poco impaciente..."
  },
  "translated": true
}
```

---

## 12) Testing hooks & acceptance (API‑level)

* **Smoke:** POP submit → engine ingest → city collective **<10s**; SSE event arrives; cached read **<500ms**.
* **Rollup:** Submit to city; observe **state/country** updates **<30s** (debounced).
* **Load:** 50 concurrent POPs; 100 concurrent collective queries; 50+ SSE clients with ordered delivery and backlog replay.
* **Degradation:** simulate engine outage: cached collectives serve; breaker opens; runbook actions restore **<2 min**; metrics confirm recovery.  &#x20;

---

## 13) Security & rate limits

* **Public endpoints:** JWT bearer; 401/403 on failure; **429** on POP spam or chat rate overage with `X-RateLimit-*` headers.
* **Internal engine:** API key bearer; 1000 qpm `GET /engine/collectives`, 100 qpm `POST /engine/pops:batch` (tune per environment).&#x20;

---

## 14) Configuration (env essentials)

```
# POP API
JWT_ISSUERS=google,facebook,x,apple
REGION_CACHE_TTL_SEC=60
SSE_BACKLOG_SIZE=500
CHAT_TURN_LIMIT=20
CHAT_SESSION_TTL_MIN=30
REGION_SESSION_RATE_LIMIT_PER_MIN=500

# Engine
OPENAI_MODEL=gpt-5
EMBEDDINGS_MODEL=text-embedding-3-large
CANONICAL_LANG=en
ROLLUP_DEBOUNCE_MS_STATE=6000
ROLLUP_DEBOUNCE_MS_COUNTRY=9000
CACHE_TTL_SEC=60
```

> Debounce/caching and monitoring names follow the integration & observability patterns so dashboards and runbooks plug in cleanly. &#x20;

---

