import { describe, expect, it } from 'vitest';
import { toLocalFeaturePageResponse } from './route';

describe('toLocalFeaturePageResponse', () => {
  it('returns the browser GeoJSON page contract', () => {
    const page = {
      geojson: { type: 'FeatureCollection' as const, features: [] },
      nextCursor: 'next-page',
    };

    expect(toLocalFeaturePageResponse(page)).toEqual({
      type: 'FeatureCollection',
      features: [],
      next_cursor: 'next-page',
    });
  });
});
