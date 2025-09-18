**Focused Document #10 — Security, Privacy & Data Policy (Greenfield, Commercial‑MVP, Codex‑ready)**
*This document defines POP’s end‑to‑end security, privacy, and data‑handling posture for the MVP. It encodes anonymity requirements, 13+ gating, indefinite retention, public surface restrictions (collective‑only outputs), service‑to‑service trust, incident handling, and observability hooks that already exist in the architecture and runbooks.* &#x20;

---

## 0) Scope, principles & non‑negotiables

* **Anonymous by design:** public surfaces never show user identifiers; only aggregated, **single collective summary** per region is returned/streamed to clients (no stance bars, no quotes). Public event type is **`agent_state_update`** with collective payload only.&#x20;
* **One POP per user per prompt;** indefinite retention of POPs, lineage, conversations; 24 h pin TTL is **visual only** (data persists). Pre‑login browsing of aggregates is allowed; posting/chat require auth; **13+ age gate**.&#x20;
* **Minimal moderation:** only illegal content (e.g., CSAM; credible threats/terrorism) and spam/automation are hard‑blocked; borderline content is allowed and blends into the collective. Region‑level chat can be **muted** temporarily on abuse spikes.&#x20;
* **Single‑region infra + CDN** for MVP; read‑heavy flows cached; graceful degradation via cache + breaker/runbooks during engine incidents. &#x20;

> **Note on older assets:** Any references in legacy UI specs to stance distributions or quotes are superseded by this policy’s **collective‑only** output on public surfaces. Internally, metrics and dev fixtures may still include richer shapes, but production APIs/SSE must not expose them. &#x20;

---

## 1) Data inventory & classification (what we store, where it can flow)

| Data object                | Examples / fields                                                                         | Classification                  | Handling rules                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Collective agent state** | `{region_id, prompt_id, collective_summary, x_meta.pop_count, weight_digest, updated_at}` | **Public**                      | May be cached, streamed, and displayed; must never contain PII or quotes.                                  |
| **Lineage weights**        | `{pop_public_id, weight_pct}`                                                             | **Public‑internal** (auditable) | Exposed via lineage API; `pop_public_id` is anonymized; no join path to `account_id` in public responses.  |
| **POP records**            | `text, canonical_en, region_id, lat/lng(rounded), prompt_id, pop_public_id, submitted_at` | **Sensitive**                   | Stored indefinitely; never exposed raw to clients; surfaced only through aggregate synthesis.              |
| **Conversations**          | `(session_id, region_id, prompt_id, messages[])`                                          | **Sensitive**                   | Retained indefinitely for analytics/abuse; never shared publicly; access‑controlled.                       |
| **Account identifiers**    | `account_id (UUID)`, social JWT claims (transient)                                        | **Highly sensitive**            | Stored minimally; never returned to clients; used only for “one POP per prompt” and abuse control.         |
| **Secrets & keys**         | `ENGINE_API_KEY, OPENAI_API_KEY, JWT_ISSUERS`                                             | **Highly sensitive**            | Kept in secret manager / env vault; rotated; never logged.                                                 |
| **Telemetry/metrics**      | gauges/counters (breaker state, cache hit, rollup latency, SSE clients)                   | **Operational**                 | Publicly inaccessible; used for dashboards/alerts; PII‑free by design.                                     |

---

## 2) Privacy requirements (UX & policy)

* **Consent & disclosures:** At submission, display **plain‑language notice**: “Anonymous & permanent contribution; no deletion/export in MVP; location stored at regional granularity.” Show the **13+** notice and require social sign‑in to post/chat.&#x20;
* **Locale & translation:** Default to device language with manual override; on translation failure, show original text with a small banner—do not hide content.&#x20;
* **Right‑to‑erasure (risk note):** Because MVP intentionally lacks self‑delete/export, restrict launch geographies and publish Terms that clearly state permanence; conduct legal review prior to GA. *(Product directive is to retain indefinitely; this is a flagged compliance risk to revisit post‑MVP.)*&#x20;

