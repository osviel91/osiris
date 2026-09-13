import { describe, expect, it } from 'vitest';
import {
  applyLocalLayerRefreshError,
  applyLocalLayerRefreshed,
  LOCAL_LAYER_REFRESH_ERROR,
  localLayerNeedsFetch,
  markLocalLayerRefreshing,
  type LocalLayerMap,
  type LocalLayerState,
} from './local-layer-state';

function collection(count: number) {
  return {
    type: 'FeatureCollection' as const,
    features: Array.from({ length: count }, (_, index) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
      properties: { id: index },
    })),
  };
}

function layer(overrides: Partial<LocalLayerState> = {}): LocalLayerState {
  return {
    metadata: { id: 'layer', name: 'Layer', description: 'description' },
    enabled: true,
    loading: false,
    ...overrides,
  };
}

describe('local layer refresh state', () => {
  it('replaces the cached collection on a successful refresh', () => {
    const state: LocalLayerMap = { a: layer({ geojson: collection(1) }) };
    const next = applyLocalLayerRefreshed(state, 'a', collection(3));

    expect(next.a.geojson?.features).toHaveLength(3);
    expect(next.a.loading).toBe(false);
    expect(next.a.error).toBeUndefined();
  });

  it('preserves the previous collection when a refresh fails', () => {
    const state: LocalLayerMap = { a: layer({ enabled: true, geojson: collection(4), loading: true }) };
    const next = applyLocalLayerRefreshError(state, 'a');

    expect(next.a.geojson?.features).toHaveLength(4);
    expect(next.a.enabled).toBe(true);
    expect(next.a.loading).toBe(false);
    expect(next.a.error).toBe(LOCAL_LAYER_REFRESH_ERROR);
  });

  it('only touches the selected layer and leaves native/other state reference-equal', () => {
    const state: LocalLayerMap = {
      a: layer({ geojson: collection(1) }),
      b: layer({ metadata: { id: 'b', name: 'B', description: 'other' }, geojson: collection(5) }),
    };
    const next = applyLocalLayerRefreshed(state, 'a', collection(2));

    expect(next.a.geojson?.features).toHaveLength(2);
    expect(next.a).not.toBe(state.a);
    expect(next.b).toBe(state.b);
  });

  it('ignores refresh state changes for unknown layers', () => {
    const state: LocalLayerMap = { a: layer({ geojson: collection(1) }) };

    expect(markLocalLayerRefreshing(state, 'missing')).toBe(state);
    expect(applyLocalLayerRefreshed(state, 'missing', collection(9))).toBe(state);
    expect(applyLocalLayerRefreshError(state, 'missing')).toBe(state);
  });

  it('guards against concurrent or repeated refresh clicks', () => {
    const inFlight: LocalLayerMap = { a: layer({ geojson: collection(1), loading: true }) };
    expect(markLocalLayerRefreshing(inFlight, 'a')).toBe(inFlight);

    const idle: LocalLayerMap = { a: layer({ geojson: collection(1) }) };
    const marked = markLocalLayerRefreshing(idle, 'a');
    expect(marked.a.loading).toBe(true);
    expect(markLocalLayerRefreshing(marked, 'a')).toBe(marked);
  });

  it('keeps disabled and unloaded layers sensible', () => {
    const unloaded: LocalLayerMap = { a: layer({ enabled: false, geojson: undefined }) };
    expect(markLocalLayerRefreshing(unloaded, 'a')).toBe(unloaded);

    const cachedDisabled: LocalLayerMap = { a: layer({ enabled: false, geojson: collection(2) }) };
    const next = applyLocalLayerRefreshError(cachedDisabled, 'a');
    expect(next.a.enabled).toBe(false);
    expect(next.a.geojson?.features).toHaveLength(2);
  });

  it('keeps the toggle caching rule intact', () => {
    expect(localLayerNeedsFetch(layer({ enabled: false, geojson: undefined }))).toBe(true);
    expect(localLayerNeedsFetch(layer({ enabled: false, geojson: collection(1) }))).toBe(false);
    expect(localLayerNeedsFetch(layer({ enabled: true, geojson: collection(1) }))).toBe(false);
    expect(localLayerNeedsFetch(undefined)).toBe(false);
  });
});
