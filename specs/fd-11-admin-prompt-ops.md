**Focused Document #11 — Admin & Prompt Operations (Greenfield, Codex‑ready)**
*Scope:* This document defines the **admin workflows, RBAC, APIs, data models, and ops playbooks** for issuing and managing the weekly global prompt, enforcing product guardrails, and operating the POP→Semantic‑Engine loop. It preserves the **collective‑only** public surface (no stance bars, no quotes) while giving admins observability and safe operational controls. &#x20;

> **Compatibility note:** Earlier assets mention stance distributions and quotes. Those are **not** displayed publicly in this greenfield MVP; mobile renders a **single collective summary** per region, and SSE broadcasts `agent_state_update` only. Admin tools may inspect lineage weights for audit, but never expose identities or quotes publicly. &#x20;

---

## 0) Non‑negotiables this module enforces

* **One global prompt per week** (manually authored/published by admins in MVP). On publish, a new `prompt_id` (e.g., `2025‑W42`) becomes **active**; all submission/edit flows and aggregations target the active prompt.&#x20;
* **Public surfaces are collective‑only.** Admin actions must never cause stance bars, quotes, or user identifiers to reach the public API or SSE. `agent_state_update` remains the sole real‑time event type.&#x20;
* **Retention:** POPs, aggregates, and chat transcripts are retained indefinitely; pins are a **visual 24h TTL only**. Roll‑ups persist for the prompt week and are refreshed by the next prompt.&#x20;
* **Safety posture:** Only illegal content + spam automation are hard‑blocked; “cooling‑off” can **mute chat** at a region if abuse spikes.&#x20;

---

## 1) Roles & access (RBAC)

| Role                    | Who               | Permissions                                                                                             |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| **Owner**               | Founders/lead ops | All Admin actions + secret/flag management                                                              |
| **Prompt Admin**        | Editorial team    | Create/edit/localize prompts; schedule/publish/close; preview; invalidate cache; trigger region refresh |
| **Ops Admin**           | SRE/Backend       | Mute/unmute region chat; trigger recompute; view metrics & runbooks; toggle feature flags               |
| **Analyst (read‑only)** | Insights          | Read prompt history, lineage weights, and metrics dashboards (no writes)                                |

* Admin panel is a **separate, staff‑only web app** (Next.js or minimal Fastify‑+‑React) behind SSO/API‑key and IP allowlist. It talks to the same POP API/metrics endpoints used by mobile and ops tooling. &#x20;

---

## 2) Prompt lifecycle (state machine)

**States:** `Draft → Localized → Scheduled? → Published(Active) → Closed → Archived`

1. **Draft**: Enter base prompt text (English).
2. **Localized**: Auto‑translate into target locales; admins may override copy per locale. (Display language to users follows device locale; engine canonicalizes internally.)&#x20;
3. **(Optional) Scheduled**: Set `start_at` for timed publish (MVP may keep publish manual).
4. **Published (Active)**:

   * Generates canonical `prompt_id` (`YYYY‑Www`).
   * **Invalidates** agent‑state caches; POP API starts serving the new prompt to clients.
   * Engine/POP begin computing collectives for the new prompt; SSE broadcasts fresh `agent_state_update` as states materialize. &#x20;
5. **Closed**: Submissions/edit window ends; collectives persist/readable until next prompt replaces them in the UI. Data retained indefinitely.
6. **Archived**: Locked; available to admins/analysts only (history & lineage weights).

**Admin guardrails**

* Publishing auto‑closes the previous prompt; mobile fetches **current prompt** at app start and uses its `prompt_id` for submission/edit gates. (See §5 APIs.)&#x20;
* **Edits** to active prompt text are allowed only as **non‑semantic copy fixes**; changing semantics must create a new prompt to preserve integrity.
* “Unpublish” is disallowed; instead **Close** early (retains audit trail).

---

## 3) Admin web app — screens & workflows

1. **Prompts List**

   * Table: `prompt_id`, title, status, start/end, created\_by, **SLO freshness** (latest city/state/country refresh P95), and quick actions (Preview, Publish/Close, View lineage). Metrics pulled from POP `/metrics`.&#x20;

2. **Create/Localize Prompt**

   * Base text, tone guidance (short note for the agent), display locales (en, es, pt, fr, de, hi, ja, ko, zh‑CN, zh‑TW), auto‑translate + manual override. Shows preview cards per locale.&#x20;

3. **Publish & Health Check**

   * “Publish” generates `prompt_id`, invalidates caches, and kicks a city sample recompute to validate engine health. Shows **live SLO panel** (city <10s; ancestor <30s; cache reads <500ms; SSE <1s), wired to Monitoring Plan metrics.&#x20;

4. **Lineage & Weights (Audit)**

   * Region picker → lineage view shows `{pop_public_id, weight_pct}` list, weight digest (gini, mean), model versions and prompt hashes; **no identities**. CSV export for analysis.&#x20;