---

## 3) Public surface controls (what the app and API may expose)

* **Agent states:** Only `collective_summary` (+ pop\_count/digest meta). No stance bars, no quotes, no per‑user content. Same shape in **`GET /api/agent-states`** and **SSE `agent_state_update`**.&#x20;
* **Lineage API:** Return only `{pop_public_id, weight_pct}` per region/prompt; no user identifiers; suitable for internal analytics/visual tracing.&#x20;
* **Chat overlay:** Region agent chat must never reveal individual messages; it speaks as “we” and stays tethered to the weekly prompt.&#x20;

---

## 4) Authentication, authorization & session rules

* **End‑user auth:** Social login (Google, Facebook, X; **Sign in with Apple** on iOS). JWT verification at the edge; require auth for submit/chat; allow **read‑only pre‑login**. Enforce **one POP per prompt** server‑side.&#x20;
* **Service‑to‑service:** POP ↔ Engine over private network using API‑key auth with a **circuit breaker** and retries at POP edge.&#x20;
* **Rate limits:** POP submit per account; chat session caps (e.g., 500 init/min/region); SSE one concurrent per client; enforce via Redis/edge limiter; return structured 429 with `retry_after`.&#x20;

---

## 5) Content safety & abuse mitigation

* **Hard‑blocks only:** Illegal content (CSAM; explicit terror/credible violence threats) and **spam/automation** are blocked at ingest/chat. Borderline but legal content is allowed and flows into the aggregate.&#x20;
* **Regional “cool‑off”:** When automated blocks spike, **mute chat** for that region; show a subtle “cooling off” banner; auto‑unmute on normalization. Instrument with counters and alerts. &#x20;
* **Observation:** Use `dual_write_success_rate`, breaker state, retry queue, and cache hit gauges to detect upstream issues without over‑blocking.&#x20;

---

## 6) LLM‑specific safeguards (engine + chat)

* **Strict schemas:** Collective synthesis and chat operate in **JSON‑mode** with length bounds and content checks; engine rejects/reprompts on schema violations.&#x20;
* **Prompt‑injection resistance:** Treat user text as **data**, never as instructions; use fixed system/developer prompts anchoring to the weekly prompt and “collective voice” persona; strip URLs/emails/phones from prompts passed to the LLM.&#x20;
* **PII leak guard:** Scan outputs for emails/phones/handles before persistence or return; drop responses that include PII and retry with safer instructions. Quality plan includes PII checks in CI.&#x20;
* **Provider posture:** Access LLMs via server‑side calls only; API keys never land on devices; follow provider terms and disable data‑sharing features when available. *(Documented in engine env guidance.)*&#x20;

---

## 7) Network & data security controls

* **Transport security:** TLS 1.2+ everywhere; HSTS at edge; strict CORS for public APIs.
* **At‑rest encryption:** Managed encryption for Postgres/Redis; secrets in a vault; rotate keys quarterly and on incident.&#x20;
* **Edge hardening:** WAF in front of POP API; request size limits; structured error envelopes; IP rate limiting on public reads.&#x20;
* **Cache policy:** Redis holds collective agent states only (no raw POP text); TTL 60 s; no PII in keys/values; eviction monitored via `agent_state_cache_size`.&#x20;
* **SSE hygiene:** Region filters, per‑region sequence numbers, backlog replay with bounds; connection gauges/alerts on churn. &#x20;

---

## 8) Logging, telemetry & observability (privacy‑safe)

* **PII‑free logs:** Never log POP text or chat content; include `trace_id`, region and prompt IDs; errors increment `log_error_total`.&#x20;
* **Metrics (non‑exhaustive):** `dual_write_success_rate`, `congregator_breaker_state`, `congregator_retry_queue_size`, `agent_state_cache_hit/miss`, `rollup_queue_size`, `agent_state_update_total`, `sse_active_clients`. Dashboards and alerts are defined in the Monitoring Plan.&#x20;
* **Synthetic checks:** periodic POP submissions, SSE probes; alert on SLO breaches and breaker openings.&#x20;

