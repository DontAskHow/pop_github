**Focused Document #12 — Production Deployment Blueprint & CI/CD (Single Region + CDN, Greenfield, Codex‑ready)**
*Goal:* Ship POP (Edge API + Mobile SPA) and the GPT‑5–powered **Semantic Engine** as a **commercial‑grade MVP** in one cloud region with CDN distribution. This blueprint defines infra topology, runtime knobs, CI/CD, observability wiring, health/readiness, blue‑green rollout, rollback, and operational guardrails aligned to the contracts, integration plan, monitoring, testing, and runbooks already defined.  &#x20;

---

## 0) Non‑negotiables & SLOs (what we must preserve in prod)

* **Topology:** Single cloud region for compute + database (**one** POP Edge service, **one** Semantic Engine), fronted by CDN for global reads. Real‑time over **SSE** only.&#x20;
* **Public surface:** Agent states are delivered via the **AgentState proxy** and **`agent_state_update`** SSE events; payloads support cache metadata and partial‑results flags on degradation.&#x20;
* **SLOs:** City refresh **P95 < 10 s**, ancestor refresh **P95 < 30 s**, cached reads **P95 < 500 ms**, real‑time delivery **< 1 s** end‑to‑end; probe with synthetic clients and metrics gates.&#x20;
* **Resilience path:** Circuit‑breaker around engine calls; cache + partial results if upstream is slow; breaker/runbook recovery must be rehearsal‑ready. &#x20;

---

## 1) Reference production architecture (single region)

**Core services (Dockerized):**

* **POP Edge API** (Node 20 + TS): public HTTP, SSE; rate limiting; cache; breaker; metrics at `/metrics` and JSON snapshot at `/api/metrics`.&#x20;
* **Semantic Engine (Congregator)** (Node 20 + TS): internal HTTP; embeddings + synthesis; lineage; metrics; optional pipeline sidecar.&#x20;

**Managed data (recommended MVP providers):**

* **PostgreSQL** (serverless/managed; connection‑pooled): used by POP; instrument pool gauges (`db_pool_*`).&#x20;
* **Redis** (managed): POP agent‑state cache, SSE backlog, rate limits; cache hit/miss/store gauges. *(POP dev uses in‑memory TTL; prod uses managed Redis to support multi‑replica Edge and durable SSE replay.)* &#x20;
* **Qdrant** (managed or self‑hosted) for vectors; **Neo4j** optional per OSS path; both used by engine when `MEMORY_BACKEND=oss`.&#x20;

**Edge & networking:**

* **CDN** in front of the SPA and cacheable GETs (e.g., agent states with short TTL). Do **not** CDN the SSE stream or POSTs. **WAF** on POP Edge.&#x20;
* **LB/Ingress** → POP Edge (2–3 replicas) → internal private network → Semantic Engine (2 replicas). SSE may use sticky routing **or** Redis‑backed replay to avoid stickiness.&#x20;

**ASCII layout**

```
[Users] ── HTTPS ──> [CDN/WAF] ──> [LB/Ingress] ──>  POP Edge (xN)  ──>  Semantic Engine (x2)
                                 |                  |  \             \ 
                                 |                  |   \             \─> Qdrant (managed)
                     Static SPA ─┘                  |    └─> Redis     ─> Postgres (managed)
                                                   SSE                 ─> (Neo4j optional)
```

**Why this shape?** Matches the **Integration Architecture** (POP ↔ Engine, SSE, cache, hierarchical rollups) and **Monitoring Plan** (Prom/JSON metrics, breaker/runbook). &#x20;

---

## 2) Runtime configuration (prod/stage)

**POP Edge (env examples)**

