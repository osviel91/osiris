import type { LocalFeatureCollection, LocalFeaturePage, LocalLayerMetadata } from './local-geo-api';

export type Bounds = { west: number; south: number; east: number; north: number };

export const VIEWPORT_POINT_MAX_FEATURES = 500;
export const VIEWPORT_PAGE_LIMIT = 500;
export const VIEWPORT_MAX_PAGES = 8;
export const VIEWPORT_BBOX_PADDING = 0.15;
export const VIEWPORT_PRECISION = 6;

/**
 * Small point-only layers keep the whole-layer lazy path. Anything known to be
 * large or non-point is loaded per viewport. Unknown geometry metadata keeps the
 * existing whole-layer behavior.
 */
export function isViewportLayer(metadata: LocalLayerMetadata): boolean {
  const { geometryTypes, featureCount } = metadata;
  if (!geometryTypes || geometryTypes.length === 0) return false;
  if (!geometryTypes.every((type) => type === 'Point')) return true;
  return featureCount === undefined || featureCount > VIEWPORT_POINT_MAX_FEATURES;
}

/** Coarse zoom-derived simplification in WGS84 degrees; 0 disables it. */
export function simplifyForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  if (zoom <= 6) return 0.001;
  if (zoom <= 9) return 0.0001;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Pads the viewport and clamps to valid WGS84; falls back to the world on wrap. */
export function bufferedBbox(bounds: Bounds, padding = VIEWPORT_BBOX_PADDING): Bounds {
  const padLng = (bounds.east - bounds.west) * padding;
  const padLat = (bounds.north - bounds.south) * padding;
  const west = clamp(bounds.west - padLng, -180, 180);
  const east = clamp(bounds.east + padLng, -180, 180);
  const south = clamp(bounds.south - padLat, -90, 90);
  const north = clamp(bounds.north + padLat, -90, 90);
  if (west > east) return { west: -180, south, east: 180, north };
  return { west, south, east, north };
}

export function bboxParam(bounds: Bounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].join(',');
}

export function viewportKey(bounds: Bounds, simplify: number): string {
  return `${bboxParam(bounds)}|${simplify}`;
}

export type ViewportPageLoader = (options: {
  cursor: string | null;
  limit: number;
  signal: AbortSignal;
}) => Promise<LocalFeaturePage>;

export async function loadViewportPages(
  fetchPage: ViewportPageLoader,
  options: { limit?: number; maxPages?: number; signal: AbortSignal },
): Promise<{ geojson: LocalFeatureCollection; pages: number }> {
  const limit = options.limit ?? VIEWPORT_PAGE_LIMIT;
  const maxPages = options.maxPages ?? VIEWPORT_MAX_PAGES;
  const features: LocalFeatureCollection['features'] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await fetchPage({ cursor, limit, signal: options.signal });
    features.push(...page.geojson.features);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < maxPages);
  return { geojson: { type: 'FeatureCollection', features }, pages };
}

export type ViewportLoadResult =
  | { status: 'loaded'; geojson: LocalFeatureCollection }
  | { status: 'skipped' }
  | { status: 'aborted' }
  | { status: 'failed' };

export type ViewportLoadOptions = {
  key: string;
  fetchPage: ViewportPageLoader;
  limit?: number;
  maxPages?: number;
};

/** Serializes viewport loads: skips duplicates, aborts stale requests, ignores late responses. */
export class ViewportLoader {
  private controller: AbortController | null = null;
  private lastKey: string | null = null;
  private version = 0;

  isCurrent(key: string): boolean {
    return key === this.lastKey;
  }

  cancel(): void {
    this.version += 1;
    this.controller?.abort();
    this.controller = null;
    this.lastKey = null;
  }

  async load(options: ViewportLoadOptions): Promise<ViewportLoadResult> {
    if (options.key === this.lastKey) return { status: 'skipped' };

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.lastKey = options.key;
    const version = ++this.version;

    try {
      const { geojson } = await loadViewportPages(options.fetchPage, {
        limit: options.limit,
        maxPages: options.maxPages,
        signal: controller.signal,
      });
      if (version !== this.version) return { status: 'aborted' };
      return { status: 'loaded', geojson };
    } catch (error) {
      if (version === this.version) this.lastKey = null;
      const aborted = error instanceof Error && error.name === 'AbortError';
      return version !== this.version || aborted ? { status: 'aborted' } : { status: 'failed' };
    }
  }
}
