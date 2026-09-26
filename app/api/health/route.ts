import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, service: 'video-hub' });
  } catch {
    return NextResponse.json({ ok: false, service: 'video-hub' }, { status: 503 });
  }
}
