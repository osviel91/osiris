export type LocalLayerMetadata = {
  id: string;
  name: string;
  description: string;
  geometryTypes?: string[];
  featureCount?: number;
};

export type LocalPosition = [number, number];

export type LocalGeometry =
  | { type: 'Point'; coordinates: LocalPosition }
  | { type: 'Polygon'; coordinates: LocalPosition[][] }
  | { type: 'MultiPolygon'; coordinates: LocalPosition[][][] };

export type LocalFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: LocalGeometry;
    properties: Record<string, string | number | boolean>;
  }>;
};

export type LocalFeaturePage = {
  geojson: LocalFeatureCollection;
  nextCursor: string | null;
};

const LAYER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalLayerGeometry(layer: Record<string, unknown>): Pick<LocalLayerMetadata, 'geometryTypes' | 'featureCount'> {
  const types = layer.geometry_types;
  const geometryTypes = Array.isArray(types) && types.length > 0 && types.every((type) => typeof type === 'string') ? (types as string[]) : undefined;
  const count = layer.feature_count;
  const featureCount = typeof count === 'number' && Number.isFinite(count) ? count : undefined;
  return { ...(geometryTypes ? { geometryTypes } : {}), ...(featureCount !== undefined ? { featureCount } : {}) };
}

function isPosition(value: unknown): value is LocalPosition {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lng, lat] = value;
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function isRing(value: unknown): value is LocalPosition[] {
  return Array.isArray(value) && value.length >= 4 && value.every(isPosition);
}

/** Returns null for unsupported or malformed geometry; callers reject the whole collection. */
function normalizeGeometry(value: unknown): LocalGeometry | null {
  const geometry = record(value);
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    return isPosition(geometry.coordinates) ? { type: 'Point', coordinates: geometry.coordinates } : null;
  }
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates;
    if (!Array.isArray(rings) || rings.length === 0 || !rings.every(isRing)) return null;
    return { type: 'Polygon', coordinates: rings };
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates;
    if (!Array.isArray(polygons) || polygons.length === 0 || !polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isRing))) return null;
    return { type: 'MultiPolygon', coordinates: polygons };
  }
  return null;
}

export function isLocalGeoApiConfigured(): boolean {
  if (process.env.GEO_API_ENABLED !== 'true') return false;
  try {
    const url = new URL(process.env.GEO_API_URL || '');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLocalLayerId(value: string): boolean {
  return LAYER_ID.test(value);
}

export function normalizeLocalLayers(value: unknown): LocalLayerMetadata[] | null {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.layers)) return null;

  const layers: LocalLayerMetadata[] = [];
  for (const item of payload.layers) {
    const layer = record(item);
    if (!layer || typeof layer.id !== 'string' || !isLocalLayerId(layer.id) || typeof layer.name !== 'string' || typeof layer.description !== 'string') return null;
    layers.push({ id: layer.id, name: layer.name, description: layer.description, ...optionalLayerGeometry(layer) });
  }
  return layers;
}

export function normalizeLocalFeatureCollection(value: unknown): LocalFeatureCollection | null {
  const payload = record(value);
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) return null;

  const features: LocalFeatureCollection['features'] = [];
  for (const item of payload.features) {
    const feature = record(item);
    const geometry = normalizeGeometry(feature?.geometry);
    const properties = record(feature?.properties);
    if (feature?.type !== 'Feature' || !geometry || !properties) return null;

    const safeProperties: Record<string, string | number | boolean> = {};
    for (const [key, property] of Object.entries(properties)) {
      if (typeof property === 'string' || typeof property === 'boolean' || (typeof property === 'number' && Number.isFinite(property))) safeProperties[key] = property;
    }
    features.push({ type: 'Feature', geometry, properties: safeProperties });
  }
  return { type: 'FeatureCollection', features };
}

export function normalizeLocalFeaturePage(value: unknown): LocalFeaturePage | null {
  const payload = record(value);
  const geojson = normalizeLocalFeatureCollection(value);
  if (!payload || !geojson) return null;
  const nextCursor = typeof payload.next_cursor === 'string' && payload.next_cursor.length > 0 ? payload.next_cursor : null;
  return { geojson, nextCursor };
}

const FEATURE_QUERY_KEYS = ['bbox', 'limit', 'cursor', 'precision', 'simplify'] as const;

/** Forwards only the bounded presentation/query parameters the Geo Hub supports. */
export function buildLocalFeatureQuery(search: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of FEATURE_QUERY_KEYS) {
    const value = search.get(key);
    if (value !== null) query.set(key, value);
  }
  return query.toString();
}

async function fetchGeoApi(path: string): Promise<unknown> {
  const url = new URL(path, `${process.env.GEO_API_URL!.replace(/\/$/, '')}/`);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geo API responded ${response.status}`);
  return response.json();
}

export async function getLocalLayers(): Promise<LocalLayerMetadata[]> {
  const [compat, catalog] = await Promise.all([
    fetchGeoApi('layers'),
    fetchGeoApi('api/v1/layers').catch(() => null),
  ]);
  const layers = normalizeLocalLayers(compat);
  if (!layers) throw new Error('Geo API returned invalid layers');

  const geometry = new Map<string, Pick<LocalLayerMetadata, 'geometryTypes' | 'featureCount'>>();
  if (Array.isArray(catalog)) {
    for (const item of catalog) {
      const layer = record(item);
      if (layer && typeof layer.slug === 'string') geometry.set(layer.slug, optionalLayerGeometry(layer));
    }
  }
  return layers.map((layer) => ({ ...layer, ...geometry.get(layer.id) }));
}

export async function getLocalLayer(id: string): Promise<LocalFeatureCollection> {
  if (!isLocalLayerId(id)) throw new Error('Invalid local layer id');
  const collection = normalizeLocalFeatureCollection(await fetchGeoApi(`layers/${id}`));
  if (!collection) throw new Error('Geo API returned invalid GeoJSON');
  return collection;
}

export async function getLocalLayerFeatures(id: string, search: URLSearchParams): Promise<LocalFeaturePage> {
  if (!isLocalLayerId(id)) throw new Error('Invalid local layer id');
  const query = buildLocalFeatureQuery(search);
  const page = normalizeLocalFeaturePage(await fetchGeoApi(`api/v1/layers/${id}/features${query ? `?${query}` : ''}`));
  if (!page) throw new Error('Geo API returned invalid GeoJSON');
  return page;
}
