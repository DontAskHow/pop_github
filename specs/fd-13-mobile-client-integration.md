**Focused Document #13 — Mobile App (Flutter) Client Integration Spec**
*Goal:* Define a **commercial‑grade Flutter client** for iOS/Android that delivers POP’s mobile‑first experience: anonymous location‑anchored POPs, **collective summary** per region (no stance bars, no quotes), real‑time updates via SSE, weekly prompt lifecycle, and region‑agent chat. This spec binds the app to the POP Edge API/SSE contracts and monitoring expectations, and encodes accessibility, i18n, privacy, and resilience behaviors required for MVP launch.  &#x20;

> **Public surface is collective‑only.** Older assets that include stance distributions and representative quotes are not shown to end users in this MVP. The client must **ignore** `stance_dist`/`quotes` fields if they appear in responses and render **only** the region’s *collective summary*. SSE continues to use the `agent_state_update` event type.&#x20;

---

## 0) Non‑negotiables (Product & Policy)

* **Anonymous UI:** Never display usernames/avatars—*not even to the owner*. All public displays are aggregates.&#x20;
* **One POP per prompt per account.** Edits allowed until the prompt window closes (older copies remain stored internally); user self‑delete/export is not provided in MVP. Pins visually expire after **24 h**; data is retained indefinitely.&#x20;
* **Pre‑login browsing:** Map & collectives are readable without login. Post/chat actions require SSO and **13+** gating.&#x20;
* **Global map, Google Maps SDK, chat with region agent, live auto‑translation UX & fallback banner when translation is unavailable.**&#x20;

---

## 1) Client architecture (Flutter)

**Recommended tech:**

* **Flutter** (3.x), **Dart** (>=3), **google\_maps\_flutter** for maps, **Dio** (HTTP), **EventSource client** for SSE, **Riverpod** or **Bloc** for state, **Freezed/JsonSerializable** for models, **Intl** for i18n, **GoRouter** for nav.
* **Module layout**

  ```
  lib/
    app/          // boot, routing, theme, localization
    auth/         // SSO flows (Apple/Google), 13+ gate
    map/          // Map screen, bubble overlay, clustering
    agent/        // Region agent: summaries, chat sessions
    prompt/       // Current prompt fetch/display
    data/         // API clients (AgentStates, Lineage, Chat, SSE)
    core/         // telemetry, error handling, storage, env config
  ```
* **Threading:** use isolates only when processing heavier geometry/clustering; otherwise rely on async streams for SSE.

**Why this shape:** clean separation between **API contracts** (AgentStates/SSE) and **map/chat UI**, mirroring server responsibilities and observability hooks. &#x20;

---

## 2) Network & contracts (what the app calls)

> The mobile client speaks to the **POP Edge API** and subscribes to **SSE**. Endpoints and event semantics below are authoritative for the app. (Admin endpoints exist server‑side; mobile only needs the *current prompt*, AgentStates, Lineage for “your contribution,” and chat.)&#x20;

### 2.1 Region summaries (collective only)

* **GET** `/api/agent-states?ids=city:US:ca:san-francisco,state:US:ca,country:US`
  **Response**

  ```json
  { "agents":[ { "id":"city:US:ca:san-francisco", "summary":"...", "updated_at":"..." } ],
    "metadata":{ "cached_at":"...", "ttl_seconds":60, "source":"cache", "partial_results":false } }
  ```

  * The client **must ignore** any `stance_dist`/`quotes` fields should they appear in payloads (older assets) and render only the `summary`.&#x20;

### 2.2 Real‑time updates

* **SSE** `/api/events` → events of type `agent_state_update`:

  ```
  event: agent_state_update
  data: {"region_id":"city:US:ca:san-francisco","agent_state":{...},"updated_at":"...","change_type":"updated","trigger_reason":"new_pop"}
  ```

  * Client filters to subscribed regions and updates the local cache. Maintain monotonic ordering per region and coalesce bursts (50–150 ms debounce) to avoid UI thrash.&#x20;

### 2.3 Lineage weights (user‑only contribution badge)

* **GET** `/api/agent-lineage/:regionId?prompt_id=...` returns an audit payload that includes anonymized `pop_public_id` weights. The app **only** uses this to show **“Your contribution: X%”** (if the user has a POP for the active prompt). Never expose other POP identifiers.&#x20;

### 2.4 Current prompt (display)

* **GET** `/v1/prompts/current` → `{ prompt_id, text: {en, es, ...}, start_at, end_at }`

  * Used to anchor the header and compose UI copy in the user’s display language; posting/chat are tied to this `prompt_id`. *(Server‑side spec provided in Admin & Prompt Ops document; mobile consumes only.)*

> All above requests are **read‑only before login**; posting/chat require login. Rate limits and structured errors come from the POP Edge API.&#x20;

---

## 3) Authentication & sessions

* **SSO Providers:** **Apple** (iOS), **Google** (Android + iOS). Tokens stored in secure storage; refresh silently on app open if possible.
* **Age gate:** 13+ check at first launch and before enabling post/chat actions.
* **Anonymous browsing:** The map, collective summaries, and chat transcript headers are viewable pre‑login; **“Post a POP”** and **“Chat”** actions prompt sign‑in.&#x20;

