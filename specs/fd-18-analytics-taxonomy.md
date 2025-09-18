**Focused Document #18 — Analytics & Event Taxonomy (+ Dashboard Mapping, Codex‑ready)**
*Purpose:* Define a single, privacy‑safe analytics vocabulary and metrics map for **POP + Semantic Congregation** that (1) captures user behavior (map, bubbles, chat), (2) measures back‑end health (ingest, rollups, cache, SSE), and (3) powers **Grafana/Prometheus** dashboards and alerts used by on‑call and product. This spec aligns all telemetry with the public **collective‑only** surface (no stance bars/quotes in user UI or logs) and with existing contracts and runbooks.  &#x20;

---

## 0) Non‑negotiables & privacy guardrails

* **Collective‑only public surface**: analytics **must not** capture raw POP text, quotes, or per‑user identifiers. Region‑level **IDs** and numeric aggregates are allowed. Lineage exposure (weights by `pop_public_id`) is **admin‑only**, never logged in analytics.&#x20;
* **No PII in events**: forbid URLs, emails, phones, user handles, or free‑text fields in telemetry. Use enums/IDs/timestamps only. (Matches API validation policy.)&#x20;
* **SLO awareness**: instrumentation must not impact the POP↔Engine latency SLOs (city <10 s, ancestor <30 s; cached reads <500 ms; SSE <1–2 s). Emit counters/gauges asynchronously and sample where needed.&#x20;
* **Runbook alignment**: dashboards and alerts feed the **congregator breaker** runbook and monitor CLI.&#x20;

---

## 1) Sources & sinks (end‑to‑end)

**Client → POP Edge:**

* `/api/chat-events` (POST) — batched interaction events from map, bubbles, chat. Rate‑limited + sampled. (New, defined below.)
* SSE health pings are **derived** client‑side and **not** posted directly; server exposes transport metrics. &#x20;

**POP Edge (server) internal metrics:**

* Prometheus text at `/metrics` (primary for dashboards). JSON snapshot at `/api/metrics` (monitor CLI).&#x20;

**Upstream signals (engine):**

* POP proxies/refreshes **AgentState** and emits `agent_state_update` over SSE; success/failure/latency are metered. &#x20;

---

## 2) Unified client event envelope (for `/api/chat-events`)

> The client sends arrays of strongly‑typed events. The server validates, increments counters/gauges, **drops payload content**, and returns 202.

```ts
// POST /api/chat-events
interface ChatEventsEnvelope {
  client_ts: string;            // ISO-8601 from device
  session_id: string;           // ephemeral (UUIDv4), rotates daily
  app: { version: string; platform: 'ios'|'android'|'web'; locale: string };
  events: ClientEvent[];
}

type ClientEvent =
  | BubbleEvent
  | OverlayEvent
  | ProbeEvent
  | ChatEvent
  | SseClientEvent;

interface BaseEvt {
  type: string;
  ts: string;                   // ISO-8601
  region_id?: string;           // canonical
  prompt_id?: string;
}
```

**Event families & payloads** (PII‑safe):

* **BubbleEvent**

  * `bubble_pin_rendered` `{variant: 'individual'|'cluster'|'city'|'state'|'country'}`
  * `bubble_pin_clicked` `{variant, region_id}`
  * `bubble_rollup_transition` `{from:'individual|cluster|city|state|country', to:'...'}`
    *Maps to existing counters/gauges.* &#x20;

* **OverlayEvent**

  * `chat_overlay_open` `{region_id}`
  * `chat_overlay_close` `{region_id, duration_ms}`
    *Tracks discovery → conversation funnel.*&#x20;

* **ProbeEvent**

  * `probe_network_open` `{region_id}`
  * `probe_node_selected` `{region_id, node_id_hash}`
    *Implements synaptic network analytics.*&#x20;

* **ChatEvent**

  * `chat_session_start` `{region_id}`
  * `chat_turn_agent` `{region_id}`   // increments per agent reply (no text)
  * `chat_turn_user` `{region_id}`    // increments per user turn (no text)
  * `chat_session_end` `{region_id, reason:'limit'|'idle'|'user'|'error', turns:number, duration_ms:number}`
    *Matches session/turn policies (20 turns, 30‑min idle).*&#x20;