```
PORT=5000
NODE_ENV=production
# Upstream engine
CONGREGATOR_BASE_URL=https://engine.internal
CONGREGATOR_API_KEY=***
CONGREGATOR_TIMEOUT_MS=5000
# Feature flags
ENABLE_SEMANTIC_CONGREGATION=true
ENABLE_HIERARCHICAL_ROLLUP=true
ENABLE_REALTIME_AGENT_UPDATES=true
# Cache / rate limits
AGENT_STATE_CACHE_TTL_SEC=60
AGENT_STATE_RATE_LIMIT_WINDOW_SEC=60
AGENT_STATE_RATE_LIMIT_MAX=60
# Pooling / metrics
DB_MAX_CONNECTIONS=20
DB_IDLE_TIMEOUT_MS=30000
LOG_LEVEL=info
```

Flags, cache TTLs, breakers, and rate limits follow the **Implementation Checklist** and **Integration Architecture**. &#x20;

**Engine (env examples)**

```
PORT=8789
MEMORY_BACKEND=oss            # 'memory' for dev; 'oss' in prod
PROVIDER=openai               # 'noop' for tests, 'openai' in prod
OPENAI_API_KEY=***
OPENAI_MODEL=gpt-5-mini       # tuned during MVP per checklist notes
EMBEDDINGS_MODEL=text-embedding-3-large
OPENAI_TIMEOUT_MS=20000
OPENAI_MAX_RETRIES=2
STATE_TTL_SEC=60
ROLLUP_DEBOUNCE_MS_STATE=6000
ROLLUP_DEBOUNCE_MS_COUNTRY=9000
```

Matches engine guidance and rollup tuning used in probes. &#x20;

---

## 3) Health, readiness, and traffic management

* **Healthz/Readyz:** POP `/healthz`, Engine `/congregator/healthz`, pipeline `/healthz`. Gate deployments on 200 OK.&#x20;
* **Readiness gates:** refuse traffic until DB + Redis + upstream engine reachable and breaker state ≠ open. Expose **`congregator_breaker_state`** in `/metrics`.&#x20;
* **SSE specifics:**

  * Prefer **Redis‑backed backlog**; reconnects replay recent `agent_state_update` events; track `sse_active_clients`. &#x20;
  * If using sticky sessions, pin by cookie at LB and keep connection budgets visible in dashboards.

---

## 4) Caching & CDN policy

* **Server cache (authoritative):** POP keeps agent states in Redis **TTL ≈ 60 s**, exposes cache status in the AgentState response (`source`, `ttl_seconds`, `partial_results`). &#x20;
* **CDN cache (secondary):**

  * Cache **GET `/api/agent-states`** for 15–30 s keyed by the full `ids` query; respect **`Cache-Control: public, s-maxage=30, stale-while-revalidate=30`**; do **not** cache when `refresh=true`.&#x20;
  * **Never** cache `/api/events` (SSE) or POST routes.
* **Invalidation:** On **prompt publish/close**, POP invalidates Redis and (optionally) performs a forced fetch to warm cache; see Admin Ops.&#x20;

---

## 5) Observability wiring (Prometheus/Grafana ready)

* POP and Engine expose **Prometheus** at `/metrics` and JSON at `/api/metrics`. Scrape every 30–60 s; publish dashboards for **Ingestion Overview**, **AgentState Health**, and **Real‑time Delivery** using the **Metrics Inventory** (breaker, retry queue, cache hit/miss, rollup queue/latency, SSE clients, agent\_state\_update counts).&#x20;
* Add the **monitor CLI** (`npm run monitor:ops`) for lightweight alerting or bootstrap environments; wire `OPS_ALERT_WEBHOOK` to page on P0/P1 thresholds.&#x20;
* Link alerts/runbooks to **Congregator Breaker & Retry Queue Recovery** for one‑click remediation steps.&#x20;

**Prometheus scrape sample**

```yaml
scrape_configs:
  - job_name: pop-edge
    scrape_interval: 30s
    static_configs: [{ targets: ['pop-edge:5000'] }]
    metrics_path: /metrics
  - job_name: semantic-engine
    scrape_interval: 30s
    static_configs: [{ targets: ['engine:8789'] }]
    metrics_path: /metrics
```

Panel metric names match the Monitoring Plan (e.g., `congregator_breaker_state`, `agent_state_cache_hit`, `rollup_queue_size`).&#x20;

