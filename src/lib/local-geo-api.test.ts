import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLocalFeatureQuery, getLocalLayer, getLocalLayerFeatures, getLocalLayers, isLocalLayerId, normalizeLocalFeatureCollection, normalizeLocalFeaturePage, normalizeLocalLayers } from './local-geo-api';
import { GET as listLayers } from '@/app/api/local-layers/route';
import { GET as getLayer } from '@/app/api/local-layers/[id]/route';

const layersFixture = {
  layers: [{ id: 'aemet', name: 'AEMET stations', description: 'Backend-provided weather stations', endpoint: '/layers/aemet' }],
};

const catalogFixture = [{ slug: 'aemet', geometry_types: ['Point'], feature_count: 3 }];

const featureFixture = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.7038, 40.4168] }, properties: { id: 'station-1', name: 'Madrid station', source: 'aemet', category: 'weather', status: 'online' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.1734, 41.3851] }, properties: { id: 'station-2', name: 'Barcelona station', source: 'aemet', category: 'weather', status: 'online' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-0.3763, 39.4699] }, properties: { id: 'station-3', name: 'Valencia station', source: 'aemet', category: 'weather', status: 'online' } },
  ],
};

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEO_API_ENABLED;
  delete process.env.GEO_API_URL;
});

describe('local Geo API validation', () => {
  it('normalizes the live layer metadata fixture', () => {
    expect(normalizeLocalLayers(layersFixture)).toEqual([{ id: 'aemet', name: 'AEMET stations', description: 'Backend-provided weather stations' }]);
  });

  it('supports zero, one, and multiple backend-provided layers', () => {
    expect(normalizeLocalLayers({ layers: [] })).toEqual([]);
    expect(normalizeLocalLayers(layersFixture)).toHaveLength(1);
    expect(normalizeLocalLayers({ layers: [layersFixture.layers[0], { id: 'amateur-radio', name: 'Amateur radio', description: 'Backend-provided radio stations' }] })).toHaveLength(2);
  });

  it('does not expose the legacy test layer from the compatibility response', async () => {
    process.env.GEO_API_ENABLED = 'true';
    process.env.GEO_API_URL = 'http://geo-api:8000';
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ layers: [{ id: 'test', name: 'Test Layer', description: 'Legacy fixture' }, ...layersFixture.layers] }))
      .mockResolvedValueOnce(response(catalogFixture)));

    expect(await getLocalLayers()).toEqual([{ id: 'aemet', name: 'AEMET stations', description: 'Backend-provided weather stations', geometryTypes: ['Point'], featureCount: 3 }]);
  });

  it('accepts the live GeoJSON fixture and strips unsafe properties', () => {
    const payload = {
      ...featureFixture,
      features: [{
        ...featureFixture.features[0],
        properties: { ...featureFixture.features[0].properties, extra: { nested: true }, empty: null },
      }, ...featureFixture.features.slice(1)],
    };
    expect(normalizeLocalFeatureCollection(payload)?.features[0].properties).toEqual({ id: 'station-1', name: 'Madrid station', source: 'aemet', category: 'weather', status: 'online' });
  });

  it('rejects malformed layers and unsupported GeoJSON', () => {
    expect(normalizeLocalLayers({ layers: [{ id: '../test', name: 'X', description: 'X' }] })).toBeNull();
    expect(normalizeLocalLayers({ layers: [{ name: 'X', description: 'X' }] })).toBeNull();
    expect(normalizeLocalFeatureCollection({ ...featureFixture, features: [{ ...featureFixture.features[0], geometry: { type: 'LineString', coordinates: [] } }] })).toBeNull();
  });

  it('accepts Polygon and MultiPolygon geometries', () => {
    const polygon = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]] }, properties: { name: 'area' } };
    const multiPolygon = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]]] }, properties: { name: 'multi' } };
    const normalized = normalizeLocalFeatureCollection({ type: 'FeatureCollection', features: [polygon, multiPolygon] });

    expect(normalized?.features.map(feature => feature.geometry.type)).toEqual(['Polygon', 'MultiPolygon']);
    expect(normalized?.features[0].geometry).toEqual(polygon.geometry);
  });

  it('rejects malformed polygons and out-of-range positions', () => {
    const feature = (geometry: unknown) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }] });
    const ring = [[-3.7, 40.4], [-3.6, 40.4], [-3.7, 40.4]];

    expect(normalizeLocalFeatureCollection(feature({ type: 'Polygon', coordinates: [ring] }))).toBeNull();
    expect(normalizeLocalFeatureCollection(feature({ type: 'Polygon', coordinates: [[[-200, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-200, 40.4]]] }))).toBeNull();
    expect(normalizeLocalFeatureCollection(feature({ type: 'MultiPolygon', coordinates: [] }))).toBeNull();
  });

  it('only accepts safe layer identifiers', () => {
    expect(isLocalLayerId('test_1-a')).toBe(true);
    expect(isLocalLayerId('../test')).toBe(false);
  });
});

