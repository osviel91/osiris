import { NextResponse } from 'next/server';
import { getLocalLayer, isLocalGeoApiConfigured, isLocalLayerId } from '@/lib/local-geo-api';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isLocalGeoApiConfigured()) return NextResponse.json({ error: 'Local data unavailable' }, { status: 503 });
  if (!isLocalLayerId(id)) return NextResponse.json({ error: 'Invalid local layer' }, { status: 400 });
  try {
    return NextResponse.json(await getLocalLayer(id));
  } catch {
    return NextResponse.json({ error: 'Local data unavailable' }, { status: 502 });
  }
}
