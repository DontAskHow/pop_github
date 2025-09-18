**Focused Document #16 — Translation & I18N Pipeline (Greenfield, Codex‑ready)**
*Purpose:* Specify how POP localizes **UI, prompts, agent summaries, and chat** across priority languages while preserving the **collective‑only** public surface and our latency SLOs (city <10 s, ancestor <30 s, cached reads <500 ms, SSE <1 s). This pipeline defines **canonical language rules**, **provider routing (MT vs LLM)**, **APIs**, **caching**, **observability**, and **failure fallbacks** so Codex can implement end‑to‑end without ambiguity.  &#x20;

---

## 0) Non‑negotiables & scope

* **Collective‑only public output.** Client‑facing reads must expose **only a single collective summary string per region×prompt**; no stance bars or quotes are returned publicly in the MVP, even if upstream can produce them. (Admin lineage is audit‑safe and separate.)&#x20;
* **Languages (Tier‑1 set):** en, es, pt, fr, de, hi, ja, ko, zh‑CN, zh‑TW. Default to **device locale** with a **manual override** in Settings.&#x20;
* **Fallback UX:** If translation to the user’s display language is unavailable, **show the original text** with a subtle **“auto‑translate unavailable”** banner. &#x20;
* **Routing policy:**

  * UI strings & prompt copy → **MT provider** (Google/DeepL/MS).
  * **Agent summaries & chat** → **LLM translator** (expressive), backed by GPT‑5‑class models to retain tone/persona.&#x20;
* **SLO alignment:** Translation must not jeopardize the POP↔Engine latency budgets or SSE freshness. Cache aggressively and precompute where appropriate.&#x20;

---

## 1) Canonicalization rules

* **Engine canonical language:** **English** for embeddings, clustering, and synthesis. The Semantic Engine stores/generates the **canonical EN collective summary**; POP Edge handles localization for delivery. (Admin may preview localized variants, but the authoritative storage for synthesis is EN.)&#x20;
* **Inbound POPs & chat:** Detect source language; **store original as‑is** and **canonicalize to EN** for engine processing. (No user‑visible identity; retention is indefinite per policy.) &#x20;
* **Outbound presentation:** Deliver strings in the **user’s display language**; if absent, deliver EN and show fallback banner.&#x20;

---

## 2) Architecture (components & flow)

**Components (POP Edge):**

* `LocaleService` — device‑locale detection, settings override, and Accept‑Language negotiation.
* `TranslateRouter` — chooses **MT** or **LLM** path per content type.
* `MTClient` — Google/DeepL/MS adapters (simple, fast, cost‑efficient).
* `LLMTranslator` — GPT‑5 (mini/nano) for nuanced agent voice & chat.
* `I18nCache` — multi‑layer cache: Redis (hot), Postgres (warm/persistent).
* `PrecomputeWorker` — background pre‑localization for hot regions/locales on each agent‑state change.
* `I18nMetrics` — per‑provider latency, hit/miss, failures, and cost counters → `/metrics`.&#x20;

**High‑level flow**

```
(Submit POP / Chat)        (Read Collectives)
 └─ detect lang                └─ client requests /api/agent-states?ids=...&lang=xx
 └─ canonicalize→EN            └─ POP Edge returns localized summary from cache or
 └─ forward to engine              translates canonical EN→xx, caches, returns
                                    + SSE agent_state_update (EN) triggers precompute
```

* **SSE policy:** Broadcasts continue to include **canonical EN** in `agent_state_update`. Clients **render immediately** with what they have and **optionally refetch** `/api/agent-states?lang=xx` if the event digest changed. This keeps one global SSE stream while still supporting localized UI.&#x20;

---

## 3) APIs (client‑facing & admin)

> Extends existing POP contracts without breaking them. Public responses remain **collective‑only**.&#x20;

### 3.1 Agent states (localized read)

**GET** `/api/agent-states?ids={csv}&lang={bcp47}&refresh={bool}`

* **Behavior:**

  * If `lang` omitted → return **EN** (canonical).
  * If `lang` provided → return **localized summaries**.
  * Metadata includes `source`, `ttl_seconds`, and `partial_results` as today.&#x20;
* **Caching:**

  * Key: `agentstate:{prompt_id}:{region_id}:{lang}` in Redis (TTL \~60s).
  * Postgres warm cache: see §5 DDL.&#x20;

**Response (public):**

```json
{
  "agents":[ { "id":"city:US:ca:san-francisco","summary":"...", "updated_at":"..." } ],
  "metadata": { "cached_at":"...","ttl_seconds":60,"source":"cache","partial_results":false }
}
```

*(No stance/quotes.)*&#x20;

### 3.2 SSE (global)

**GET** `/api/events` → `agent_state_update` (summary in **EN**). Clients recompute or refetch localized content as needed.&#x20;

