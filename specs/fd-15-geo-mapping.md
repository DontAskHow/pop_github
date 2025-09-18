**Focused Document #15 — Geospatial & Region Mapping Spec (Greenfield, Codex‑ready)**
*Purpose:* Define how POP derives **canonical region IDs** from device GPS or IP, computes **ancestor chains** for hierarchical roll‑ups, enforces **privacy rounding**, integrates with the **Semantic Congregator**, honors **collective‑only** public surfaces, and meets the SLOs and monitoring expectations already set. This spec supersedes any legacy pulse/circle notions and aligns with the current **AgentState** proxy + **SSE** design.  &#x20;

---

## 0) Non‑negotiables & scope

* **Canonical, global region IDs** with deterministic ancestor chains (neighborhood/zip → city → state/province/prefecture → country). Clients and servers use the same format.&#x20;
* **Public surfaces are collective‑only:** the map and chat render **one collective summary** per region; no stance bars or quotes appear publicly in the MVP, even if upstream can produce them. (Admin lineage remains audit‑safe.)&#x20;
* **Location policy:**

  * If **GPS allowed**, derive region from precise coordinates (with privacy rounding at storage).
  * If **GPS denied**, attempt **IP→city**; if city resolution fails, **block the submission**.&#x20;
* **Pins & roll‑ups:** individual bubble pins are visual‑only TTL **24 h**; region roll‑ups persist for the **prompt week**, refreshed live. Data is retained indefinitely server‑side.&#x20;
* **SLO coupling:** geospatial derivation must not jeopardize **city <10 s**, **ancestor <30 s** roll‑up targets or **<500 ms** cached reads; SSE E2E **<1 s**.&#x20;

---

## 1) Canonical IDs, levels, ancestors

### 1.1 Region ID format (authoritative)

```
{level}:{CC}(:{subdivision_or_city_slug}(:{city_slug}|{zip}|{neighborhood_slug})?) 
level ∈ {neighborhood|zip|city|state|country}
```

**Validation regex (server‑side):**
`^(neighborhood|zip|city|state|country):[A-Z]{2}(:[a-z0-9-]+)*$` (strict casing, ASCII slugs).&#x20;

**Examples:**

* `neighborhood:US:ca:san-francisco:mission`
* `zip:US:ca:94110`
* `city:US:ca:san-francisco`
* `state:US:ca`
* `country:US`
  (Format and examples match Integration Architecture & API Contracts.) &#x20;

### 1.2 Slug rules

* **Country (`CC`)**: ISO‑3166‑1 alpha‑2 (upper‑case).
* **Subdivision** (admin‑1: state/province/prefecture): lowercase, hyphenated slug derived from ISO‑3166‑2 subcode **or** the provider’s admin‑1 name (ASCII transliteration).
* **City/Neighborhood/ZIP**: lowercase, ASCII slug (hyphenated).
* **Determinism:** the same inputs must map to the same slug. If collisions, append `-n2`, `-n3` deterministically by provider ID ordering.
* **Ancestor derivation:** pure string truncation:

  * `neighborhood:US:ca:san-francisco:mission` → `city:US:ca:san-francisco` → `state:US:ca` → `country:US`
  * `zip:US:ca:94110` → `city:US:ca:san-francisco` (best‑effort) → `state:US:ca` → `country:US`&#x20;

---

## 2) Derivation pipeline (ingest‑time)

**Inputs:** `(lat, lng)` (preferred) or `ipAddress` (fallback).
**Outputs:** `{ region_id, level, ancestors[], displayName, centroid }`.

### 2.1 GPS path (preferred)

1. **Reverse geocode (server‑side)** using Google Maps Geocoding/Places.
2. Extract components by precedence:

   * **city:** `locality` or `postal_town`; fallback: `administrative_area_level_2` when no `locality`.
   * **admin‑1:** `administrative_area_level_1`.
   * **country:** `country`.
   * **optional:** `neighborhood` or `sublocality`, and `postal_code`.
3. **Canonicalize** with slug rules; build the most granular **supported** level (see §2.3).
4. **Compute ancestors** deterministically from the ID string (no network calls).
5. **Emit mapping** `{regionId, level, ancestors[], displayName, centroid}` and cache.
   *(POP already has a `regionMapper` module; this formalizes the production path and replaces heuristic dev code.)*&#x20;

### 2.2 IP→city fallback (GPS denied)

* Resolve **city/state/country** via IP geolocation. If a **city** cannot be resolved with sufficient confidence, **reject the POP** (hard rule for MVP).&#x20;
* For IP‑resolved city, **do not** pin an individual bubble (no coordinates), but contributions still flow into city/state/country aggregates.&#x20;

### 2.3 Supported levels at launch