5. **Ops Controls**

   * **Manual refresh**: trigger recompute for selected regions.
   * **Regional chat mute**: set a timed mute (e.g., 5–30 min) with reason; banner appears client‑side.
   * **Breaker visibility**: read‑only view of congregator breaker state & retry queue, link to outage runbook.&#x20;

6. **Prompt History**

   * Read‑only archive; filter by date; export lineage weights; compare digests across prompts.

---

## 4) Data model (DDL sketch)

```sql
-- Prompts
create table prompts (
  prompt_id text primary key,              -- e.g., '2025-W42'
  title text not null,                     -- a short display title
  text_en text not null,                   -- canonical question text (EN)
  locales jsonb not null default '{}',     -- { "es": "...", "fr": "...", ... }
  status text not null check (status in ('draft','localized','scheduled','active','closed','archived')),
  start_at timestamptz,
  end_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Region mutes (ops control)
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

* Lineage weights & collective state live in engine/POP stores already specified; admin reads through POP/Engine lineage endpoints. &#x20;

---

## 5) APIs (admin + public)

### 5.1 Public read (mobile needs)

* `GET /v1/prompts/current` →

  ```json
  { "prompt_id":"2025-W42",
    "text":{"en":"…","es":"…","pt":"…","fr":"…","de":"…","hi":"…","ja":"…","ko":"…","zh-CN":"…","zh-TW":"…"},
    "start_at":"…","end_at":"…" }
  ```

  **Usage:** Composer UI and chat anchoring; device locale selects display copy; engine may still synthesize in EN internally.&#x20;

> Mobile continues to fetch agent states via `/v1/agent-states` and receives **only** `collective_summary` per region; SSE streams `agent_state_update`.&#x20;

### 5.2 Admin (staff‑only)

* `POST /v1/admin/prompts` — create draft `{text_en, title}` → `{prompt_id}`
* `PUT /v1/admin/prompts/:id/locales` — upsert localized copies `{ "es": "...", ... }`
* `PUT /v1/admin/prompts/:id/publish` — set active; **invalidates caches**, schedules sample refresh (non‑blocking)
* `PUT /v1/admin/prompts/:id/close` — end early
* `GET /v1/admin/prompts?status=active|closed|archived`
* `POST /v1/admin/prompts/:id/refresh?regions=city:US:ca:san-francisco,state:US:ca` — force recompute & POP cache update (debounced for ancestors)&#x20;
* `POST /v1/admin/regions/:regionId/mute` — body `{minutes, reason}`
* `DELETE /v1/admin/regions/:regionId/mute`
* `GET /v1/admin/lineage/:regionId?prompt_id=...` — server‑side proxy to engine lineage; **no identities**.&#x20;

**Error envelopes & rate limits** follow POP API standards (`retry_after`, `trace_id`, 429/5xx semantics).&#x20;

---

## 6) Integration behaviors (publish, refresh, SSE)

**On Publish**

1. POP marks new `prompt_id` **active**, rotates **submission/edit gates** server‑side.
2. POP **invalidates Redis agent‑state cache**; `GET /v1/agent-states` begins returning blanks until engine computes fresh states (clients show skeletons).&#x20;
3. POP calls Engine **warm‑up recompute** for hot regions (optional); subsequent submissions drive normal recompute. Engine debounces ancestors for SLO.&#x20;
4. As results arrive, POP broadcasts **`agent_state_update`** to subscribed clients.&#x20;

**Manual Refresh**

* Triggers an immediate fetch from Engine with breaker/timeout protection; on success, POP stores cache and emits SSE; on failure, POP serves cache with `partial_results` and logs to monitoring.&#x20;

---

## 7) Localization policy

* **Copy‑localization** for prompts: Admin may override auto‑translations per locale. Device locale drives display; a manual switch exists client‑side. If MT fails, clients show original with a small banner.&#x20;
* **Engine canonicalization**: Engine can canonicalize POP text to EN for embeddings/synthesis, independent of display language. (Admin UX is language‑agnostic.)&#x20;

---

## 8) Safety & enforcement knobs (admin‑visible)

* **Hard‑block categories** (fixed): illegal sexual content involving minors; explicit terrorism/criminal threats/credible imminent violence; spam/automation. Admin UI shows counters for blocks by region/prompt and exposes **regional chat mute**.&#x20;
* **No editorial filtering:** Borderline but legal content is **not** suppressed; collectives should reflect authentic sentiment. Admin UI intentionally lacks knobs to bias summaries.&#x20;

---

## 9) Observability: metrics, dashboards, alerts (admin views)

**Admin panels surface:**

* Prompt publish/close events; **time‑to‑first collective** per hot region; **city/state/country refresh latencies** (P95).
* Cache health: `agent_state_cache_hit/miss/stale/store`, cache size gauge.
* Real‑time: `sse_active_clients`, `agent_state_update_total`.
* Engine/bridge health: `dual_write_success_rate`, breaker state, retry queue, rollup queue depth.
  Panels & alert thresholds come from the Monitoring Plan; admin links jump to the **Breaker & Retry Queue** runbook. &#x20;

---

## 10) Security & privacy

* Admin endpoints require **staff SSO/API key**; all requests carry `X‑Request‑ID`.
* No public API returns user identifiers; lineage shows `pop_public_id` + weight only.
* Admin audit log for every state change (publish, close, mute, refresh) with actor and reason, stored with the `trace_id`.&#x20;

---

## 11) Performance & SLO expectations (admin operations)

* **Publish → first city collective visible** (hot region): operator should see activity within **<10 s P95**; **ancestors <30 s** once traffic arrives or warm‑up completes. Cached reads remain **<500 ms**; SSE **<1 s** E2E. Admin dashboard highlights breaches in near real‑time.&#x20;

---

## 12) Failure modes & runbooks

* If breaker opens or retry queue grows, admin **Publish** still succeeds (users can submit), but panels will show **cache/stale** badges until Engine recovers; follow **Congregator Breaker & Retry Queue Recovery**.&#x20;
* If translation vendors fail, the admin panel still allows publish; clients display original language with a banner per localization fallback.&#x20;

---

## 13) Reference implementation blueprint (files)

```
/admin
  /web            # Next.js app with staff SSO
  /server         # Fastify admin API (or routes colocated in POP API under /v1/admin/*)
    routes/prompts.ts         # create/publish/close/list
    routes/ops.ts             # region mute/unmute, manual refresh
    routes/lineage.ts         # proxy to engine lineage
    services/promptService.ts # DDL + cache invalidation hooks
    services/opsService.ts    # chat mute, recompute orchestration
