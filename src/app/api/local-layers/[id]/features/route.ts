import { NextResponse } from 'next/server';

import { getLocalLayerFeatures, isLocalGeoApiConfigured, isLocalLayerId } from '@/lib/local-geo-api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isLocalGeoApiConfigured()) {
    return NextResponse.json({ error: 'Local data unavailable' }, { status: 503 });
  }
  if (!isLocalLayerId(id)) {
    return NextResponse.json({ error: 'Invalid local layer' }, { status: 400 });
  }
  try {
    const search = new URL(request.url).searchParams;
    return NextResponse.json(await getLocalLayerFeatures(id, search));
  } catch {
    return NextResponse.json({ error: 'Local data unavailable' }, { status: 502 });
  }
}
