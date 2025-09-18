**Focused Document #1 — POP (Social Sensing) MVP**
**Product Definition & Value Proposition** *(greenfield spec; commercial‑grade, Codex‑ready)*

---

### 1) One‑liner & Elevator Pitch

**POP** is a global, mobile‑first social sensing app where people post short, anonymous, location‑anchored thoughts (“POPs”) to a **single prompt of the week**. POP synthesizes these inputs into a **singular collective voice per region** (city → state/province → country). Users explore a live world map, see each region’s evolving “collective consciousness,” and **chat with any region’s agent**—translated automatically into their own language.

*Why it matters:* POP makes emergent public mood tangible and conversational—turning scattered, multilingual inputs into place‑based voices users can explore and talk to.

---

### 2) Core Value Proposition (User + Product)

* **For users (consumer social):**

  * Effortless *one‑tap expression* and *zero‑friction exploration* of what places “sound like” right now.
  * *Live conversation* with a place’s collective persona, not with individuals—no reputational risk, no dogpiles.
* **For product (platform):**

  * Simple weekly cadence encourages return visits.
  * Map‑native UI creates *viral, visual artifacts* (“what Tokyo sounds like this week”).
  * Translation + global map unlock *instant international reach*.

---

### 3) MVP Scope — What’s In vs. Out (crisp)

**In (MUST):**

* **Global weekly prompt**, manually issued by admins.
* **Auth:** Social login (Google, Facebook, X/Twitter). *On iOS, Sign in with Apple is required alongside any third‑party login.*
* **POP submission:** One POP per account per weekly prompt, up to **1000 chars**; location required (GPS or reliable city resolution via IP or manual place search).
* **Pins & roll‑ups:**

  * Individual POP **pin appears instantly** at submit location; **auto‑expires after 24h**.
  * Higher‑level aggregates (city/state/country) are **persisted for 7 days** or until the next prompt.
* **Aggregation output:** **One collective summary per region** (no stance charts, no quotes).
* **Chat:** Tap any region to **chat with its collective agent** (20‑turn cap per 30‑minute session, per user, per region).
* **Auto‑translation:** All POPs and chats normalized server‑side to a canonical language and displayed in the user’s locale; manual language override in Settings.
* **Anonymity:** No usernames or avatars are ever shown.
* **Retention:** Indefinite retention for POPs, aggregates, and chats (see §9).

**Out (NOT in MVP):**

* Any form of **stance distribution** or **individual quote highlighting**.
* Follows, profiles, DMs, or social graphs.
* B2B reporting, brand sentiment dashboards, ad units, or paywalls.
* Human‑in‑the‑loop moderation or review queues (see §10 for automated guardrails only).

> *Implementation note:* Real‑time delivery uses an SSE event pattern for aggregate updates (client subscribes; server pushes “state changed” messages). This is a standard, well‑understood approach for low‑latency UI refresh and is compatible with mobile clients via a thin gateway. &#x20;

---

### 4) Target Users & Primary Journeys

**Personas:**

* *Explorer:* opens the app to browse global/regional voices; no account required to read.
* *Contributor:* signs in and posts one POP per week.
* *Conversationalist:* chats with region agents to probe nuances.

**Critical journeys (acceptance bullets):**

1. **Read‑only exploration (pre‑login)**

   * Open app → world map loads with country/state/city agents visible by zoom.
   * Tap any region → see collective summary (in device locale) and “Start Chat” CTA (login‑gated).
   * **Perf:** cached aggregate loads **<500 ms P95**.
2. **Post a POP (login‑gated)**

   * Login via Google/Facebook/X (iOS also offers Apple Sign‑In).
   * Grant location (or allow city via IP/manual search).
   * Compose (**≤1000 chars**), submit → **pin appears instantly** at location.
   * **Perf:** submission acknowledged **<1 s P95**; city aggregate reflects the change **<10 s P95**.
3. **Chat with a region**

   * From any region card, start chat → live, streaming responses that **anchor to the week’s prompt** and reflect that region’s style (playful, witty, truthful within safety bounds).
   * **Limits:** 20 turns/session; idle timeout 30 minutes; region‑wide initiation limit \~**500 new sessions/min** with graceful soft‑fail UI.
   * **Perf:** cached prompt/aggregate fetch **<500 ms P95**; end‑to‑end message **<2 s P95** typical, **<1 s** for SSE state updates.

Real‑time patterns (SSE naming/shape will be finalized in the API spec; concept mirrors a push update such as `agent_state_update`).&#x20;

---

### 5) Product Rules (from your decisions; normalized for build)

1. **Prompt of the week:** Globally uniform semantics; localized copy OK. Authored by admin/product.
2. **POP quota:** One POP per account per prompt.

   * **Edit window:** Allowed until the weekly window closes.
   * **Delete policy:** *To reconcile “indefinite retention” with editability*, deletion is allowed **only within a short “undo” window (15 minutes)** post‑submit. After that, content is retained indefinitely and may be moved to colder storage per §9.