---

## 4) Map & Bubble UX (Flutter)

> The **pulse circles** concept is retired. The overlay uses **mini chat bubbles** for individual POPs and **aggregate bubbles/cards** for city→state→country, with staged zoom transitions. (Mobile mirrors the product direction previously articulated for the chat bubble overlay.)&#x20;

### 4.1 Variants & zoom behavior

* **Individual POP** (≥ zoom 14): 64×48 speech bubble styled like the submission bubble; shows **only** a truncated excerpt of the user’s POP **for the owner’s own pin**; for all other users, **individual pins are anonymous yellow bubbles with no text**. TTL visual: 24 h.
* **Cluster** (zoom 12–<14): Stacked bubble indicating count; tap to zoom‑in fan‑out.
* **City** (zoom 10–<12), **State** (7–<10), **Country** (< 7): glass card or panel anchored to centroid/capital; **render only `collective summary`**, freshness indicator, and an “Open chat” CTA.
* **Transitions:** staged fade/scale with 50 ms stagger; respect `prefers‑reduced‑motion` (opacity‑only).&#x20;

### 4.2 Clustering & bounds

* Apply H3‑like clustering (or Google Maps renderer clustering) at mid zooms; feed overlay from the **AgentStates cache + live POP pin feed**; dedupe by id; enforce map‑safe density.&#x20;

### 4.3 Accessibility

* Bubbles are focusable, announce “Open chat for {region}”; cards meet WCAG AA; keyboard traversal cycles closest first; reduced‑motion toggle respected.&#x20;

---

## 5) Real‑time, caching & offline

* **SSE first:** connect at app start; subscribe to visible regions; on reconnect, request replay (server supports backlog) and then refetch stale regions. Track and show a subtle “Live” indicator when fresh updates land.&#x20;
* **Client cache:** in‑memory `AgentStateStore` keyed by `(region_id,prompt_id)` with soft TTL \~30–60 s; invalidate on `agent_state_update`.
* **Polling fallback:** when SSE is unavailable, poll `/api/agent-states` every 15 s for visible regions; **never** hammer; respect rate limits.
* **Offline:** show last cached collectives with a “possibly stale” badge and disable actions that require fresh network.
* **Performance budgets (client side):** UI render under 16ms/frame on mid‑tier phones, network calls batched per viewport. Server budgets: cached reads ≤ 500 ms P95 and SSE E2E < 1 s are enforced at POP Edge; the client assumes those SLOs.&#x20;

---

## 6) Posting POPs (mobile flow)

* **Location:** If precise location granted, attach rounded lat/lng; if denied, attempt coarse city via IP (server‑side logic). If neither, block submission with gentle guidance.&#x20;
* **Validation:** 1–1000 chars (UI enforces), illegal content/spam blocked server‑side.
* **After submit:** Immediately pin a **local ephemeral bubble**; wait for server confirmation (SSE or 201 response) to solidify. City collective should refresh within **< 10 s** (P95) and ancestors **< 30 s**.&#x20;

---

## 7) Region‑agent chat (mobile)

* **Entry:** Tap any aggregate bubble/card → opens *Region Chat* bottom‑sheet anchored to the current **weekly prompt**.
* **Behavior:** The agent’s tone mirrors the region’s personality; witty/blunt ok within platform policy. The conversation stays on‑topic (anchored to the weekly prompt). **Session:** 20 turns max, **30‑minute** idle timeout; upon limit, the agent ends politely and invites a new session.
* **Rate caps:** Server enforces per‑region session starts (e.g., 500/min); mobile surfaces “Region is cooling off, try again soon” if capped. (Also used during abuse spikes when server temporarily mutes chat.)&#x20;
* **Persistence:** Transcripts stored server‑side and **never public**; mobile may show the user their last session for convenience.&#x20;

---

## 8) i18n & translation UX

* **Display language:** default to device locale with **manual override** in settings.
* **Summaries & chat:** shown in display language; if translation fails, show original with a small **“auto‑translate unavailable”** banner. Supported locales: en, es, pt, fr, de, hi, ja, ko, zh‑CN/zh‑TW (UI strings and prompt copy).&#x20;

---

## 9) Telemetry & app‑to‑server analytics (mapped to backend metrics)

Emit the following app events and forward to POP’s metrics/analytics ingestion so ops dashboards reflect client health and engagement:

* **Map & bubbles:** `bubble_pin_rendered_*`, `bubble_pin_clicked_total`, `bubble_cluster_expand_total`, `bubble_rollup_transition_from_<level>_to_<level>`, `agent_state_rollup_visible_<level>`.&#x20;
* **Chat overlay:** `chat_overlay_served_total`, `overlay_open/close`, `probe_network_open`, `probe_node_selected`. &#x20;
* **SSE health (client):** connection open/close, reconnect attempts, jitter buckets; expose in user‑friendly badges and send counters upstream for correlation with server `sse_active_clients`.&#x20;

> Backend dashboards/alerts already define the metrics inventory and runbooks; client events help triangulate issues. &#x20;

