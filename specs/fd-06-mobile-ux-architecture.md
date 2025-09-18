**Focused Document #6 — Mobile (Flutter) UX & Client Architecture (Greenfield, Codex‑ready)**
*Scope:* This document specifies the iOS/Android app for **POP**: user journeys, UI contracts, accessibility, client‑side state & networking, SSE real‑time updates, auth, i18n, metrics, and error handling. It aligns the mobile experience with the **collective‑only** output model (no stance bars, no quotes) and the **GPT‑5 semantic congregator** contracts defined earlier. &#x20;

---

## 0) Product guardrails the app must enforce

* **Pre‑login read‑only:** Users can explore the map and read collective regional summaries before logging in; posting/chatting require sign‑in. Age gate **13+** on first run.&#x20;
* **One POP per account per weekly prompt** (≤1000 chars). The app prevents duplicate submissions for the active `prompt_id`. Edits allowed until the prompt window closes; **no user deletion UI** (indefinite retention mandate).
* **Collective‑only UI:** Show a **single collective summary** per region (city → state → country). **Do not render stance distributions, quotes, or per‑user identifiers** anywhere. (This supersedes legacy bubble visuals with stance/quotes.) &#x20;
* **Pins & rollups:** Individual POP pins (if GPS granted) persist **24h** on the map; region rollups persist for the prompt’s week.&#x20;
* **Chat with region agent:** Conversational overlay with the region’s **collective voice**; 20 turns/session, 30‑minute idle timeout, per‑region session initiation caps.&#x20;
* **Translation:** UI follows device locale by default with manual override. If translation fails, show original text with a small “auto‑translate unavailable” banner.
* **Safety/abuse:** Only hard‑block illegal content and spam automation. If automated blocks spike, **mute chat** for that region and show a subtle “cooling‑off” banner.&#x20;

**Performance SLOs (user‑perceived):**

* City collective visible after submission **P95 < 10s**, ancestor **< 30s**; cached agent‑state reads **< 500ms**; SSE **< 1s** end‑to‑end. The mobile app must surface freshness states and avoid blocking UI when the backend degrades (serve cached state + banners). &#x20;

---

## 1) App architecture (Flutter)

**Recommended stack:**

* **Flutter** (Dart 3), **google\_maps\_flutter**, **flutter\_riverpod** (state), **dio** (HTTP), **eventsource** (SSE), **flutter\_secure\_storage** (tokens), **intl & flutter\_localizations** (i18n), **package\_info\_plus** (diagnostics).
* **Modular layers:**

  * `core/` (env, logging, error envelopes, localization)
  * `data/` (REST clients, SSE client, DTO ↔ domain mappers, caches)
  * `domain/` (entities: `CollectiveAgentState`, `LineageDigest`, `Prompt`, `RegionId`)
  * `features/`

    * `onboarding/` (age gate, permissions, SSO)
    * `map/` (MapContainer, ChatBubbleOverlay, bubble hierarchy)
    * `submission/` (POP composer)
    * `agent_chat/` (NodeChatOverlay, chat sessions)
    * `settings/` (language override, privacy, diagnostics)

**State management (Riverpod):**

* **Providers:** `authProvider`, `promptProvider`, `mapViewportProvider`, `agentStatesProvider(ids)`, `sseConnectionProvider`, `chatSessionProvider(regionId)`, `translationProvider`.
* **Caching:** in‑memory LRU for `CollectiveAgentState` keyed by `(region_id, prompt_id)` with TTL aligned to server hints; hydrated from disk only for “last viewed” screen to improve cold start.

**Networking & resilience:**

* **REST:** POP API proxies (`/v1/pops`, `/v1/agent-states`, `/v1/agent-conversation/:regionId`, `/v1/events`). Standard error envelopes with `retry_after` & `trace_id`.&#x20;
* **SSE:** Subscribe to **`agent_state_update`**; filter by `?regions=` on connect; coalesce bursts and apply sequence guards. Resume with backlog replay on reconnect. &#x20;
* **Circuit‑breaker awareness:** When POP backend enters degraded mode (breaker open), rely on cached agent‑states, pause chat auto‑prefetch, and show a “Using cached data” badge.&#x20;

