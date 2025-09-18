export type RegionLevel = 'City' | 'State' | 'Country';

export const REGION_LEVELS: readonly RegionLevel[] = ['City', 'State', 'Country'];

export type Locale =
  | 'en'
  | 'es'
  | 'pt'
  | 'fr'
  | 'de'
  | 'hi'
  | 'ja'
  | 'ko'
  | 'zh-CN'
  | 'zh-TW';

export interface RegionIdParts {
  level: RegionLevel;
  country: string;
  state?: string;
  city?: string;
}

export type RegionId = string;

export interface PopSubmission {
  account_id: string;
  prompt_id: string;
  text: string;
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  country: string;
  device_locale?: Locale;
}

export interface CollectiveAgentState {
  id: RegionId;
  level: RegionLevel;
  prompt_id: string;
  collective_summary: string;
  updated_at: string;
  x_meta?: {
    pop_count: number;
    weight_digest?: {
      mean: number;
      stddev: number;
      gini: number;
      topk?: Array<{ pop_public_id: string; weight_pct: number }>;
    };
  };
}

export interface AgentStateEnvelope {
  agents: CollectiveAgentState[];
  metadata: {
    cached_at: string;
    ttl_seconds: number;
    source: 'cache' | 'fresh';
    partial_results?: boolean;
  };
}

export interface AgentStateUpdateEvent {
  region_id: RegionId;
  agent_state: CollectiveAgentState;
  updated_at: string;
  change_type: 'created' | 'updated' | 'refreshed';
  trigger_reason: 'new_pop' | 'scheduled_refresh' | 'manual_refresh';
}

export interface PopIngestResponse {
  status: 'accepted' | 'rejected';
  region_assignments: RegionId[];
}

export const AGENT_STATE_EVENT_NAME = 'agent_state_update';
