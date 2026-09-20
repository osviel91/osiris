import { describe, expect, it, vi } from 'vitest';
import type { LocalFeatureCollection, LocalFeaturePage, LocalLayerMetadata } from './local-geo-api';
import { bboxParam, bufferedBbox, isViewportLayer, loadViewportPages, shouldStartViewportLoad, simplifyForZoom, ViewportLoader, viewportKey } from './local-layer-viewport';

const pointLayer: LocalLayerMetadata = { id: 'points', name: 'Points', description: '', geometryTypes: ['Point'], featureCount: 12 };
const bigPointLayer: LocalLayerMetadata = { id: 'many', name: 'Many', description: '', geometryTypes: ['Point'], featureCount: 900 };
const areaLayer: LocalLayerMetadata = { id: 'areas', name: 'Areas', description: '', geometryTypes: ['MultiPolygon'], featureCount: 1934 };
const unknownLayer: LocalLayerMetadata = { id: 'test', name: 'Test', description: '' };

function feature(id: string): LocalFeatureCollection['features'][number] {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id } };
}

describe('viewport policy', () => {
  it('keeps small and unknown point layers on the whole-layer path', () => {
    expect(isViewportLayer(pointLayer)).toBe(false);
    expect(isViewportLayer(unknownLayer)).toBe(false);
  });

  it('uses viewport loading for large or non-point layers', () => {
    expect(isViewportLayer(bigPointLayer)).toBe(true);
    expect(isViewportLayer(areaLayer)).toBe(true);
  });

  it('derives simplification from zoom', () => {
    expect(simplifyForZoom(3)).toBe(0.001);
    expect(simplifyForZoom(6)).toBe(0.001);
    expect(simplifyForZoom(8)).toBe(0.0001);
    expect(simplifyForZoom(9)).toBe(0.0001);
    expect(simplifyForZoom(12)).toBe(0);
    expect(simplifyForZoom(Number.NaN)).toBe(0);
  });
});

describe('buffered bbox', () => {
  it('pads and clamps the viewport', () => {
    expect(bufferedBbox({ west: 0, south: 0, east: 10, north: 10 })).toEqual({ west: -1.5, south: -1.5, east: 11.5, north: 11.5 });
    expect(bufferedBbox({ west: -179, south: -89, east: 179, north: 89 })).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });

  it('falls back to the world across the antimeridian', () => {
    expect(bufferedBbox({ west: 170, south: -10, east: -170, north: 10 })).toEqual({ west: -180, south: -13, east: 180, north: 13 });
  });

  it('formats query parameters and keys', () => {
    expect(bboxParam({ west: 1, south: 2, east: 3, north: 4 })).toBe('1,2,3,4');
    expect(viewportKey({ west: 1, south: 2, east: 3, north: 4 }, 0.001)).toBe('1,2,3,4|0.001');
  });
});

describe('page assembly', () => {
  it('follows cursors and accumulates features', async () => {
    const pages: LocalFeaturePage[] = [
      { geojson: { type: 'FeatureCollection', features: [feature('a')] }, nextCursor: 'c1' },
      { geojson: { type: 'FeatureCollection', features: [feature('b')] }, nextCursor: null },
    ];
    const fetchPage = vi.fn(async ({ cursor }: { cursor: string | null }) => pages[cursor ? 1 : 0]);

    const result = await loadViewportPages(fetchPage, { signal: new AbortController().signal });

    expect(result.pages).toBe(2);
    expect(result.geojson.features.map(item => item.properties.id)).toEqual(['a', 'b']);
  });

  it('stops at the page cap', async () => {
    const fetchPage = vi.fn(async (): Promise<LocalFeaturePage> => ({ geojson: { type: 'FeatureCollection', features: [feature('x')] }, nextCursor: 'more' }));

    const result = await loadViewportPages(fetchPage, { maxPages: 3, signal: new AbortController().signal });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.geojson.features).toHaveLength(3);
  });
});

