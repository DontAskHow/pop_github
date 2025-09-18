# Research Log — POP MVP

| Topic | Question | Owner | Target Date | Status |
|-------|----------|-------|-------------|--------|
| GPT-5 throughput & pricing | Confirm concurrency quotas and latency budget needed to keep city updates <10 s and SSE <1 s during spikes. | Semantic Engine | 2025-09-20 | Open |
| Translation provider coverage | Validate MT quality for en/es/pt/fr/de/hi/ja/ko/zh-CN/zh-TW and define fallback thresholds/banners. | Platform | 2025-09-22 | Open |
| Geo dataset seeding | Select authoritative world city/state dataset compatible with region ID format and licensing. | Data Engineering | 2025-09-22 | Open |
| Redis + SSE capacity | Load-test backlog size and reconnection strategy for ≥50 concurrent clients per region without exceeding <1 s SSE SLO. | Infra | 2025-09-23 | Open |
| Sign in with Apple integration plan | Confirm iOS auth UX, app store requirements, and provider configuration alongside social logins. | Mobile | 2025-09-24 | Open |
| Automated hard-block catalog | Finalize policy list for illegal/spam detection and logging expectations without adding manual review. | Trust & Safety | 2025-09-24 | Open |

> Update each row with decisions, links to artifacts, and mark **Closed** when implemented.

