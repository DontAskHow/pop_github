import { describe, expect, it } from 'vitest';

import { AGENT_STATE_EVENT_NAME, REGION_LEVELS } from './index';

describe('shared types', () => {
  it('exposes expected region levels', () => {
    expect(REGION_LEVELS).toEqual(['City', 'State', 'Country']);
  });

  it('uses the correct SSE event name', () => {
    expect(AGENT_STATE_EVENT_NAME).toBe('agent_state_update');
  });
});