### 3.3 Prompts (copy‑localization)

**GET** `/v1/prompts/current` → includes **per‑locale strings** set by admins (see Admin doc). Device locale chooses display; manual override allowed client‑side.&#x20;

---

## 4) Provider routing (policy)

| Content                       | Path                                             | Rationale                                      |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| **UI strings**                | MT                                               | Deterministic, low‑latency                     |
| **Prompt copy**               | MT (+ human override in Admin)                   | Accuracy & editorial control                   |
| **Agent collective summary**  | **LLM** EN→xx with style preservation            | Keeps witty/regional tone; avoids robotic feel |
| **Region‑agent chat**         | **LLM** both directions (user→agent, agent→user) | Conversational nuance                          |
| **System banners (fallback)** | MT                                               | Minimal text, low variance                     |

* LLM defaults: `OPENAI_MODEL=gpt-5-mini` for summaries; `gpt-5-nano` for chat translation speed. Tune via env. &#x20;

---

## 5) Storage & cache

### 5.1 Redis keys (hot cache)

* `agentstate:{prompt}:{region}:{lang}` → localized summary (TTL 60 s).
* `i18n:hash:{sha256(text|src|dst|model)}` → translation string (TTL 30 d).
  Metrics: `agent_state_cache_hit/miss/store`, `i18n_cache_hit/miss`.&#x20;

### 5.2 Postgres (warm/persistent)

```sql
-- Localized agent states (to prevent stampedes & enable quick reads)
create table agent_state_localized (
  region_id text not null,
  prompt_id text not null,
  lang text not null,              -- bcp47 ('es', 'fr', 'zh-CN', ...)
  summary_localized text not null,
  updated_at timestamptz not null default now(),
  source text not null check (source in ('llm','mt')),
  primary key (region_id, prompt_id, lang)
);
create index ix_agent_state_localized_prompt on agent_state_localized(prompt_id);

-- Translation cache (generic)
create table translation_cache (
  key_hash text primary key,     -- sha256(text|src|dst|model)
  src_lang text not null,
  dst_lang text not null,
  provider text not null,        -- 'mt' | 'llm'
  translated text not null,
  created_at timestamptz not null default now(),
  last_access_at timestamptz not null default now()
);
```

* `agent_state_latest` remains **EN** only; `agent_state_localized` mirrors hot locales lazily or via precompute. &#x20;

---

## 6) Precompute strategy (to hit SLOs)

When POP receives `agent_state_update` (EN) for a hot region, **PrecomputeWorker**:

1. Schedules **background** EN→{Tier‑1 locales} for that region×prompt; write to Redis + Postgres.
2. Debounces per region (e.g., 2–5 s) to avoid thrash under bursts.
3. Hard cap overall work per minute to stay within cost budgets.
4. On Admin **Publish**, seed top locales for top N regions. &#x20;

**Result:** Most clients read **already‑localized** summaries from cache; no impact on POP→Engine critical path, preserving city/ancestor SLOs.&#x20;

---

## 7) Failure handling & UX

* **MT/LLM error →** Serve canonical EN with **fallback banner** (“Auto‑translate unavailable”). Keep the SSE‑driven freshness behavior intact. &#x20;
* **Provider outage →** Open **i18n breaker**, stop translation calls, rely on EN + banner until recovery; page via monitoring. (Mirror the congregator breaker playbook.) &#x20;
* **Rate‑limits →** Respect POP API rate‑limit envelopes and surface `retry_after` if the client ever calls a translation endpoint directly (rare).&#x20;

---

## 8) Security & privacy

* Never embed user identifiers in localized payloads; **public surfaces stay aggregate‑only**. Lineage (weights by `pop_public_id`) is admin‑only and **not localized** for the MVP.&#x20;
* Do **not** log raw texts at info level; if sampling is needed for quality eval during development, redact and keep behind staff‑only tools. (Logs increment `log_error_total` on failures.)&#x20;
* Indefinite retention of POPs/chats remains; localization tables can be pruned by time/window without violating product retention (they are derivations).&#x20;

---

## 9) Observability (metrics & alerts)

Add to the **Monitoring Plan** dashboards and alerting matrix:&#x20;

* `i18n_request_total{provider='mt|llm'}`
* `i18n_latency_ms_total{provider=...}` + `i18n_last_latency_ms`
* `i18n_failure_total{reason=timeout|rate_limit|server_error}`
* `i18n_cache_hit` / `i18n_cache_miss` / `i18n_cache_size`
* `localized_state_store_success_total` / `_failure_total`
* **Alert examples:**

  * MT/LLM failure rate > 5% (P1)
  * i18n cache hit < 60% for 10 min (P2)
  * Latency p95 > 800 ms for 10 min (P2)

