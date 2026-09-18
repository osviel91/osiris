import { describe, expect, it } from 'vitest';
import type { LocalFeatureCollection } from './local-geo-api';
import { localGeometryFamilies, localRenderLayers } from './local-layer-render';

const point = (): LocalFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-3.7, 40.4] }, properties: { name: 'p' } }],
});
const polygon = (): LocalFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]] }, properties: { name: 'a' } }],
});
const multiPolygon = (): LocalFeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]]] }, properties: { name: 'm' } }],
});
const polygonFilter = ['==', ['geometry-type'], 'Polygon'];

describe('local layer rendering', () => {
  it('renders point layers as a single circle layer', () => {
    const layers = localRenderLayers('points', point());

    expect(layers.map(layer => [layer.id, layer.type])).toEqual([['local-data-points-circle', 'circle']]);
    expect(layers[0].filter).toEqual(['==', ['geometry-type'], 'Point']);
  });

  it('renders polygon layers as fill plus outline', () => {
    const layers = localRenderLayers('areas', polygon());

    expect(layers.map(layer => [layer.id, layer.type])).toEqual([
      ['local-data-areas-fill', 'fill'],
      ['local-data-areas-outline', 'line'],
    ]);
    expect(layers.every(layer => JSON.stringify(layer.filter) === JSON.stringify(polygonFilter))).toBe(true);
  });

  it('treats MultiPolygon as the polygon family', () => {
    expect(localRenderLayers('areas', multiPolygon()).map(layer => layer.id)).toEqual([
      'local-data-areas-fill',
      'local-data-areas-outline',
    ]);
  });

  it('renders mixed collections per geometry family', () => {
    const mixed: LocalFeatureCollection = { type: 'FeatureCollection', features: [...point().features, ...polygon().features] };

    expect(localGeometryFamilies(mixed)).toEqual(['point', 'polygon']);
    expect(localRenderLayers('mixed', mixed).map(layer => layer.type)).toEqual(['circle', 'fill', 'line']);
  });
});