* **SseClientEvent**

  * `sse_client_open` `{regions_subscribed:number}`
  * `sse_client_reconnect` `{attempt:number}`
  * `sse_client_close` `{reason:'idle'|'network'|'error'}`
    *Correlates with server-side `sse_active_clients`.*&#x20;

**Server behavior:**

* Validate `region_id` format; reject unknown `type`.
* Rate‑limit endpoint and **sample** high‑volume events (render ticks).
* Convert to counters/gauges listed in §4; **never** persist envelopes.&#x20;

---

## 3) Server/engine operational metrics (authoritative)

The Monitoring Plan enumerates required gauges/counters; we adopt these names verbatim to keep dashboards/runbooks intact (breaker state, retry queue, cache hit, rollup queues, SSE clients, etc.).&#x20;

Key families (selection):

* **Ingest & dual‑write:** `pop_submission_total`, `dual_write_success_rate`, `congregator_retry_queue_size`, breaker counters. &#x20;
* **AgentState pipeline:** `agent_state_refresh_*`, `agent_state_cache_*`, `agent_state_batch_*`.&#x20;
* **Rollups:** `rollup_*` queues, schedule/process totals, latency gauges.&#x20;
* **SSE:** `sse_active_clients` (gauge), `agent_state_update_total` (counter).&#x20;
* **Chat overlay/product:** `chat_overlay_served_total` + chat event counters (see §4).&#x20;

These map to Integration Architecture data flows and API/SSE semantics (e.g., `agent_state_update`). &#x20;

---

## 4) Event → Metric mapping (canonical dictionary)

> The server increments the following **Prometheus** metrics upon receiving client events or after server actions. Names and semantics match the Monitoring Plan’s inventory to plug into existing dashboards.&#x20;

### 4.1 Map & bubble interactions

| Client event               | Metric name                                    | Type    | Labels                      |
| -------------------------- | ---------------------------------------------- | ------- | --------------------------- |
| `bubble_pin_rendered`      | `bubble_pin_rendered_<variant>_total`          | counter | `prompt_id`, `region_level` |
| `bubble_pin_clicked`       | `bubble_pin_clicked_total`                     | counter | `prompt_id`, `variant`      |
| `bubble_rollup_transition` | `bubble_rollup_transition_from_<from>_to_<to>` | counter | `prompt_id`                 |
| — visibility snapshot —    | `agent_state_rollup_visible_<level>`           | gauge   | `prompt_id`                 |

*(Variant levels: `individual|cluster|city|state|country`; thresholds and overlay behavior come from the chat‑bubble spec.)*&#x20;

### 4.2 Overlay & probe

| Client event          | Metric                           | Type          | Labels                      |
| --------------------- | -------------------------------- | ------------- | --------------------------- |
| `chat_overlay_open`   | `chat_overlay_served_total`      | counter       | `prompt_id`, `region_level` |
| `chat_overlay_close`  | `chat_overlay_duration_ms_total` | counter (sum) | `prompt_id`, `region_level` |
| `probe_network_open`  | `probe_network_open_total`       | counter       | `prompt_id`                 |
| `probe_node_selected` | `probe_node_selected_total`      | counter       | `prompt_id`                 |

*(Probe analytics requested in chat bubble & implementation docs.)* &#x20;

### 4.3 Chat sessions (policy‑aligned)

| Client event          | Metric                            | Type    | Labels                      |
| --------------------- | --------------------------------- | ------- | --------------------------- |
| `chat_session_start`  | `chat_session_start_total`        | counter | `prompt_id`, `region_level` |
| `chat_turn_user`      | `chat_turn_user_total`            | counter | `prompt_id`                 |
| `chat_turn_agent`     | `chat_turn_agent_total`           | counter | `prompt_id`                 |
| `chat_session_end`    | `chat_session_end_total`          | counter | `prompt_id`, `reason`       |
| (server) region mutes | `region_chat_mute_active{region}` | gauge   | `region_id`, `prompt_id`    |

*(Matches 20‑turn/30‑min policy and regional rate caps; mutes emitted server‑side on abuse spikes.)*&#x20;