Wire to `/metrics` and the monitor CLI alongside existing breaker/rollup/cache/SSE panels.&#x20;

---

## 10) Performance budgets

* **MT** p95 target: **<300 ms** per call; **LLM** p95 target: **<1200 ms** per call (batched where safe).
* **End‑user read:** localized **GET /api/agent-states** should remain **<500 ms** (served from Redis/Postgres, not on‑the‑fly LLM).&#x20;
* **Back‑pressure:** throttle precompute if queue builds; never block POP→Engine path. (Integrates with roll‑up debounce.)&#x20;

---

## 11) Client integration (Flutter)

* Use device locale on first boot; expose a **language switch** in Settings. The app passes `lang=xx` to `/api/agent-states` and renders localized summaries. If SSE shows an EN update digest change, **soft‑refresh** the localized states in the background. &#x20;
* **Accessibility:** show the fallback banner text via SR‑friendly label when translation is unavailable.&#x20;

---

## 12) Testing & acceptance

* **Unit:** `TranslateRouter` (routing rules), `I18nCache` (hit/miss, eviction), EN digest → localized invalidation logic.
* **Integration:** AgentState update → precompute Tier‑1 locales → client fetch with `lang=xx` returns localized summary **<500 ms**. Include SSE‑triggered refresh flow.&#x20;
* **Resilience:** Simulate MT/LLM timeouts; verify breaker opens, banner shows, metrics/alerts fire; recovery closes breaker and precompute backfills localized rows. (Run alongside the congregator breaker drill.) &#x20;

**Acceptance checklist**

* [ ] `/api/agent-states` returns localized summaries when `lang` is provided; public payload contains **only** `summary`.&#x20;
* [ ] SSE remains **EN**; clients refresh localized copies on update without UI thrash.&#x20;
* [ ] Fallback banner appears on MT/LLM failure; Admin prompt copy renders in device locale; manual override works.&#x20;
* [ ] i18n metrics live in dashboards; alerts wired; monitor CLI reports green under normal load.&#x20;
* [ ] City/ancestor SLOs remain within targets with i18n enabled.&#x20;

---

## 13) Implementation blueprint (files & env)

```
/server
  /i18n
    translateRouter.ts         // route MT vs LLM by content-type
    mtClient.ts                // Google/DeepL/MS adapters
    llmTranslator.ts           // GPT-5 wrapper (json mode, retries)
    i18nCache.ts               // Redis + Postgres cache
    precomputeWorker.ts        // background jobs (Tier-1 locales)
```

**Env knobs (POP Edge):**

```
I18N_TIER1_LOCALES=en,es,pt,fr,de,hi,ja,ko,zh-CN,zh-TW
I18N_CACHE_TTL_SEC=60            # agent-state localized cache TTL
I18N_TEXTCACHE_TTL_DAYS=30       # translation_cache retention
I18N_BREAKER_FAILURES=5
MT_PROVIDER=google|deepl|microsoft
LLM_I18N_MODEL=gpt-5-mini        # summaries
LLM_CHAT_I18N_MODEL=gpt-5-nano   # chat
```

Aligns with existing config and breaker conventions. &#x20;

---

## 14) Tickets for Codex

1. **I18N‑01**: Add `lang` support to `/api/agent-states`; return localized summaries from Redis/Postgres with metadata unchanged.&#x20;
2. **I18N‑02**: Implement `TranslateRouter` (MT vs LLM), provider adapters, retries, and redaction‑safe logging.&#x20;
3. **I18N‑03**: Redis + Postgres caches (`agent_state_localized`, `translation_cache`) with eviction and metrics.&#x20;
4. **I18N‑04**: Precompute worker that backfills Tier‑1 locales on `agent_state_update` (debounced). Wire to SSE digest changes. &#x20;
5. **I18N‑05**: Flutter settings screen for manual language override + fallback banner UI and tests.&#x20;
6. **I18N‑06**: Monitoring: new i18n metrics + alerts; integrate with monitor CLI and Grafana dashboards.&#x20;
7. **I18N‑07**: Resilience tests (timeouts/rate‑limits) and SSE‑triggered localized refresh E2E suite. &#x20;

---

## 15) Alignment & notes

* Preserves the **API Contracts** envelope, SSE event type, and error semantics; adds only an optional `lang` query to reads.&#x20;
* Fits the **Integration Architecture** loop and avoids adding latency to the POP→Engine critical path via precompute and caching.&#x20;
* Extends the **Monitoring Plan** with i18n‑specific counters/gauges; uses the existing runbooks & CLI for detections. &#x20;
* QA & probes can be folded into the current **Testing Strategy** (SSE probe, roll‑up tests) with localized assertions.&#x20;
* Matches **MVP Development Plan** expectations for commercial launch quality and responsiveness.&#x20;

---
