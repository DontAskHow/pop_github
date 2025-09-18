# Implementation Plan: POP MVP

**Branch**: `001-pop-mvp` | **Date**: 2025-09-18 | **Spec**: specs/001-pop-mvp/spec.md  
**Input**: Feature specification synthesized from `specs/000-pop/docs`

## Summary
POP MVP delivers a global, anonymous social sensing experience built on a weekly prompt. Anonymous POP submissions roll into a single collective summary per region, cached and streamed to clients through the `agent_state_update` SSE channel. A dedicated Semantic Congregator service handles ingestion, canonicalization, weighting, and synthesis while the POP API proxies public access and the Flutter client renders a map-first UI with built-in translation and chat limits. This plan outlines the architecture, acceptance gates, and execution phases needed to launch the foundations milestone and prepare subsequent increments.

## Technical Context
**Languages**: TypeScript 5.x (Node.js 22) for POP API & Semantic Congregator; Dart 3.x (Flutter) for mobile.  
**Primary Dependencies**: Fastify + @fastify/sse-v2, BullMQ, Prisma, Postgres (Neon), Redis (Upstash), Qdrant, OpenAI GPT-5 (JSON mode), Flutter Riverpod, Dio, google_maps_flutter, eventsource, intl.  
**Storage**: Postgres for prompts, POPs, collectives, lineage, conversations; Redis for cache/session/rate limits; Qdrant for embeddings per `(prompt_id, region_id)`; object storage optional for exports.  
**Testing & Tooling**: Vitest, Supertest, k6 probes, Playwright contract checks, Dart/Flutter test + golden tests, GitHub Actions CI, Prometheus/Grafana metrics.  
**Target Platforms**: Cloud Run/Fly.io containers for services; mobile apps for iOS/Android (Sign in with Apple required on iOS).  
**Performance Goals**: City update P95 <10 s; ancestor update P95 <30 s; cached agent-state read P95 <500 ms; SSE `agent_state_update` end-to-end <1 s; chat streaming start ≈1–2 s; mobile cold start ≤2.5 s.  
**Constraints**: All public payloads remain collective-only (no stance/quotes); anonymity preserved; automated hard-blocks only; chat capped at 20 turns/30 mins and ≤500 new sessions/min per region; translation available for en/es/pt/fr/de/hi/ja/ko/zh-CN/zh-TW with fallback banner on failure.

## Constitution Check
- Collective outputs expose only `collective_summary` strings and aggregate metadata—no stance or quotes fields.
- SSE event type `agent_state_update` must remain the canonical real-time interface and include `region_id`, `collective_summary`, and metadata.
- SLO probes for city, ancestor, cached read, and SSE latency must run in CI and pre-launch.
- iOS login surfaces must include Sign in with Apple whenever third-party auth is offered.
- Only automated hard-block moderation is permitted; no manual review queues introduced.
- Secrets (GH_TOKEN, provider keys, GPT-5 credentials) kept in env/secret stores; never logged or committed.
- Region anonymity enforced across map pins, chat transcripts, lineage, and metrics.

## Architectural Pillars
1. **Semantic Congregator (Engine)** — Fastify/Hono service with POP ingestion (`/engine/pops:batch`), canonicalization, contribution weighting, GPT-5 synthesis, lineage storage, chat endpoint, debounced ancestor rollups, Prometheus metrics, and Redis-backed SSE notifiers.
2. **POP API (Edge)** — Public Fastify service handling auth, request validation, caching, and SSE fan-out (`GET /v1/events` emitting `agent_state_update`). Proxies engine endpoints, enforces rate limits, publishes metrics, and manages partial responses during degradation.
3. **Mobile App (Flutter)** — Map UI with zoom-based rollups, POP composer, chat overlay, translation controls, offline-friendly caching, SSE client integration, and Sign in with Apple on iOS. No stance/quote UI elements are rendered.
4. **Observability & Ops** — Prometheus, Grafana dashboards, latency probes (k6 scripts), synthetic SSE monitors, breaker dashboards, runbooks for queue drain and GPT-5 throttling, plus CI that blocks merges on SLO regressions.

## Execution Phases (Foundations → Launch)

### Phase 0 — Foundations & Scaffolds (M0)
- Stand up repo workspaces: `api/`, `engine/`, `mobile/`, shared type package for agent payloads.
- Implement health checks, config validation, base metrics, lint/typecheck pipelines, GitHub Actions skeleton.
- Ensure mobile shell renders map with anonymous collective summary placeholder and SSE subscription stub.
- Deliverables: service skeletons returning empty `collective_summary`, baseline CI, documented env variables.
- Gate: `GET /healthz` for POP API & engine return 200; CI passes; map loads read-only state.