describe('ViewportLoader', () => {
  it('does not replace a request while its layer is loading', () => {
    const loader = new ViewportLoader();

    expect(shouldStartViewportLoad({ enabled: true, loading: false }, loader, 'a')).toBe(true);
    expect(shouldStartViewportLoad({ enabled: true, loading: true }, loader, 'b')).toBe(false);
    expect(shouldStartViewportLoad({ enabled: false, loading: false }, loader, 'c')).toBe(false);
  });

  it('skips an identical in-flight key', async () => {
    const loader = new ViewportLoader();
    const page: LocalFeaturePage = { geojson: { type: 'FeatureCollection', features: [feature('a')] }, nextCursor: null };

    const first = loader.load({ key: 'k', fetchPage: async () => page });
    const second = loader.load({ key: 'k', fetchPage: async () => page });

    expect((await second).status).toBe('skipped');
    expect((await first).status).toBe('loaded');
  });

  it('aborts stale requests and keeps only the newest result', async () => {
    const loader = new ViewportLoader();
    const make = (id: string, delay: number, signal: AbortSignal) => new Promise<LocalFeaturePage>((resolve, reject) => {
      const timer = setTimeout(() => resolve({ geojson: { type: 'FeatureCollection', features: [feature(id)] }, nextCursor: null }), delay);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });

    const first = loader.load({ key: 'k1', fetchPage: ({ signal }) => make('a', 20, signal) });
    const second = loader.load({ key: 'k2', fetchPage: ({ signal }) => make('b', 0, signal) });

    expect((await first).status).toBe('aborted');
    expect((await second).status).toBe('loaded');
    expect(loader.isCurrent('k2')).toBe(true);
  });

  it('waits for every page before reporting loaded', async () => {
    const loader = new ViewportLoader();
    const fetchPage = vi.fn(({ cursor }: { cursor: string | null }): Promise<LocalFeaturePage> => Promise.resolve(cursor
      ? { geojson: { type: 'FeatureCollection', features: [feature('b')] }, nextCursor: null }
      : { geojson: { type: 'FeatureCollection', features: [feature('a')] }, nextCursor: 'next' }));

    const result = await loader.load({ key: 'multi', fetchPage });

    expect(result).toEqual({ status: 'loaded', geojson: { type: 'FeatureCollection', features: [feature('a'), feature('b')] } });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale completion control the current request', async () => {
    const loader = new ViewportLoader();
    let releaseOld!: (page: LocalFeaturePage) => void;
    const old = loader.load({ key: 'old', fetchPage: () => new Promise(resolve => { releaseOld = resolve; }) });
    const current = loader.load({ key: 'current', fetchPage: async () => ({ geojson: { type: 'FeatureCollection', features: [feature('current')] }, nextCursor: null }) });

    expect((await current).status).toBe('loaded');
    releaseOld({ geojson: { type: 'FeatureCollection', features: [feature('old')] }, nextCursor: null });
    expect((await old).status).toBe('aborted');
    expect(loader.isCurrent('current')).toBe(true);
  });

  it('reports a failed page after preserving responsibility for cached data to the caller', async () => {
    const loader = new ViewportLoader();
    const result = await loader.load({ key: 'error', fetchPage: async () => { throw new Error('offline'); } });

    expect(result.status).toBe('failed');
    expect(loader.isCurrent('error')).toBe(false);
  });

  it('handles rapid viewport changes without allowing an older request to win', async () => {
    const loader = new ViewportLoader();
    const loads = ['a', 'b', 'c'].map((key, index) => loader.load({
      key,
      fetchPage: ({ signal }) => new Promise<LocalFeaturePage>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ geojson: { type: 'FeatureCollection', features: [feature(key)] }, nextCursor: null }), index === 2 ? 0 : 10);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      }),
    }));

    expect((await Promise.all(loads)).map(result => result.status)).toEqual(['aborted', 'aborted', 'loaded']);
    expect(loader.isCurrent('c')).toBe(true);
  });

  it('reports failure and allows a retry', async () => {
    const loader = new ViewportLoader();

    const failing = await loader.load({ key: 'k', fetchPage: async () => { throw new Error('boom'); } });
    expect(failing.status).toBe('failed');

    const retry = await loader.load({ key: 'k', fetchPage: async () => ({ geojson: { type: 'FeatureCollection', features: [feature('a')] }, nextCursor: null }) });
    expect(retry.status).toBe('loaded');
  });

  it('clears state on cancel', async () => {
    const loader = new ViewportLoader();
    const pending = loader.load({ key: 'k', fetchPage: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))) });

    loader.cancel();

    expect((await pending).status).toBe('aborted');
    expect(loader.isCurrent('k')).toBe(false);
  });
});