describe('local Geo API routes', () => {
  it('degrades to an empty list while disabled', async () => {
    const result = await listLayers();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ enabled: false, layers: [] });
  });

  it('fetches normalized list and layer data only from the configured API', async () => {
    process.env.GEO_API_ENABLED = 'true';
    process.env.GEO_API_URL = 'http://geo-api:8000';
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(layersFixture))
      .mockResolvedValueOnce(response(catalogFixture))
      .mockResolvedValueOnce(response(featureFixture));
    vi.stubGlobal('fetch', fetch);

    expect(await getLocalLayers()).toEqual([{ id: 'aemet', name: 'AEMET stations', description: 'Backend-provided weather stations', geometryTypes: ['Point'], featureCount: 3 }]);
    expect(await getLocalLayer('aemet')).toEqual(featureFixture);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['http://geo-api:8000/layers', 'http://geo-api:8000/api/v1/layers', 'http://geo-api:8000/layers/aemet']);
  });

  it('degrades to compat metadata when the catalog is unavailable', async () => {
    process.env.GEO_API_ENABLED = 'true';
    process.env.GEO_API_URL = 'http://geo-api:8000';
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(layersFixture))
      .mockResolvedValueOnce(response({ error: 'missing' }, false)));

    expect(await getLocalLayers()).toEqual([{ id: 'aemet', name: 'AEMET stations', description: 'Backend-provided weather stations' }]);
  });

  it('returns controlled errors for failures and invalid ids', async () => {
    process.env.GEO_API_ENABLED = 'true';
    process.env.GEO_API_URL = 'http://geo-api:8000';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect((await listLayers()).status).toBe(502);
    expect((await getLayer(new Request('http://osiris/api/local-layers/../test'), { params: Promise.resolve({ id: '../test' }) })).status).toBe(400);
  });
});

describe('local feature pages', () => {
  it('normalizes feature pages and rejects invalid payloads', () => {
    expect(normalizeLocalFeaturePage({ ...featureFixture, next_cursor: 'abc' })?.nextCursor).toBe('abc');
    expect(normalizeLocalFeaturePage(featureFixture)?.nextCursor).toBeNull();
    expect(normalizeLocalFeaturePage({ type: 'FeatureCollection', features: 'nope' })).toBeNull();
  });

  it('builds a whitelisted feature query', () => {
    const query = new URLSearchParams(buildLocalFeatureQuery(new URLSearchParams('bbox=1,2,3,4&limit=10&cursor=abc&precision=6&simplify=0.001&evil=1&status=archived')));

    expect([...query.keys()].sort()).toEqual(['bbox', 'cursor', 'limit', 'precision', 'simplify']);
    expect(query.has('evil')).toBe(false);
    expect(query.has('status')).toBe(false);
  });

  it('fetches a feature page through the bounded endpoint', async () => {
    process.env.GEO_API_ENABLED = 'true';
    process.env.GEO_API_URL = 'http://geo-api:8000';
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...featureFixture, next_cursor: 'next' }));
    vi.stubGlobal('fetch', fetch);

    const page = await getLocalLayerFeatures('aemet', new URLSearchParams('bbox=1,2,3,4&limit=500&precision=6&simplify=0.001&evil=1'));
    expect(page.nextCursor).toBe('next');
    expect(page.geojson.features).toHaveLength(3);

    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v1/layers/aemet/features');
    expect(url.searchParams.get('bbox')).toBe('1,2,3,4');
    expect(url.searchParams.get('precision')).toBe('6');
    expect(url.searchParams.has('evil')).toBe(false);
  });
});