### Phase 1 — Ingestion & City Synth (M1)
- Build POP intake pipeline with validation, hard-block filters, language detection, MT→EN canonicalization, Qdrant embeddings, weight calc, and GPT-5 synthesis.
- Persist POP data & lineage, update `collective_state`, publish `agent_state_update`; POP API proxies `POST /v1/pops` and `GET /v1/agent-states` with Redis cache and SSE broadcast.
- Mobile integrates submission flow, login gate, and city summary updates.
- Gate: POP submission updates city `collective_summary` <10 s P95; SSE probe <1 s P95 with metrics snapshot.

### Phase 2 — Ancestor Rollups & Cache (M2)
- Implement debounced state/country synthesis queues, rollup metrics, and forced refresh.
- Enhance cache with TTL 60 s, stale-while-revalidate, partial responses on breaker.
- Mobile prefetches ancestor chains, displays freshness badges.
- Gate: Ancestor updates <30 s P95; cached reads <500 ms P95; cache hit ratio ≥70%.

### Phase 3 — Chat & Translation (M3)
- Expose chat endpoint via engine with translation in/out, tone rules, and session caps; POP API proxy with rate limits.
- Mobile renders streaming chat overlay with session controls, translation override, and soft-fail UI.
- Gate: Chat streaming start ≤2 s; translation failure rate <0.5% with fallback banner instrumentation.

### Phase 4 — UX Polish & Accessibility (M4)
- Implement chat bubble overlay, probe mode, accessibility refinements, map animations without stance/quotes components.
- Measure engagement funnel metrics, ensure reduced-motion compliance.
- Gate: Accessibility audit passes; overlay meets animation budgets; telemetry events flow to dashboards.

### Phase 5 — Observability & Launch Readiness (M5+)
- Harden dashboards/alerts for SLO probes, SSE clients, breaker state; run chaos/load drills; finalize runbooks; conduct go/no-go.
- Gate: 24h soak without P1, all SLO probes green, release checklist complete.

## Workstream Deliverables
- **Docs**: `data-model.md` (Postgres DDL, Redis/Qdrant keys), `contracts/api-spec.json` (OpenAPI excerpt), `quickstart.md` (dev bootstrap), runbooks under `/docs/`.
- **Testing**: Contract tests for POP submission, agent states, SSE ordering, chat limits; integration flows; performance probes; Flutter integration tests for explore, submission, chat, translation fallback.
- **Metrics**: `agent_state_refresh_last_latency_ms`, `agent_state_cache_hit_ratio`, `agent_state_update_total`, `chat_session_start_total`, translation failure counters, rollup queue sizes.

## Task Grouping (feed `/tasks`)
- **Setup**: Repo scaffolds, shared types, CI plumbing, secrets management.
- **Engine**: POP ingest, GPT-5 synthesis, rollups, chat, lineage, metrics.
- **POP API**: REST endpoints, caching, SSE, auth, rate limits, partial responses.
- **Mobile**: Map exploration, POP composer, chat overlay, localization, accessibility.
- **Observability**: Metrics, dashboards, SLO probes, chaos drills, runbooks.
- **Operations**: Prompt admin tools, regional mute controls, translation monitoring, release readiness.

## Open Risks & Mitigations
- **GPT-5 latency & quotas** → implement circuit breaker + cached persona prompts; prefetch tokens.
- **Translation accuracy** → monitor failure metric, provide locale fallback, evaluate alternate MT provider.
- **SSE fan-out scaling** → use Redis backlog/sequence numbers and load-test 50+ concurrent clients.
- **Region data quality** → seed authoritative geo dataset and validate slugging in ingestion tests.
- **Mobile auth parity** → integrate Sign in with Apple early to avoid launch gating.

## Next Actions
1. Capture outstanding research items and assign owners in `research.md`.
2. Solidify Postgres DDL, Redis/Qdrant schemas in `data-model.md`.
3. Extract OpenAPI excerpt into `contracts/api-spec.json`, ensuring `agent_state_update` event linkage and collective-only payloads.
4. Draft quickstart commands for local dev, SLO probes, and CI hooks.
5. Run `/tasks` after Phase 1 design docs are finalized to expand execution steps.

