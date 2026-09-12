import { NextResponse } from 'next/server';
import { getLocalLayers, isLocalGeoApiConfigured } from '@/lib/local-geo-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isLocalGeoApiConfigured()) return NextResponse.json({ enabled: false, layers: [] });
  try {
    return NextResponse.json({ enabled: true, layers: await getLocalLayers() });
  } catch {
    return NextResponse.json({ enabled: true, layers: [], error: 'Local data unavailable' }, { status: 502 });
  }
}