---

## 2) Key user journeys

### 2.1 Onboarding & auth

1. **First launch:**

   * Age gate **13+** → Location permission sheet → Device locale confirmed with option to change in **Settings**.
   * Pre‑login, user can pan/zoom the map and read collective summaries. Posting and chat are CTA‑gated to sign‑in (Google, Facebook, X; **Sign in with Apple** on iOS).&#x20;
2. **Auth success:** Store token in secure storage; refresh profile; show active `prompt_id`.

### 2.2 Submit a POP

* Composer enforces ≤1000 chars, shows prompt text, and indicates that submissions are **anonymous** and immutable (no delete) after the edit window closes.
* If GPS denied, submission proceeds; server resolves to city from IP; client shows a generic “(city)” placement and explains privacy.
* On submit, app optimistically drops a **mini chat bubble** pin (24h TTL) and awaits SSE to confirm refresh across city/state/country. **No user identifiers** appear on the pin.&#x20;

### 2.3 Explore & read collectives

* **Map (default scene):** Google Maps with **ChatBubbleOverlay**. Zoom thresholds switch variants with **staged** transitions (fade/scale); the visible card content is **only** the collective summary + freshness cues (no stance, no quotes).&#x20;
* **Prefetch:** on pan/zoom, compute the active region chain and fetch `/v1/agent-states?ids=...`, hydrated from cache <500ms, then background refresh.&#x20;

### 2.4 Chat with a region

* Tapping any region bubble opens **NodeChatOverlay** for that region. The agent’s tone mirrors the region’s collective personality, **anchored to the week’s prompt**. 20 turns/session, 30‑minute inactivity timeout; session limit & region cap errors render inline notices.&#x20;
* **Translation:** user messages auto‑translated; failure shows original with a banner. Transcripts persist server‑side only; never public.

### 2.5 Probe mode (visual exploration)

* The overlay “Probe” button toggles a **synaptic graph** visualization (non‑map, full‑screen), keyboard‑navigable nodes, and clear exit affordances. **Content is still collective;** no individual quotes or identities are shown. (This updates the probe concept to the collective‑only policy.)&#x20;

---

## 3) UI system & components

> The legacy chat‑bubble spec referenced stance bars and quotes; the **collective‑only** model removes them. Use the same shell, motion, and accessibility rules—but **replace content** with collective summary + freshness + meta chips (pop count).&#x20;

### 3.1 Bubble variants (zoom‑aware)

| Variant                |   Zoom | Data                   | Visuals (collective‑only)                                                              | Interaction                                       |
| ---------------------- | -----: | ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Individual POP pin** |   ≥ 14 | pin (24h TTL)          | 64×48 speech bubble (POP yellow, 2px black outline, tail). **No quote, no user info.** | Tap opens overlay scoped to **city** agent.       |
| **Cluster**            | 12–<14 | client H3 clusters     | Stacked mini bubbles with **count** only.                                              | Tap zooms in or opens overlay set to city scope.  |
| **City**               | 10–<12 | `CollectiveAgentState` | 200px glass card; **summary text**, “Updated Xm ago,” **pop count chip**.              | Tap opens overlay (city).                         |
| **State/Region**       |  7–<10 | `CollectiveAgentState` | 220×120 panel; **summary text**; meta chips.                                           | Tap opens overlay (state).                        |
| **Country**            |    < 7 | `CollectiveAgentState` | 260px anchor card; **summary text**; meta chips.                                       | Tap opens overlay (country).                      |

* **Motion:** 180–240 ms scale+fade with 50 ms stagger; obey **reduced motion**.
* **Accessibility:** focus rings, readable labels (“Open {region} collective”), high contrast against POP yellow; SR‑only metadata for update times.&#x20;

### 3.2 NodeChatOverlay

* **Header:** Region name, breadcrumb (City → State → Country), “Updated {relative time}”, **pop count**.
* **Body:** **Collective summary** (50–1200 chars). Optional **weight digest chips** when present (e.g., “Top POPs have evenly spread influence”).
* **Footer:** Chat composer; language switcher (display‑only); **Probe** toggle.
* **Empty/error:** Cache fallback and retry; banner if using stale data (breaker open). &#x20;

