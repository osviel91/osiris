export type LocalLayerMetadata = {
  id: string;
  name: string;
  description: string;
};

export type LocalFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, string | number | boolean>;
  }>;
};

const LAYER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
    layers.push({ id: layer.id, name: layer.name, description: layer.description });
  }
  return layers;
}

export function normalizeLocalFeatureCollection(value: unknown): LocalFeatureCollection | null {
  const payload = record(value);
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) return null;

  const features: LocalFeatureCollection['features'] = [];
  for (const item of payload.features) {
    const feature = record(item);
    const geometry = record(feature?.geometry);
    const properties = record(feature?.properties);
    const coordinates = geometry?.coordinates;
    if (feature?.type !== 'Feature' || geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length !== 2 || !properties) return null;
    const [lng, lat] = coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

    const safeProperties: Record<string, string | number | boolean> = {};
    for (const [key, property] of Object.entries(properties)) {
      if (typeof property === 'string' || typeof property === 'boolean' || (typeof property === 'number' && Number.isFinite(property))) safeProperties[key] = property;
    }
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: safeProperties });
  }
  return { type: 'FeatureCollection', features };
}

async function fetchGeoApi(path: string): Promise<unknown> {
  const url = new URL(path, `${process.env.GEO_API_URL!.replace(/\/$/, '')}/`);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geo API responded ${response.status}`);
  return response.json();
}

export async function getLocalLayers(): Promise<LocalLayerMetadata[]> {
  const layers = normalizeLocalLayers(await fetchGeoApi('layers'));
  if (!layers) throw new Error('Geo API returned invalid layers');
  return layers;
}

export async function getLocalLayer(id: string): Promise<LocalFeatureCollection> {
  if (!isLocalLayerId(id)) throw new Error('Invalid local layer id');
  const collection = normalizeLocalFeatureCollection(await fetchGeoApi(`layers/${id}`));
  if (!collection) throw new Error('Geo API returned invalid GeoJSON');
  return collection;
}