---

## 6) CI/CD pipeline (GitHub Actions reference)

**Pipeline stages** (blockers in **bold**):

1. **Build & static checks** — `npm ci`, typecheck, lint.
2. **Unit tests** — Vitest suites for client/server + breaker, cache, SSE manager. **Must pass.**&#x20;
3. **Integration stack up** — Bring up engine stack (Compose) + POP (test mode). Health‑wait on `/congregator/healthz` and POP `/healthz`. **Must pass.** &#x20;
4. **E2E & SSE probes** — Playwright + scripted SSE probe; verify `agent_state_update` ordering, backlog replay; city/ancestor SLO probes. **Must pass.**&#x20;
5. **Load micro‑burst** — Optional gate: 50 POPs @ 10–50 concurrency; assert dual‑write ≥ 0.98, breaker closed.&#x20;
6. **Security/size checks** — dep scan, image SBOM; fail on criticals.
7. **Package & push images** — Tag `pop-edge:<gitsha>`, `semantic-engine:<gitsha>`.
8. **Blue‑green deploy (staging)** — Helm upgrade with **new color** (e.g., `green`); readiness gates; smoke; flip staging traffic.
9. **Automated acceptance** — replay SLO probes + monitor snapshots; block on any P1 conditions (Monitoring Plan).&#x20;
10. **Blue‑green deploy (prod)** — same sequence; **30‑min watch** window; canary 10% traffic for Edge if LB supports it; then 100%.

> CI examples and docker‑compose test stack are already outlined in **Testing Strategy**; reuse endpoints and probes from that document.&#x20;

---

## 7) Kubernetes/HPA/Helm reference (vendor‑agnostic)

**Helm values highlights**

```yaml
pop-edge:
  replicas: 3
  image: ghcr.io/acme/pop-edge:{{ .Chart.AppVersion }}
  envFrom: [secretRef: pop-edge-secrets]
  resources: { requests: { cpu: "200m", memory: "256Mi" }, limits: { cpu: "1", memory: "512Mi" } }
  readinessProbe: { httpGet: { path: /healthz, port: 5000 }, initialDelaySeconds: 5, periodSeconds: 5 }
  livenessProbe:  { httpGet: { path: /healthz, port: 5000 }, initialDelaySeconds: 10, periodSeconds: 10 }

semantic-engine:
  replicas: 2
  image: ghcr.io/acme/semantic-engine:{{ .Chart.AppVersion }}
  envFrom: [secretRef: semantic-engine-secrets]
  resources: { requests: { cpu: "300m", memory: "512Mi" }, limits: { cpu: "2", memory: "1Gi" } }

redis:
  # managed external recommended; set REDIS_URL secret and disable chart if using cloud service
```

**Autoscaling (HPA)**

* POP Edge: scale on CPU (60%) and **requests/sec proxy metric** if available; watch **`sse_active_clients`** for capacity alarms.&#x20;
* Engine: scale on CPU + in‑flight synth count, capped to OpenAI budget; maintain queue depth under targets.

---

## 8) Release management, blue‑green, and rollback

**Blue‑green steps**

1. Deploy `green` with **feature flags OFF** for new paths.
2. Wait for readiness & metrics steady‑state; run SLO probes.&#x20;
3. Flip traffic to `green` via LB; watch **breaker, retry queue, cache hit rate**, **SSE client churn**.&#x20;
4. Enable features (`ENABLE_SEMANTIC_CONGREGATION`, `ENABLE_HIERARCHICAL_ROLLUP`) if disabled.&#x20;

**Rollback:**

* Flip traffic back to `blue`; or set `ENABLE_SEMANTIC_CONGREGATION=false` to degrade to legacy summaries; follow **Breaker & Retry Queue Recovery** if upstream instability triggered the rollback.&#x20;

---

## 9) Security, rate limits, and headers

