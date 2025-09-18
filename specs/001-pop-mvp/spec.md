# Feature Specification: POP MVP

**Feature Branch**: `001-pop-mvp`  
**Created**: 2025-09-18  
**Status**: Draft  
**Input**: Synthesis of product docs in `specs/000-pop/docs`

## User Scenarios & Testing *(mandatory)*

### Primary User Story
A curious person opens POP, browses the live world map of regional voices, signs in once, contributes a weekly POP anchored to their current city, and then chats with any region’s collective agent to understand how that region feels about the prompt of the week.

### Acceptance Scenarios
1. **Given** an unsigned visitor, **When** they launch POP, **Then** the map renders regional tiles with the latest collective summaries (cached fetch **<500 ms P95**) and the visitor can explore any region without revealing identities.
2. **Given** an authenticated contributor, **When** they submit a POP (≤1000 chars) with a resolvable location, **Then** the pin appears instantly, the city-level collective summary refreshes within **10 s P95**, ancestor rollups update within **30 s P95**, and the one-POP-per-account-per-prompt rule is enforced with a 15-minute adjustment window.
3. **Given** an authenticated user on a region card, **When** they start a chat session, **Then** the region agent responds via the `agent_state_update` SSE stream, anchored to the weekly prompt, within **1 s P95** while maintaining the 20-turn/30-minute limits and ≤500 new sessions per minute per region.

### Edge Cases
- Location cannot be resolved (GPS denied and IP/manual lookup fails) → submission blocked with actionable guidance.
- Translation to the user’s locale fails → collective summary/chat fallback displays canonical English with an “auto-translate unavailable” banner; incident logged.
- Surge of chat requests crosses the per-region cap → graceful soft-fail message appears without terminating active sessions.
- Automated hard-block detects illegal or disallowed content → submission rejected with neutral copy; no human moderation queue is triggered.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: Provide a single global prompt of the week with localized display copy and admin tooling for updates.
- **FR-002**: Allow map exploration of country/state/city collectives without authentication while keeping all payloads anonymous and collective-only (no stance breakdowns or quotes).
- **FR-003**: Support social login via Google, Facebook, and X/Twitter, and require Sign in with Apple on iOS alongside any third-party login.
- **FR-004**: Accept exactly one POP per account per prompt (≤1000 characters) with mandatory location resolution, 15-minute undo window, 24-hour pin TTL, and indefinite server retention.
- **FR-005**: Generate and expose a single `collective_summary` per region & prompt, updating city within 10 s P95 and ancestor summaries within 30 s P95.
- **FR-006**: Deliver cached reads of agent states within 500 ms P95 and stream updates via SSE event type `agent_state_update` end-to-end within 1 s P95.
- **FR-007**: Provide region-agent chat with translation, 20-turn/30-minute session caps, ≤500 new sessions/min per region, and transcript storage for internal audit.
- **FR-008**: Publish anonymized lineage metadata (per-POP weights, model versions) to internal clients without revealing user identities or quotes.
- **FR-009**: Instrument SLO probes, metrics, and dashboards for city/ancestor latency, cached reads, SSE delivery, chat throughput, and translation failure rate (<0.5%).
- **FR-010**: Surface admin abilities to issue the prompt of the week, mute regions after automated abuse spikes, and resume service gracefully.

### Key Entities *(include if feature involves data)*
- **Prompt**: Weekly canonical question (`prompt_id`, semantics, localized copy, start/end).
- **Account**: Authenticated contributor record with provider metadata (not publicly exposed).
- **Region**: Hierarchical geo node with deterministic ID (`level:country[:state][:city_slug]`).
- **POP Submission**: An anonymous message tied to `(account_id, prompt_id, region_id)` with translation metadata, edit window, and pin TTL fields.
- **Collective Agent State**: Single summary string plus metadata (pop_count, weight digest) per `(region_id, prompt_id)` pushed through cache + SSE.
- **Contribution Lineage**: Per-POP weight vector and model/template versions stored for audit, never exposing identities.
- **Conversation Session**: Chat transcript metadata (session_id, account_id, region_id, prompt_id, last_activity) enforcing limits and translation settings.

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified (weekly prompt cadence, translation locales, anonymity & collective-only outputs)

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked and resolved
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