### 3.3 Settings

* Language override; privacy note (“Anonymous by design; contributions are permanent”); log out.

---

## 4) Data contracts (client)

* **Read:** `GET /v1/agent-states?ids=...` → `CollectiveAgentState[]` with `metadata.{cached_at,ttl_seconds,source,partial_results}`; SSE **`agent_state_update`** payload mirrors the same type.&#x20;
* **Write:** `POST /v1/pops` (auth required). **One per prompt** enforced server‑side; client also gates UI.
* **Chat:** `POST /v1/agent-conversation/:regionId` with `{prompt_id, messages, locale}`; server applies turn/idle limits.&#x20;

**Error envelopes:**
`{ error, message, retry_after?, trace_id }` (429/503 honored with progressive backoff; show friendly banners, never block map).&#x20;

---

## 5) SSE client behavior (Flutter)

* **Connect:** `EventSource('/v1/events?regions=${encodeURIComponent(chain.join(','))}')`.
* **Handle `agent_state_update`:**

  * Parse JSON; verify `region_id ∈ subscribed`; check server sequence; drop duplicates/out‑of‑order.
  * Update `agentStatesProvider` cache; trigger per‑region “New activity” pulse for 2–3 seconds.
* **Reconnect:** exponential backoff (± jitter), **backlog replay** support; halt reconnects when app backgrounded; resume on foreground.
* **Telemetry:** record SSE state changes; show small indicator in overlay header. &#x20;

---

## 6) Internationalization & translation

* **UI locales:** en, es, pt, fr, de, hi, ja, ko, zh‑CN, zh‑TW.
* **ARB files** for UI strings; regional display names from server.
* **Display language:** default to device; allow manual override in Settings.
* **Failures:** When auto‑translate fails for chat or collective, render original plus “auto‑translate unavailable” banner and a “Try again” action. (Do not hide content.)
* **Input:** POPs are submitted in user language; the engine canonicalizes for synthesis.&#x20;

---

## 7) Privacy, safety & compliance in UI

* **Anonymity:** No usernames/avatars anywhere—even for the owner. No profile surfaces on map pins or chats.
* **Retention notice:** Submission sheet includes concise disclosure: “By posting, you contribute anonymously and permanently to the collective voice.”
* **Hard‑block flows:** If submission fails due to hard‑block (illegal content/spam), show a neutral inline message; no shadowbans.
* **Regional mute:** If chat muted server‑side, overlay shows a subtle “Cooling off” banner with auto‑dismiss once restored.&#x20;

---

## 8) Performance budgets (client)

* Cold start to interactive map **≤ 2.5s** on mid‑tier devices.
* Agent‑states list render **≤ 16ms** average frame; no jank on bubble transitions (respect reduced motion).
* REST timeouts: 10s; UI shows skeletons not spinners; background refresh seldom blocks interaction.
* Cache for visible regions yields **<500 ms** perceived read for summaries (hit).&#x20;

---

## 9) Telemetry & analytics (client → backend metrics)

Emit compact events; backend aggregates into Prometheus/Grafana panels:

* **Map render & interactions:**
  `bubble_pin_rendered_*`, `bubble_pin_clicked_total`, `bubble_rollup_transition_from_<level>_to_<level>`, `agent_state_rollup_visible_<level>`.&#x20;
* **Overlay & chat:**
  `chat_overlay_served_total`, `overlay_open/close`, `probe_network_open/exit/select`, chat send events.&#x20;
* **SSE health (client‑reported):** connection open/close, reconnect attempts (joined to server metrics).
* **Error hooks:** report structured `error_code` with sample `trace_id` from server responses.

(Names align to the monitoring plan to support dashboards & alerting.)&#x20;

---

## 10) Accessibility checklist (mobile)

* **Screen readers:** meaningful `Semantics` labels on all bubbles and actionable nodes (“Open {region} collective chat”). Provide SR text for “Updated {relative time}”.
* **Focus order:** logical traversal; overlay acts as a focus‑trapped dialog (Esc/back dismiss).
* **Contrast:** POP yellow cards meet WCAG AA with black text; glass surfaces tested in high‑contrast mode.
* **Motion:** obey system “reduce motion”; switch transitions to opacity‑only.
* **Touch targets:** ≥44×44 pt; left‑hand reach compliance for major actions.&#x20;

