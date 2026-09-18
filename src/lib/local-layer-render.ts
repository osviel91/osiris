import type { FilterSpecification } from 'maplibre-gl';
import type { LocalFeatureCollection } from './local-geo-api';

export const LOCAL_LAYER_COLOR = '#8B5CF6';

/** Render layer suffixes owned by one local Geo Hub layer. */
export const LOCAL_LAYER_SUFFIXES = ['circle', 'fill', 'outline'] as const;

export type LocalGeometryFamily = 'point' | 'polygon';

export type LocalRenderLayer = {
  id: string;
  type: 'circle' | 'fill' | 'line';
  filter: FilterSpecification;
  paint: Record<string, unknown>;
};

const POINT_FILTER: FilterSpecification = ['==', ['geometry-type'], 'Point'];
// MapLibre collapses Polygon and MultiPolygon to the "Polygon" geometry type.
const POLYGON_FILTER: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];

/** Families actually present in a collection; mixed collections yield both. */
export function localGeometryFamilies(geojson: LocalFeatureCollection): LocalGeometryFamily[] {
  const families = new Set<LocalGeometryFamily>();
  for (const feature of geojson.features) {
    families.add(feature.geometry.type === 'Point' ? 'point' : 'polygon');
  }
  return [...families];
}

export function localRenderLayers(id: string, geojson: LocalFeatureCollection): LocalRenderLayer[] {
  const sourceId = `local-data-${id}`;
  const layers: LocalRenderLayer[] = [];
  for (const family of localGeometryFamilies(geojson)) {
    if (family === 'point') {
      layers.push({
        id: `${sourceId}-circle`,
        type: 'circle',
        filter: POINT_FILTER,
        paint: {
          'circle-color': LOCAL_LAYER_COLOR,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 4, 14, 7, 18, 10],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#F5F3FF',
          'circle-opacity': 0.9,
        },
      });
    } else {
      layers.push(
        {
          id: `${sourceId}-fill`,
          type: 'fill',
          filter: POLYGON_FILTER,
          paint: { 'fill-color': LOCAL_LAYER_COLOR, 'fill-opacity': 0.25 },
        },
        {
          id: `${sourceId}-outline`,
          type: 'line',
          filter: POLYGON_FILTER,
          paint: { 'line-color': LOCAL_LAYER_COLOR, 'line-width': 1.5, 'line-opacity': 0.9 },
        },
      );
    }
  }
  return layers;
}