---

## 9) Data retention, backup & recovery

* **Retention:** All POPs, aggregates, lineage, and chats kept indefinitely (product directive). Visual pins expire after 24 h but records persist.&#x20;
* **Backups:** Nightly DB backups with PITR; restore runbooks verified during chaos drills; cache is ephemeral.&#x20;
* **Disaster drills:** Validate breaker/runbook flow and retry queue drain post‑recovery.&#x20;

---

## 10) Incident response & runbooks

* **Detection:** Alerts on breaker open, retry queue growth, cache refresh failures, SSE client drops. Monitor script `npm run monitor:ops` can page via webhook.&#x20;
* **Response:** Follow **Congregator Breaker & Retry Queue Recovery**: verify engine health, restart stack if needed, ensure breaker closes and queues drain; optionally toggle feature flags to degrade gracefully.&#x20;
* **Post‑mortem:** Annotate dashboards, capture metrics snapshots, and update thresholds/runbooks.&#x20;

---

## 11) Compliance posture (MVP)

* **Age gating:** 13+ enforced in app; social SSO only.&#x20;
* **Jurisdictional caution:** Because self‑delete/export are intentionally absent, restrict distribution where required by law until post‑MVP privacy features are added; include explicit permanence/retention terms in ToS/Privacy Policy.&#x20;
* **Third‑party vendors:** Maintain DPAs with LLM/translation/maps providers; confine keys to server; keep vendor usage documented in Integration Architecture.&#x20;

---

## 12) Secure SDLC & supply‑chain

* **Dependency/secret scanning:** Enable SCA and secret scanning in CI; block releases on critical vulns; pin base images.
* **Tests as gates:** Evaluation plan runs PII lints, schema guards, and SLO probes before release; CI fails on violations.&#x20;
* **Feature‑flag kill switches:** `ENABLE_SEMANTIC_CONGREGATION`, `ENABLE_HIERARCHICAL_ROLLUP`; documented in runbooks for rapid mitigation. &#x20;

---

## 13) Configuration & enforcement (prod/stage)

**POP Edge**

* Enforce: JWT issuers; rate limits; cache TTL; SSE backlog bounds; breaker thresholds; metrics export. **No logs of content.** &#x20;

**Semantic Engine**

* Enforce: API‑key; JSON‑mode schemas; translation fallbacks; debounced rollups; output PII guard; no public endpoints.&#x20;

---

## 14) Acceptance checklist (Security/Privacy)

* [ ] Public API/SSE only emit **collective summary** + meta; no stance bars/quotes; lineage exposes **only** `{pop_public_id, weight_pct}`.&#x20;
* [ ] Social login + **13+** gate; read‑only pre‑login; one POP per prompt enforced.&#x20;
* [ ] Illegal/spam hard‑blocks active; regional chat mute triggers on automation spikes; alerts wired. &#x20;
* [ ] Breaker+retry queue runbook validated; cache fallback serves within SLO during outages.&#x20;
* [ ] Metrics dashboards live; `log_error_total` and SLO gauges visible; synthetic probes green.&#x20;
* [ ] Privacy copy in app clarifies permanence, anonymity, and locale behavior.&#x20;

---

### What this unlocks

Codex can now enforce privacy‑safe DTOs, instrument the correct metrics/alerts, and wire the breaker/runbook flow without ambiguity, delivering a **commercially viable** MVP that meets the product’s anonymity and performance goals. &#x20;

**Next focused document (#11): Admin & Prompt Operations (Greenfield)** — end‑to‑end workflow for issuing the weekly global prompt, admin roles/endpoints, moderation knobs (hard‑block lists), audit logs, and operational safeguards, aligned with the edge/engine contracts and monitoring plan. &#x20;
