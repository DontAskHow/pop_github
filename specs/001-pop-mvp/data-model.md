# Data Model: POP MVP

Authoritative schema derived from Data Schema & Cloud Architecture (Doc #5). All public payloads remain collective-only; no stance or quote fields exist.

## PostgreSQL DDL
```sql
create table prompt (
  prompt_id text primary key,
  semantics text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null
);

create table account (
  account_id uuid primary key,
  created_at timestamptz not null default now()
);

create table region (
  region_id text primary key,
  level text not null check (level in ('City','State','Country')),
  country char(2) not null,
  state text,
  city text,
  centroid_lat double precision,
  centroid_lng double precision
);

create table pop (
  pop_id uuid primary key default gen_random_uuid(),
  pop_public_id text not null unique,
  account_id uuid not null references account(account_id),
  prompt_id text not null references prompt(prompt_id),
  region_id text not null references region(region_id),
  original_text text not null check (char_length(original_text) between 1 and 1000),
  detected_lang char(2),
  canonical_en text not null,
  lat double precision,
  lng double precision,
  submitted_at timestamptz not null default now(),
  editable_until timestamptz not null,
  pin_expire_at timestamptz not null,
  supersedes_pop_id uuid,
  is_active boolean not null default true,
  constraint uq_one_active_per_prompt unique (account_id, prompt_id) deferrable initially immediate
);

create index idx_pop_region_prompt_time on pop(region_id, prompt_id, submitted_at desc);
create index idx_pop_active on pop(prompt_id, account_id) where is_active;

create table collective_state (
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  collective_summary text not null check (char_length(collective_summary) between 50 and 1200),
  pop_count integer not null default 0,
  weight_digest jsonb,
  updated_at timestamptz not null default now(),
  primary key (region_id, prompt_id)
);

create table lineage_weight (
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  pop_public_id text not null,
  weight_pct numeric(6,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  primary key (region_id, prompt_id, pop_public_id)
);

create table conversation (
  session_id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account(account_id),
  region_id text not null references region(region_id),
  prompt_id text not null references prompt(prompt_id),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table conversation_message (
  session_id uuid not null references conversation(session_id) on delete cascade,
  seq bigserial primary key,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create view v_public_pins as
  select pop_public_id, region_id, lat, lng, submitted_at, pin_expire_at
    from pop
   where now() < pin_expire_at;
```

### Triggers & Functions
```sql
create or replace function pop_before_insert() returns trigger as $$
begin
  update pop
     set is_active = false
   where account_id = new.account_id
     and prompt_id = new.prompt_id
     and is_active = true;

  new.editable_until := least(
    (select ends_at from prompt where prompt_id = new.prompt_id),
    now() + interval '15 minutes'
  );
  new.pin_expire_at := now() + interval '24 hours';
  return new;
end;
$$ language plpgsql;

create trigger trg_pop_before_ins
  before insert on pop
  for each row execute function pop_before_insert();
```

## Redis Namespaces
- `pop:agent:v1:{region_id}:{prompt_id}` → cached `CollectiveAgentState` JSON (TTL 60s, stale-while-revalidate).
- `pop:agent:etag:{region_id}:{prompt_id}` → weak version for cache coordination.
- `pop:sse:backlog:{stream_id}` → recent `agent_state_update` event backlog for reconnect replay.
- `pop:sse:seq:{region_id}` → monotonic sequence counter to prevent duplicate `agent_state_update` delivery.
- `pop:rl:chat_init:{region_id}` → sliding window enforcing ≤500 new chat sessions/minute.
- `pop:rl:submit:{account_id}:{prompt_id}` → additional write-side guard for one POP per prompt.
- `pop:rollupq:{level}` → light queue counters for state/country rollup orchestration.

## Qdrant Collections
- `pop_embeddings_{prompt_id}` per active prompt. Cosine distance, payload includes `pop_public_id`, `region_id`, `level`, `submitted_at`. Use HNSW config `{m:64, ef_construct:128, ef_search:64}`. Filter queries by region to compute contribution weights.

## Data Retention & Privacy Notes
- POP rows persist indefinitely; `pin_expire_at` controls UI visibility only.
- Lineage vectors store anonymized `pop_public_id` values; no user PII is exposed.
- Conversation transcripts retained for operational review and abuse response; access controlled via internal tooling.
- No stance or quote strings are stored in public-facing structures; `collective_summary` remains the only exposed narrative field.

