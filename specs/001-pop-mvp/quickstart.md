# Quickstart — POP MVP Dev Environment

1. **Install prerequisites**
   - Node.js 22 + pnpm 9, Docker Desktop, Dart 3 / Flutter stable, Redis CLI, Qdrant CLI.
   - Export secrets in `.env.local` (never commit): `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `OPENAI_API_KEY`, `JWT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`.

2. **Bootstrap services**
   ```bash
   docker compose -f ops/docker-compose.dev.yml up -d postgres redis qdrant
   pnpm --dir api install
   pnpm --dir engine install
   pnpm --dir mobile install   # uses flutter pub through toolchain
   ```

3. **Run database migrations & seed geography**
   ```bash
   pnpm --dir api exec prisma migrate deploy
   pnpm --dir api exec ts-node scripts/seed-regions.ts --source data/geo.json
   pnpm --dir api exec ts-node scripts/seed-prompts.ts --prompt 2025-W42
   ```

4. **Start local services**
   ```bash
   pnpm --dir engine run dev        # Semantic Congregator (ingest, synthesis, SSE publisher)
   pnpm --dir api run dev           # POP API (REST + SSE agent_state_update)
   pnpm --dir ingestion run worker  # Rollup + chat orchestration jobs
   flutter run --flavor dev         # Mobile client (emulator or device)
   ```

5. **Exercise smoke flows**
   ```bash
   pnpm --dir api run test:contract            # POP submission, agent states, chat contracts
   pnpm --dir api run probe:latency            # Emits city/ancestor/cached/SSE probes
   pnpm --dir engine run test:unit             # Weighting & synthesis guards
   flutter test                                # Widget & integration tests
   ```

6. **Observability hooks**
   - Visit `http://localhost:9301/metrics` (engine) and `http://localhost:9300/metrics` (POP API) for Prometheus samples.
   - Run `pnpm --dir api run monitor:sse` to verify `agent_state_update` delivery and backlog replay.
   - Dashboards reside in `ops/grafana/`; import `agent-state.json` to inspect city/ancestor latency during probes.

7. **SpecWorkflow maintenance**
   - Update `specs/001-pop-mvp/research.md` as decisions land.
   - Re-run `.specify/scripts/bash/update-agent-context.sh copilot` after major plan adjustments.
   - Execute `/tasks` workflow once Phase 1 design artifacts (data-model, contracts, quickstart) are ratified.

