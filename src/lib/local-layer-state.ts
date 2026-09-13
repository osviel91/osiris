import type { LocalFeatureCollection, LocalLayerMetadata } from './local-geo-api';

export type LocalLayerState = {
  metadata: LocalLayerMetadata;
  enabled: boolean;
  loading: boolean;
  error?: string;
  geojson?: LocalFeatureCollection;
};

export type LocalLayerMap = Record<string, LocalLayerState>;

export const LOCAL_LAYER_REFRESH_ERROR = 'Refresh failed — showing previously loaded data.';

/** A layer with no cache must be fetched; a cached layer only flips visibility. */
export function localLayerNeedsFetch(layer?: LocalLayerState): boolean {
  return !!layer && !layer.loading && !layer.enabled && !layer.geojson;
}

/** Marks a cached layer as refreshing. No-ops for unknown, unloaded, or in-flight layers. */
export function markLocalLayerRefreshing(state: LocalLayerMap, id: string): LocalLayerMap {
  const layer = state[id];
  if (!layer || layer.loading || !layer.geojson) return state;
  return { ...state, [id]: { ...layer, loading: true, error: undefined } };
}

/** Replaces the cached collection only after a successful fetch. */
export function applyLocalLayerRefreshed(state: LocalLayerMap, id: string, geojson: LocalFeatureCollection): LocalLayerMap {
  const layer = state[id];
  if (!layer) return state;
  return { ...state, [id]: { ...layer, loading: false, geojson, error: undefined } };
}

/** Keeps the previously rendered collection and surfaces a non-destructive error. */
export function applyLocalLayerRefreshError(state: LocalLayerMap, id: string, message = LOCAL_LAYER_REFRESH_ERROR): LocalLayerMap {
  const layer = state[id];
  if (!layer) return state;
  return { ...state, [id]: { ...layer, loading: false, error: message } };
}
