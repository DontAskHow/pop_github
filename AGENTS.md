title: POP Agents Operating Guide (SpecWorkflow-first)
version: 1.0

Purpose
- This file instructs the coding agent to ALWAYS use GitHub SpecWorkflow (github/spec-kit) for planning and delivery.
- It also declares the single GitHub repo it should operate in and how to authenticate.

Mandatory workflow (must follow)
- Use GitHub SpecWorkflow (github/spec-kit) for all work. The canonical sequence is:
  1) /specify — ingest/normalize specs into a feature spec
  2) /plan — produce architecture/impl plan and acceptance gates
  3) /tasks — expand into executable tasks and PRs
- Never push directly to the default branch. Always open PRs from feature branches.
- Every change must tie back to a task generated from /tasks and reference acceptance criteria and SLOs.
- Public payloads must remain collective-only (no stance charts, no quotes, no identities).

Repo and auth (fill these in)
- DO NOT COMMIT your token to the repo. Prefer environment variables, a local secrets file in a gitignored path, or your CI secrets store.
- Still, to make the agent setup simple, paste your details below, then immediately move the token to a secret store and delete the raw token from this file.

Repository
- GH_USERNAME: DontAskHow
- GH_REPO_NAME: pop_github
- GH_REPO_SLUG: DontAskHow/pop_github
- GH_DEFAULT_BRANCH: main

Authentication (personal access token)
- GH_TOKEN: <moved-to-secret-store>
- Storage guidance:
  - Preferred: export GH_TOKEN in your shell or place in a local .secrets/agents.env (gitignored) and let the agent read from env.
  - Example shell: export GH_TOKEN="ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  - If you must paste above temporarily: remove it after agent bootstraps; do not commit.

Agent operating rules
- Primary workflow: github/spec-kit. If multiple agent tools are detected, select SpecWorkflow and ignore others.
- Toolchain preferences:
  - Version control: git + gh CLI
  - Planning: spec-kit /specify /plan /tasks
  - CI: GitHub Actions (create workflows as needed)
- Branching and PRs:
  - Branch naming: m{milestone}-{short-title} (e.g., m1-ingestion), or t{ticket}-{short-title}
  - PR titles: “M{#} — {scope}” or “T{#} — {task title}”
  - PR checklist must include acceptance criteria and SLO probes when applicable
- Commit style: Conventional Commits (feat:, fix:, chore:, docs:, refactor:, test:)
- Secrets hygiene: never print or log GH_TOKEN; use env lookup; redact in logs.

SpecWorkflow commands the agent should run by default
- Initialize feature from the docs/specs:
  - specify init --here --ai copilot --ignore-agent-tools
  - (or) specify feature create 001-pop-mvp --from ./specs/000-pop/docs
- Produce a plan and tasks:
  - specify plan --feature 001-pop-mvp --out ./specs/001-pop-mvp/plan.md
  - specify tasks --feature 001-pop-mvp --open-prs
- Keep tasks in sync:
  - specify tasks update --feature 001-pop-mvp
- Validate acceptance:
  - specify verify --feature 001-pop-mvp

Repository guardrails (must not violate)
- No force pushes; no direct commits to GH_DEFAULT_BRANCH
- All public APIs and SSE events must match the CollectiveAgentState spec (collective_summary only)
- Enforce SLOs at PR time with probes:
  - City update P95 < 10 s
  - Ancestor update P95 < 30 s
  - Cached agent-state read P95 < 500 ms
  - SSE end-to-end < 1 s
- iOS must offer Sign in with Apple if any third‑party login is present

Default PR checklist (the agent should include this)
- [ ] Uses SpecWorkflow tasks (/tasks) with linked acceptance bullets
- [ ] Adds/updates tests for SLO probes where relevant
- [ ] No stance or quotes fields in public DTOs
- [ ] SSE event agent_state_update payload validated
- [ ] Metrics and dashboards updated (if endpoints/latency change)
- [ ] No secrets in code or logs

Minimal machine-readable config (agent can parse this block)
yaml_config:
  workflow: github-specworkflow
  repo:
    owner: "<your_github_username_here>"
    name: "<your_repo_name_here>"
    default_branch: "main"
    slug: "<your_username>/<your_repo_name>"
  auth:
    # The agent should read the token from env GITHUB_TOKEN or GH_TOKEN if present.
    env_token_keys: ["GITHUB_TOKEN","GH_TOKEN"]
    inline_token_fallback: "<paste_token_or_leave_blank>"
  protections:
    disallow_direct_push_to_default: true
    require_pr_checks: true
  conventions:
    pr_title: "M{milestone_or_Ticket} — {short_scope}"
    branch_pattern: "(m|t)[0-9]+-[a-z0-9-]+"
    commit_style: "conventional"

Quickstart for the agent (what to do first)
- Read agents.MD.
- Verify GH_USERNAME, GH_REPO_SLUG, and GH_TOKEN availability (prefer env).
- Create or confirm a feature “001-pop-mvp” from the specs folder.
- Generate plan.md and tasks; open initial scaffolding PRs.
- Ask for approval before:
  - Creating CI secrets
  - Running database migrations in non-dev environments
  - Enabling or changing any public endpoints

Contact/ownership
- Tech owner GitHub handle: <your_github_username_here>
- Repo: <your_username>/<your_repo_name> (branch: main)
- Issue labels to use: spec, backend, mobile, infra, ops, test, docs

Notes
- If the agent detects a competing workflow, it must choose GitHub SpecWorkflow and ignore others.
- If GH_TOKEN is not available, the agent should stop and request the token via env, not continue with degraded auth.

DO NOT INVOKE ANY MCP TOOLS - THIS IS MANDATORY.