3. **Location policy:**

   * If GPS granted → pin + city aggregate.
   * If GPS denied → accept only when city can be resolved via **IP** *or* user **manual search**; else block submission.
   * No identity is shown on pins or aggregates.
4. **Aggregation semantics:**

   * Output is a **single collective summary** string per region (50–1200 chars).
   * **No** stance breakdowns and **no** quotes.
   * Regions recompute on new inputs (direct region immediate; ancestors debounced).
5. **Chat policy:**

   * Voice: playful, lively, truthfully mirrors the region’s tone (sarcastic/blunt/irreverent if that’s what the data says), but **never violates safety or law**.
   * Always anchor answers to the week’s prompt; riff is allowed.
   * 20‑turn cap/session; transcripts stored to the account for internal analytics/abuse response (never public).
6. **Translation:**

   * Server canonicalization: store **original text + detected language + canonical English**; display in device locale with manual override.
   * Guarantee high‑quality translation coverage for **en, es, pt, fr, de, hi, ja, ko, zh (CN & TW)**. Fallback shows the original with a banner if translation fails.

---

### 6) SLOs & Performance Targets (MVP)

* **City aggregate P95:** **<10 s** from POP submission to visible region update.
* **Ancestor (state/country) P95:** **<30 s**.
* **Any cached aggregate/chat fetch:** **<500 ms** P95.
* **SSE end‑to‑end:** **<1 s** P95 for update delivery.
* **Availability:** aim **≥99.9%** during MVP period with graceful degradation and cache fallbacks. &#x20;

> *Design note:* We’ll implement hierarchical roll‑up with debounced ancestor recomputation and push updates via an SSE event pipeline; these patterns pair cleanly with server‑side caching and client invalidation. &#x20;

---

### 7) Success Metrics (first 30/60/90 days)

* **Acquisition & exposure:**

  * % of sessions with successful pre‑login map exploration (target ≥80%).
  * Viral sharing of region views (tracked via deep links/screenshot share events).
* **Activation:**

  * % of logged‑in users who post at least one POP in their first week (target ≥25%).
  * % of users who start at least one regional chat (target ≥30%).
* **Engagement:**

  * Median session time ≥ 3 minutes; average chat turns/session ≥ 6.
  * Return rate (7‑day) ≥ 20%.
* **Quality & perf:**

  * SLO adherence ≥ 95% across the four targets in §6.
  * Translation failure rate < 0.5%.
  * Automated‑block false‑positive rate < 1% (audit via spot checks).
* **Operational:**

  * Alert‑free time (no P1/P0) over first week post‑launch.
  * Healthy cache hit‑rate (≥70%) and stable SSE client counts on dashboards.&#x20;

---

### 8) Feature Acceptance Criteria (Codex‑ready, testable)

**A. Read‑only exploration**

* Opening the app (cold start) shows a map and region aggregates without login.
* Tapping any region loads its current **collective summary** (no stance/quotes) and last‑updated indicator.
* **Pass if** P95 fetch from cache **<500 ms**; UI clearly renders region level (city/state/country) and prompt title.

**B. Submit a POP**

* Successful social login (Google/Facebook/X; iOS also offers Apple).
* On submit, **pin appears** at coordinates; **expires automatically at 24h**.
* **Pass if** city aggregate updates **<10 s P95** and SSE update is received by clients **<1 s P95**.

**C. Aggregation behavior**

* New POP in a city **immediately** recomputes city; **ancestors recompute in ≤30 s**.
* No stance/quote fields exist in client payloads.
* **Pass if** ancestor recomputation times measured via synthetic probes meet the SLO.

**D. Chat with region agent**

* 20‑turn cap, session timeout 30 min inactivity, hard per‑region initiation cap **500 sessions/min**.
* Answers reference the week’s prompt; style follows region tone; translation is correct or falls back with a banner.
* **Pass if** message latency P95 ≤2 s (streaming start ≤1 s typical) and transcripts persist to the account.

**E. Anonymity & identity**

* No public user identifiers are rendered in any UI.
* Stable internal account ID linked to POPs/chats is stored for abuse control; never exposed.

**F. Translation UX**

* Default to device locale; allow manual switch in Settings.
* If translation fails, original text displays with “Auto‑translate unavailable” banner.

**G. Visual lifecycle**

* Individual pins animate “inflate” on creation and “pop” on expiry (24h).
* Roll‑ups persist the entire week and refresh only upon new prompt or when there are no individual POPs remaining in scope.

> The transport/event pattern and app‑level monitoring used to verify the above are standard and will be codified in the API + monitoring docs (SSE update event, metrics, alert thresholds). &#x20;

---

### 9) Data, Retention, & Visual Tracing (policy you specified)