```

* POP API already exposes `/metrics` and SSE; reuse that data for admin dashboards.&#x20;

---

## 14) API examples

**Create + publish a prompt**

```http
POST /v1/admin/prompts
{
  "title":"Question of the Week",
  "text_en":"Where do you stand on the ______ dilemma?"
}
→ 201 { "prompt_id":"2025-W42" }

PUT /v1/admin/prompts/2025-W42/locales
{ "es":"¿Cuál es tu postura sobre …?", "fr":"Quelle est ta position sur …?" }

PUT /v1/admin/prompts/2025-W42/publish
→ 200 { "ok":true, "cache_invalidated":true }
```

**Public: current prompt**

```http
GET /v1/prompts/current
→ 200 { "prompt_id":"2025-W42", "text":{ "en":"…","es":"…" }, "start_at":"…","end_at":"…" }
```

**Ops: regional chat mute**

```http
POST /v1/admin/regions/city:US:ca:san-francisco/mute
{ "minutes": 15, "reason":"automation spike" }
→ 200 { "ok":true, "muted_until":"…" }
```

Client shows a subtle “cooling off” banner; unmute clears it.&#x20;

---

## 15) Testing & acceptance (admin module)

* **Unit:** promptService (state transitions, locale overrides), opsService (mute window math), cache invalidation.
* **Integration:** Publish → POP cache invalidated → first city collective visible <10 s; ancestors <30 s; SSE events broadcast. (Use existing probes & `/metrics`.) &#x20;
* **Resilience:** Breaker drill during active prompt; admin dashboard shows cache/stale; follow runbook and confirm recovery.&#x20;
* **Localization:** Locale overrides display correctly on client; fallback banner appears when translation disabled.&#x20;

**Acceptance checklist**

* [ ] Publish sets active `prompt_id`, invalidates caches, and preserves prior data in archive.&#x20;
* [ ] Public API/SSE remain **collective‑only**; lineage is audit‑safe.&#x20;
* [ ] Ops controls (mute/refresh) function and are audited; dashboards reflect changes within 1 minute.&#x20;
* [ ] SLOs observable on publish and under load; alerts wired.&#x20;

---

## 16) Tickets Codex should generate

* **ADM‑01**: Admin API scaffolding (`/v1/admin/prompts`, `/v1/prompts/current`, `/v1/admin/regions/:id/mute`, refresh). Error envelopes per POP conventions.&#x20;
* **ADM‑02**: Prompt DDL + migrations; audit log table.
* **ADM‑03**: Cache invalidation & warm‑up orchestration (engine fetch + POP cache set + SSE broadcast).&#x20;
* **ADM‑04**: Admin web (SSO), Prompts List, Create/Localize, Publish & Health, Lineage Audit, Ops controls.
* **ADM‑05**: Monitoring widgets (metrics panels) and links to the **Runbook**; alert summaries inline. &#x20;
* **ADM‑06**: E2E tests: publish → first city update <10 s; ancestor <30 s; lineage readable; region chat mute banner shown/cleared.&#x20;

---