* Enforce per‑route **rate limits** (e.g., `/api/agent-states` window/max) and propagate `X‑RateLimit-*` headers per **API Contracts**.&#x20;
* Require API‑key auth for Engine; POP Edge hides all secrets; structured error envelopes with `trace_id`.&#x20;
* TLS everywhere, HSTS at the CDN/WAF, strict CORS on public APIs; no cache for SSE.&#x20;

---

## 10) Data & schema management

* **DB migrations** run on deploy (POP) before traffic flip; gate on success. Integration plan calls for Postgres + Drizzle ORM; expose pool gauges. &#x20;
* Engine uses Qdrant collections per prompt and lineage tables per spec; warm indexes on boot (optional); health‑check vector store before readiness.&#x20;

---

## 11) Synthetic checks & SLO probes (pre/post‑deploy)

* **SSE probe:** N clients subscribe to `/api/events`, submit POPs, validate **monotonic `agent_state_update`** sequences and replay. Gate release on 0 gaps/dupes.&#x20;
* **Rollup probe:** Submit POP to city; measure **city <10 s** and **state/country <30 s** with configured debounce; fail release if breached.&#x20;
* **Cache probe:** Ensure cached **GET /api/agent-states** returns **<500 ms** P95; verify CDN/X‑Cache headers (if enabled).&#x20;

---

## 12) Admin & prompt ops in prod

* Staff‑only Admin API publishes the weekly prompt; publish triggers **cache invalidation** + optional warm‑up refresh; lineage is staff‑visible only. Ensure panels show freshness/SLOs post‑publish.&#x20;

---

## 13) Capacity planning (MVP sizing)

* Expect **100 POPs/min peak**, **50 active viewers**, **\~500 AgentState req/min** during bursts; size POP Edge to handle 500rps cached reads comfortably; engine autoscale for synth concurrency and budget. *(Numbers from Integration Architecture/MVP plan.)* &#x20;

---

## 14) Failure modes & incident playbooks

* **Engine outage or latency spike:** POP Edge breaker opens → serve cached data with `partial_results:true` → page on thresholds; follow **Breaker & Retry Queue Recovery**; verify queue drains on restore. &#x20;
* **Cache failures:** fall back to direct engine reads; raise `agent_state_cache_miss` alert if hit‑rate <70%.&#x20;
* **SSE churn:** investigate LB/Ingress, check `sse_active_clients` drop and backlog replay bounds.&#x20;

---

## 15) Deliverables for Codex (infra + CI artifacts)

1. **Helm charts** for `pop-edge`, `semantic-engine`, and a values profile for **dev/stage/prod**.
2. **Terraform/IaC** modules for: VPC/networking, LB/Ingress, DNS, CDN, managed Postgres, managed Redis (or service bindings).
3. **GitHub Actions** workflows: build/test; compose‑up integration; SSE/rollup probes; blue‑green to staging; manual approval; blue‑green to prod; rollback job.&#x20;
4. **Prometheus & Grafana**: scrape jobs + three dashboards wired to metric names from the **Monitoring Plan**; alert rules & `OPS_ALERT_WEBHOOK`.&#x20;
5. **Runbooks** embedded in the repo and linked from Grafana panels (breaker recovery, feature flags).&#x20;

---

## 16) Acceptance checklist (Deployment & CI/CD)

* [ ] Blue‑green deploys in **stage** and **prod** with **readiness gates** and **automated rollback**.
* [ ] Prometheus scrapes both services; Grafana dashboards show **breaker**, **retry queue**, **cache hit**, **rollup**, **SSE clients**, **agent\_state\_update** rates.&#x20;
* [ ] CI runs **SSE probe** & **rollup probe**; SLOs pass (city <10 s; ancestor <30 s; cache <500 ms). &#x20;
* [ ] CDN policy applied to `/api/agent-states` with 15–30 s s‑maxage; **no CDN** for SSE/POST.&#x20;
* [ ] Admin publish invalidates server cache and warms hot regions.&#x20;
* [ ] Runbook drill executed; **Breaker** closes and queue drains within minutes; monitor CLI returns zero status. &#x20;

---