* **Indefinite retention** for POPs, aggregates, and chat transcripts.
* **Contribution weights (for future “visual tracing”):**

  * The engine computes a per‑POP **weight (%)** toward each region’s weekly collective summary.
  * The API **does not** expose user identity; it may expose *anonymized per‑POP IDs + weight samples* (e.g., top‑K contributions + histogram) to support future tracing visualizations.
  * Weights are normalized within *(region, prompt)*; metadata also includes `pop_count`.
* **Cold storage:** Data may transition to colder storage after **365 days** (performance/cost), without changing the “indefinite” retention policy.
* **User controls:** Edit allowed until weekly window closes; **cancel/undo (delete) allowed within 15 minutes** of submit; after that, submissions persist.
* **Location data:** Store coarse region IDs + rounded coordinates permanently; never render identity publicly.

> We will formalize these fields in the **API & Data Contracts** document (e.g., `CollectiveAgentState` + `x_meta` with contribution weight summaries).&#x20;

---

### 10) Safety, Moderation, & Store Compliance

* **Hard blocks only** (baseline): CSAM/child endangerment, credible criminal/terror threats, and platform‑destabilizing spam/automation.
* **Borderline content** (lawful but distasteful/offensive): allowed to appear and to influence the collective voice; no warnings or down‑ranking.
* **Dynamic safeguards:**

  * If automated block rate surges in a region, **mute new chat sessions** for that region temporarily; surface a gentle “cooling off” banner.
  * **Feature flag “Strict Mode”** that tightens filters if stores/platforms require it (toggleable without redeploy).
* **Identity & privacy:** No public identifiers; transcripts stored for internal abuse response.
* **App store note:** iOS requires **Sign in with Apple** if any third‑party login is offered; plan for it alongside Google/Facebook/X to avoid review rejection.
* **Ops playbooks + monitoring:** baseline metrics & alerting around real‑time delivery, roll‑up latency, breaker/queue health and cache hit‑rates will be included (ops docs). &#x20;

---

### 11) i18n & Localization (MVP policy)

* **Canonicalization:** store original + canonical English; display in user locale.
* **Supported locales (guaranteed quality):** **en, es, pt, fr, de, hi, ja, ko, zh‑CN, zh‑TW**.
* **Fallback:** original text with “auto‑translate unavailable” banner if translation fails.
* **Prompt copy‑localization:** translate the global prompt string for display without changing semantics.

---

### 12) Visual Language & Map UX (high‑level)

* **Map:** Google Maps SDK (Flutter), zoom‑aware roll‑ups (individual → city → state → country).
* **Pins:** “Mini chat bubbles” inflate on arrival and pop on expiry; roll‑ups animate staged fades/fans with reduced‑motion fallbacks and accessible focus states.
* **Probe mode:** out of scope for MVP chat; optional read‑only network may ship if time permits.
* **Accessibility:** focusable bubbles, aria labels (“Open chat for {region}”), high contrast text.

> The chat‑bubble overlay and zoom‑aware roll‑ups follow a consistent treatment aligned with a map overlay pattern; specifics for animations and thresholds are captured in the UI spec.&#x20;

---

### 13) Technical Posture (summary; full stack in Doc #2)

* **Client:** **Flutter** (iOS/Android), Google Maps SDK, native SSO (Google/Facebook/X/**Apple on iOS**), SSE client for real‑time updates.
* **Server (high‑level):** REST + SSE; region aggregates cached; debounced hierarchical roll‑ups; translation + LLM synthesis pipeline; metrics/alerts.
* **Real‑time:** SSE event for region aggregate changes; region‑scoped subscriptions; backlog replay on reconnect. &#x20;

---

### 14) Risks & Mitigations

* **Store compliance risk** with minimal moderation → ship a **strict‑mode** flag and Apple Sign‑In; log and tune automated filters.
* **Global legal variance** vs. indefinite retention/no deletion → ship geo‑based policy gates (e.g., disable sign‑ups in jurisdictions that legally require RTBF until policy changes).
* **Translation costs/latency** → hybrid MT (Google/DeepL/Microsoft) + LLM‑polish **only** for high‑impact outputs (chat/collectives).
* **Real‑time scaling (SSE)** → region filters + backlog caps + connection gauges + roll‑up debouncing with SLO dashboards.&#x20;

---

### 15) Glossary (implementation‑relevant)

* **POP:** a single user submission (≤1000 chars) to the weekly prompt; carries original text + detected language + coarse location + canonicalized text.
* **Region/Level:** city, state/province/prefecture, country; more granular levels (ZIP/neighborhood) are future.
* **Collective Agent (region):** the AI persona for a region/prompt; its **collective summary** is the only aggregate text exposed.
* **Contribution Weight (%):** normalized influence of a POP in a region’s weekly summary; exposed only as anonymized metadata for future tracing.
* **Prompt of the Week:** globally uniform semantics, admin‑authored; copy localized for display.

---