* **MVP public hierarchy:** **city**, **state** (admin‑1), **country** (mandatory).
* **Neighborhood/ZIP:** optional behind a feature flag for selected metros; IDs are accepted server‑side but may not render until admin toggles the feature. *(Keeps global coverage while allowing staged rollout.)*&#x20;

### 2.4 Ocean & border handling

* If `(lat,lng)` falls in water **>5 km** from land, use **IP→city** fallback; else snap to the nearest land city centroid returned by provider (lowest travel distance). Mark the mapping with `source='gps-snap'` for observability. *(Ocean filtering was called out as optional—codified here.)*&#x20;

---

## 3) Privacy & storage

* **Rounded coordinates:** persist at most **3 decimal places** (\~110 m) if captured; store `region_id` as the authoritative locator. (Columns permit finer precision, but service enforces rounding.)&#x20;
* **No user identifiers** appear in public map data; only collectives per region are returned to clients/SSE. Lineage uses **`pop_public_id` + weight\_pct** only.&#x20;
* **Indefinite retention** of POPs & aggregates; pins are merely visual TTL.&#x20;

---

## 4) Data structures & optional registry

**Postgres (optional helper table to improve labeling/centroids):**

```sql
create table region_registry (
  region_id text primary key,               -- canonical id
  level text not null check (level in ('neighborhood','zip','city','state','country')),
  cc char(2) not null,                      -- ISO country
  admin1_code text,                         -- normalized subdivision slug or ISO-3166-2 child code
  display_name_en text not null,            -- English label
  display_names jsonb not null default '{}'::jsonb, -- {"es":"...", "fr":"..."}
  centroid_lat numeric(8,5) not null,
  centroid_lng numeric(8,5) not null,
  bbox jsonb,                               -- [minLng,minLat,maxLng,maxLat] if available
  provider_ref jsonb,                       -- store provider place_ids / components
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_region_registry_level_cc on region_registry(level, cc);
```

*(The system can compute ancestors without this table; registry improves labels & map pin placement.)*&#x20;

**Redis (geocoder cache):**

* `geo:rev:{lat_5}:{lng_5} → {regionId, level, ancestors[], displayName, centroid}` (TTL 7–30 days).
* `geo:ipcity:{/24 or providerKey} → {regionId, ...}` (TTL 24 h).
* Metrics: `geocode_cache_hit/miss`, `ip_city_resolution_success`, `blocked_no_city_total`. Wire to dashboards.&#x20;

---

## 5) Service contracts & wiring

### 5.1 POP ingest path (server)

```ts
// server/lib/regionMapper.ts (production)
export async function mapLocation(
  input: { lat?: number; lng?: number; ip?: string }
): Promise<{
  regionId: string; level: 'city'|'state'|'country'|'neighborhood'|'zip';
  ancestors: string[]; displayName: string; centroid: {lat:number,lng:number};
  source: 'gps'|'gps-snap'|'ip';
}> {
  // 1) GPS preferred
  if (hasLatLng(input)) {
    const cached = await cache.lookup(lat,lng);
    const comp = cached ?? await reverseGeocode(lat,lng);           // Google Maps
    const region = canonicalize(comp);                               // slugs + level
    await cache.store(lat,lng,region);
    return {...region, source: 'gps'};
  }
  // 2) IP fallback
  const city = await ipToCity(input.ip);
  if (!city) throw new BlockError('city_required');                  // hard rule
  const region = canonicalize(city);
  await cache.storeIp(input.ip, region);
  return {...region, source: 'ip'};
}
```

* Enforce **region ID regex** and ancestor derivation from strings—no extra DB lookups.&#x20;
* On successful POP persist, forward to congregator with the derived **region** and trigger **roll‑up scheduling** (debounced for ancestors). &#x20;

### 5.2 Congregator & SSE integration

* After POP ingest and forward, POP **forces a refresh** for the direct region; on success it **stores** the latest collective in cache and broadcasts **`agent_state_update`** SSE to subscribers. &#x20;
* Ancestor regions are **debounced** (e.g., 6–9 s) via the roll‑up processor to hit SLOs and avoid update storms. Track `rollup_*` metrics. &#x20;

---

## 6) Client coupling (Flutter/Maps)

* **Zoom → hierarchy:** Use thresholds to switch between **city/state/country** cards; neighborhood/zip rendering is flag‑gated. The bubbles use **region\_id** to query `/api/agent-states` and subscribe to **`agent_state_update`**. &#x20;
* **Pre‑login:** The map may show collectives for the visible regions without authentication; post/chat actions remain gated.&#x20;

> Note: any legacy UI elements referencing stance bars/quotes are **ignored** in public render paths per the collective‑only rule.&#x20;

---

## 7) Performance, reliability & SLOs