---

## 10) Errors, resilience & states

* **Structured errors:** display friendly messages for `429` (show `retry_after`), `503` (partial results), and connectivity loss. Follow cache‑first then refresh on recover.&#x20;
* **Partial results:** if `partial_results:true`, show “Updating…” badge; allow the user to proceed with available data.&#x20;
* **Breaker/outage:** if server indicates degraded state, the app keeps read‑only flows working off cache; chat may be muted by region with the cooling‑off banner. (Server runbook governs recovery.)&#x20;

---

## 11) Security & privacy (client)

* **No PII in telemetry.** Do not log POP text or chat content client‑side; redact before crash reports.
* **Token storage:** Keychain/Keystore; never persist secrets in prefs.
* **Anonymity enforcement:** Never render user identity on pins or bubbles; lineage “Your contribution” uses the user’s own `pop_public_id` match (computed server‑side).&#x20;

---

## 12) Performance & SLO awareness (client)

* **UI budgets:** map overlay < 200 on‑screen nodes at once (virtualize/cluster beyond), transitions ≤ 240 ms, list diffing optimized.
* **Network budgets:** batch region queries; prefer **cached** reads; rely on SSE to avoid polling. Server SLOs: cached reads **≤ 500 ms**, city **< 10 s**, ancestor **< 30 s**, SSE **< 1 s**; client should degrade gracefully if exceeded (skeletons, badges).&#x20;

---

## 13) QA & test hooks (mobile)

* **Feature flags:** `semanticCongregationEnabled`, `realtimeAgentUpdatesEnabled`, `hierarchicalRollupEnabled` fetched at boot to align UI with server state.&#x20;
* **Integration smoke:** scripted flows *Submit → city update → SSE badge → chat open*, plus **multi‑client** SSE probe for ordering and replay.&#x20;
* **Load drills:** simulate 50 concurrent viewers switching zoom levels; verify overlay stability and SSE freshness badges while server counters (`agent_state_update_total`) rise.&#x20;
* **Accessibility:** SR copy for bubbles/cards, focus order by proximity, reduced‑motion verified.&#x20;

---

## 14) Deliverables for Codex (tickets)

1. **MOB‑01**: App shell, theming, localization (device locale + manual switch), secure storage.
2. **MOB‑02**: Auth module (Apple/Google), age gate, pre‑login read‑only routing.&#x20;
3. **MOB‑03**: **AgentStatesClient** (GET `/api/agent-states`), **LineageClient** (GET `/api/agent-lineage/:id`), **PromptClient** (GET `/v1/prompts/current`); models & DTOs (ignore stance/quotes).&#x20;
4. **MOB‑04**: SSE service for `agent_state_update` with region filters, reconnect/backoff, replay integration; bridge to cache.&#x20;
5. **MOB‑05**: Map screen with bubble overlay (individual, cluster, city/state/country), zoom thresholds, staged transitions, reduced‑motion fallback, clustering isolate.&#x20;
6. **MOB‑06**: Region Chat bottom‑sheet: prompt anchoring, session limits (20 turns/30‑min idle), rate‑cap banners, transcript persistence UX.&#x20;
7. **MOB‑07**: Lineage “Your contribution” badge using own POP match (privacy‑safe).&#x20;
8. **MOB‑08**: Telemetry pipeline → POP analytics endpoints (bubble, chat, probe, SSE health), with togglable sampling.&#x20;
9. **MOB‑09**: Error/empty states: partial results, offline, 429/503 handling; skeletons & badges.&#x20;
10. **MOB‑10**: Test harness & Playwright/Appium scripts aligning with server SSE/load probes; accessibility audits.&#x20;

---

## 15) Acceptance checklist (mobile)

* [ ] Only **collective summaries** rendered; no stance bars or quotes appear anywhere public.&#x20;
* [ ] Pre‑login read‑only map works; post/chat actions hard‑gate to SSO; **13+** enforced.&#x20;
* [ ] City update visible within **< 10 s P95**; ancestor within **< 30 s** after submit; SSE freshness badge reflects updates; cached reads feel instant.&#x20;
* [ ] Bubble overlay meets accessibility (focus order, SR labels, reduced‑motion).&#x20;
* [ ] “Auto‑translate unavailable” banner shows when translations fail; manual locale switch works.&#x20;
* [ ] Chat session limits and cooling‑off banners behave per policy; transcripts never public.&#x20;
* [ ] Telemetry flowing → dashboards (bubble/chat/probe/SSE events), enabling runbooks during incidents. &#x20;

---

### Notes on alignment & compatibility

* The client adheres to the **API proxy** and **SSE event** definitions and monitoring expectations already in the POP Edge spec. Where earlier assets include stance/quotes, the mobile adheres to the **collective‑only** directive and safely ignores those fields. &#x20;
* Bubble overlay behaviors and probe‑mode visuals mirror the updated product direction for the chat bubble overlay, adapted for Flutter.&#x20;
* SLOs, metrics, and runbooks referenced here match the Monitoring & Observability plan, MVP plan, and outage runbook used by server teams.   &#x20;

---