### 4.4 SSE client health (client + server)

| Source | Metric                                                                                                   | Type    |
| ------ | -------------------------------------------------------------------------------------------------------- | ------- |
| server | `sse_active_clients`                                                                                     | gauge   |
| server | `agent_state_update_total`                                                                               | counter |
| client | `sse_client_open/reconnect/close` → **derived** panels only (no metric necessary if server gauges exist) | —       |

*(SSE payload type is `agent_state_update`.)* &#x20;

### 4.5 Back‑end pipeline & cache

* **Already defined** in Monitoring Plan: `agent_state_cache_hit/miss/store/size`, `agent_state_refresh_*`, `rollup_*`, `dual_write_*`, **breaker** gauges/counters. Use verbatim to avoid drift.&#x20;

---

## 5) Dashboards (panels and formulas)

The Monitoring Plan ships three core dashboards; we **add one product dashboard**.&#x20;

1. **Ingestion Overview** — *existing*

   * `pop_submission_total` (rate), `dual_write_success_rate`, `congregator_breaker_state`, `congregator_retry_queue_size`, `log_error_total` (rate). Link **breaker runbook**. &#x20;

2. **AgentState Health** — *existing*

   * `agent_state_cache_hit / (hit+miss)`, `agent_state_refresh_last_latency_ms`, `rollup_queue_size`, `agent_state_batch_failure`. Add panel “**City→Ancestor latency**” derived from refresh counters.&#x20;

3. **Real‑time Delivery** — *existing*

   * `sse_active_clients`, `agent_state_update_total` (rate), optional backlog histogram (future).&#x20;

4. **NEW: Product Engagement** — *add now*

   * **Map funnel:** `bubble_pin_rendered_*` → `bubble_pin_clicked_total` → `chat_overlay_served_total`.
   * **Hierarchy navigation:** `bubble_rollup_transition_*`, `agent_state_rollup_visible_<level>`.
   * **Probe usage:** `probe_network_open_total`, `probe_node_selected_total`.
   * **Chat loop:** `chat_session_start_total` → `chat_turn_*_total` → `chat_session_end_total`.
   * **SSE UX:** overlay opens vs `sse_active_clients` to spot freshness issues.
     *(Use time series + bar charts; annotate deploys.)* &#x20;

---

## 6) Alert matrix (augment ops alerts)

Build on Monitoring Plan thresholds; add product‑level alerts to catch silent UX regressions.&#x20;

| Condition                                                                          | Sev | Action                                   |
| ---------------------------------------------------------------------------------- | --- | ---------------------------------------- |
| `dual_write_success_rate < 0.98` 5m                                                | P1  | Trigger breaker runbook.                 |
| `congregator_breaker_state == 1` 2m                                                | P1  | Validate engine, consider feature flag.  |
| `agent_state_cache_hit < 70%` 10m                                                  | P2  | Investigate cache stampede/TTL.          |
| `rollup_last_latency_ms > 30000` 5m                                                | P2  | Check rollup queue/debounce.             |
| **Product**: `chat_overlay_served_total` drops >60% vs traffic                     | P2  | UI regression or SSE staleness.          |
| **Product**: `bubble_pin_clicked_total` ⇒ `chat_overlay_served_total` CTR < 5% 10m | P3  | Investigate overlay open failures.       |
| **Abuse**: sustained `region_chat_mute_active` on >3 regions                       | P2  | Review mutes and automation signals.     |

---

## 7) Implementation blueprint (server & client)

**Server (POP Edge)**

```
server/
  analytics/
    chatEventsRouter.ts        // POST /api/chat-events (validate, sample, metrics++)
    schema.ts                  // zod schemas for envelope
    metrics.ts                 // Prometheus registry: define counters/gauges in §4
  metrics/
    exporter.ts                // /metrics and /api/metrics plumbing
```

* **Rate‑limit** `/api/chat-events` and **sample** render events (e.g., 10–30%). Emit `X‑RateLimit-*`.&#x20;
* Reuse existing **pino** logger only for **errors**; do **not** log event payloads.&#x20;
* Wire counters defined in §4 to existing dashboards (no new exporter format).&#x20;

**Client (Flutter/web)**