* **Derivation latency targets (ingest path):**

  * GPS reverse geocode (cache miss): **P95 < 400 ms**; cache hit: **< 5 ms**.
  * IP→city: **P95 < 150 ms** (edge provider).
  * These budgets ensure city roll‑up **P95 < 10 s**, ancestor **< 30 s**, cached reads **< 500 ms**, SSE **< 1 s** E2E.&#x20;
* **Breaker & retry:** Geocoding failures must not block POP submission—fall back to IP path; if IP also fails, block with structured error `city_required`. Use the standard breaker/runbook for congregator issues.&#x20;

---

## 8) Observability & runbooks

**Metrics (augment Monitoring Plan):**

* `geocode_attempt_total`, `geocode_success_total`, `geocode_failure_total`
* `geocode_cache_hit`, `geocode_cache_miss`, `ip_city_resolution_success`, `ip_city_resolution_failure`
* `blocked_no_city_total` (submissions blocked by the rule)
* `region_mapper_latency_ms_total` (sum), `region_mapper_last_latency_ms` (gauge)
  Wire these to **AgentState Health** dashboards and alert if city resolution fails >5% over 10 min.&#x20;

**Runbooks:** if geocode provider outage spikes failures, keep ingest alive and rely on IP path; if both fail globally, temporarily **disable posting** (feature flag) until provider health returns; follow **Breaker & Retry Queue Recovery** for engine‑side issues.&#x20;

---

## 9) Error responses & validation

* **400 `invalid_region_ids`** for invalid `ids` in reads (existing).
* **422 `city_required`** when GPS is denied and IP→city resolution fails (ingest).
* **429** rate‑limit with `retry_after` for resolve endpoints.
  All follow the standard **ErrorResponse** envelope with `trace_id`.&#x20;

---

## 10) Testing & acceptance

**Unit (server):**

* `deriveRegionFromCoordinates` → known fixtures (Mission SF, Oakland, NYC, Toronto, London, Tokyo) produce canonical IDs and correct ancestors. *(The checklist already includes fixture coverage—expand to global set.)*&#x20;
* Regex validator rejects malformed IDs; slug collisions resolve deterministically.

**Integration:**

* POP → region mapping → congregator refresh → `/api/agent-states` reflects update; SSE `agent_state_update` received within target window. *(Leverage existing SSE & roll‑up probes.)* &#x20;

**Acceptance checklist**

* [ ] GPS→region works globally; IP→city fallback blocks on city failure (per policy).&#x20;
* [ ] Region IDs match the **regex** and ancestor derivation works via string truncation.&#x20;
* [ ] City updates **<10 s P95**; ancestor **<30 s** after submit; SSE freshness **<1 s**; cached reads **<500 ms**.&#x20;
* [ ] No PII or raw POP text leaks via map/DTOs; only collective summaries delivered.&#x20;
* [ ] Metrics visible; alerts trigger on mapping failures; runbooks referenced from dashboards. &#x20;

---

## 11) Deliverables (tickets for Codex)

1. **GEO‑01**: Production `regionMapper` with Google reverse‑geocode + IP→city fallback, canonicalization, caching, regex guard, and metrics. *(Replaces dev heuristic.)*&#x20;
2. **GEO‑02**: Redis geocoder caches (`geo:rev:*`, `geo:ipcity:*`), TTLs, LRU limits, and dashboards (hit/miss).&#x20;
3. **GEO‑03**: Ancestor roll‑up scheduler integration (debounce per level), SLO probes. &#x20;
4. **GEO‑04**: Optional `region_registry` table + admin seed script (labels/centroids for top metros).&#x20;
5. **GEO‑05**: Error envelopes (`city_required`), rate‑limits, and tests across GPS/IP paths. &#x20;
6. **GEO‑06**: Client wiring: use hierarchy thresholds to request city/state/country AgentStates and subscribe to matching SSE regions; ignore stance/quotes in public views. &#x20;
7. **GEO‑07**: Monitoring: panels & alerts for mapping failure rate, latency, and blocked submissions; link to runbooks. &#x20;

---

## 12) Notes on alignment

* **Integration Architecture** already standardizes **ID format** and ingest/roll‑up flow; this spec locks the production geospatial path to that model.&#x20;
* **API Contracts** remain authoritative for regex validation, error envelopes, and **`agent_state_update`** SSE shape; public DTOs are collective‑only.&#x20;
* **Implementation Checklist** called out replacing Bay Area heuristics with a global mapper—this document completes that work.&#x20;
* **Monitoring/Test Plans** supply probes and dashboard metrics we extend here for geocoding; use the same `/metrics` and UAT flows. &#x20;
* **MVP Plan** keeps single‑region infra with CDN; this mapping spec stays within that performance envelope.&#x20;

---

