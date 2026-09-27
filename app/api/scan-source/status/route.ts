import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getScanStatus } from '@/lib/scan-status';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sourceId = new URL(req.url).searchParams.get('sourceId');
    if (!sourceId) return NextResponse.json({ error: 'sourceId required' }, { status: 400 });
    return NextResponse.json(
      { status: getScanStatus(user.id, sourceId) },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to read scan status';
    return NextResponse.json({ error: m }, { status: m === 'UNAUTHENTICATED' ? 401 : 400 });
  }
}