* Centralize a `trackChatEvent(e)` helper that batches to `/api/chat-events` on a timer (5–10 s) or on background/teardown; drop silently on network errors.
* Emit events listed in §2 from Map bubble overlay and Node chat overlay; names must match **exactly**. (Web scaffolding exists; Flutter mirrors it.)&#x20;

**SSE & pipeline metrics**

* Keep server metrics as in Monitoring Plan; hook **Integration Architecture** events (`agent_state_update`) into `agent_state_update_total` and refresh latency gauges. &#x20;

---

## 8) KPIs for launch (computed from metrics)

* **Map → Chat conversion (CTR)** = `chat_overlay_served_total / bubble_pin_clicked_total` (windowed).
* **Chat engagement** = avg `chat_turn_user_total + chat_turn_agent_total` per `chat_session_start_total`.
* **Live freshness** = `rate(agent_state_update_total)` per active `sse_active_clients`.
* **Rollup timeliness** = derived P95 from `agent_state_refresh_latency_ms_total` and last‑latency gauges.
* **Cache efficiency** = `agent_state_cache_hit / (hit + miss)`.
  *(KPI set sits alongside MVP plan success metrics.)*&#x20;

---

## 9) Testing & QA hooks

* **Unit:** schema validation; rate‑limit and sampling paths; metric increments on each event type. (Add tests next to existing limiter/SSE suites.)&#x20;
* **Integration:** Playwright or probe scripts: generate bubble/overlay/probe/chat events, then scrape `/metrics` to assert counter deltas. Include SSE soak to correlate `agent_state_update_total`.&#x20;
* **Load:** run `npm run test:load` + `npm run test:sse`; verify counters increase and no breaker/queue alerts fire.&#x20;
* **Acceptance:** dashboards show non‑zero engagement, CTR within expected band, and alerts remain green during rehearsal.&#x20;

---

## 10) Compatibility notes

* **Older UI assets** that rendered stance bars/quotes should **not** emit contentful analytics and should not appear in user UI. Public surfaces and analytics remain **collective‑only**. (Admin lineage remains separate and audit‑scoped.)&#x20;
* Names chosen here match existing metrics inventories so Grafana JSON can be reused with minimal edits.&#x20;

---

## 11) Deliverables for Codex (tickets)

1. **ANALYTICS‑01** — Implement `/api/chat-events` (schema validation, sampling, 202 responses, Prometheus increments per §4; rate‑limits + `X‑RateLimit-*`). &#x20;
2. **ANALYTICS‑02** — Wire Map & Overlay emitters (web & Flutter) to send events defined in §2 (batched). Update existing web hooks to new names where needed. &#x20;
3. **ANALYTICS‑03** — Extend `/metrics` registry with new counters/gauges and add **Product Engagement** dashboard JSON.&#x20;
4. **ANALYTICS‑04** — Alert rules for product funnel & SSE freshness; hook to `npm run monitor:ops` destinations. &#x20;
5. **ANALYTICS‑05** — E2E tests: emit client events, assert Prometheus deltas; SSE probe correlation to `agent_state_update_total`.&#x20;
6. **ANALYTICS‑06** — Privacy lint: ensure no event schema accepts free‑text; add CI check that rejects unknown event types/fields.

---

## 12) Acceptance checklist

* [ ] `/api/chat-events` accepts only whitelisted event types, enforces schema, and **never** logs payloads; returns 202 and increments metrics.&#x20;
* [ ] Dashboards show **map → overlay → chat** funnel; CTR and session metrics trend with traffic; probe usage visible. &#x20;
* [ ] Ops alerts fire per matrix and link to **breaker runbook**; monitor CLI reflects the same conditions. &#x20;
* [ ] No POP text/quotes/PII in telemetry; automated tests verify schema‑only logging.&#x20;
* [ ] KPI formulas computable from metrics; SLO dashboards remain green under nominal load. &#x20;

---

### Alignment summary

This taxonomy **formalizes** the client↔server analytics bridge, keeps telemetry **privacy‑preserving**, and reuses the Monitoring Plan’s metrics so **dashboards, alerts, and runbooks** work out‑of‑the‑box with the Integration Architecture and API/SSE contracts.  &#x20;