---

## 11) Test plan hooks (mobile)

* **Widget tests:** bubble variants render; thresholds and staged transitions; stale/cached banners.
* **Integration (Playwright/Appium or Flutter Integration Test):**

  * Submit POP → see city update <10s; SSE event observed; ancestor <30s.
  * Region mute banner on simulated abuse spike; auto‑clear.
  * Locale switching and translation fallback banners.
  * Offline mode: serve cached agent‑states; resume on reconnect.
* **SSE probe harness:** run script to connect N clients and validate ordering, gapless replay, and UI freshness indicators.&#x20;

---

## 12) Implementation blueprint (tickets Codex can generate)

**MOB‑A1 — Project scaffolding & env**

* Set up packages, feature modules, Riverpod providers, theming, localization ARB, secure storage, env loader.

**MOB‑A2 — Auth & gating**

* Google/Facebook/X and **Sign in with Apple (iOS)** flows; age gate; pre‑login read‑only map; gate submit/chat CTAs.&#x20;

**MOB‑M1 — MapContainer + ChatBubbleOverlay (collective‑only)**

* Implement bubble hierarchy (zoom thresholds, staged animation, reduced‑motion fallback), cluster renderer, and **collective summary** cards. Remove stance bars/quotes from legacy visuals; add **pop count** & freshness chips.&#x20;

**MOB‑M2 — Agent states data layer**

* REST client for `/v1/agent-states`; LRU TTL cache; SSE client with region filters, sequence check, backlog replay; integrate with providers.&#x20;

**MOB‑S1 — POP submission**

* Composer, 1000‑char limit, anonymous notice, GPS permission & fallback; optimistic mini bubble with 24h TTL; edit‑until‑close (no delete UI).

**MOB‑C1 — NodeChatOverlay (collective agent)**

* Chat UX with session cap (20 turns), idle timeout (30 min), translation banners; subtle region‑mute banner; transcript persisted server‑side.&#x20;

**MOB‑I1 — Instrumentation**

* Emit map/overlay/chat events matched to backend metric names; SSE client health signals.&#x20;

**MOB‑R1 — Resilience polish**

* Cache‑first rendering; stale warning; breaker‑aware banners; offline mode; retry/backoff policies.&#x20;

**MOB‑T1 — Test suites & probes**

* Widget tests for overlays and transitions; integration flows; automated SSE probe; localization checks; accessibility assertions.&#x20;

---

## 13) Acceptance criteria (mobile)

* **Explore without login:** Can pan/zoom and open overlays; cached reads **<500 ms** P95.&#x20;
* **Submit POP → city update <10s; SSE <1s**; ancestor <30s. (Record a screen + metrics snapshot.)&#x20;
* **Collective‑only visuals:** No quotes, no stance bars, no user IDs; bubbles and overlays display **summary + freshness + pop count** only.&#x20;
* **Chat limits enforced:** 20 turns/session, 30‑min idle, per‑region initiation caps respected; translation banners on failure.&#x20;
* **A11y:** Focusable bubbles, SR copy, reduced‑motion compliance, contrast checks passed.
* **Resilience:** When engine degraded, app shows cached summaries with banners; resumes automatically; no blocking spinners.&#x20;

---

## 14) Notes on alignment with backend & ops

* Event type **`agent_state_update`**, proxy routes, and error envelopes match the POP API contract so the app can rely on a stable DTO shape for `CollectiveAgentState`.&#x20;
* The overlay’s freshness & metrics map to the **Monitoring Plan** (SSE clients, cache hits, rollup latencies), enabling end‑to‑end SLO verification from the handset.&#x20;
* Degradation UX mirrors the **Congregator Outage Runbook** expectations (serve cache, show subtle banners, auto‑recover).&#x20;
* The build plan, roll‑up goals, and app‑store readiness gates track the **MVP Development Plan** milestones.&#x20;

---
