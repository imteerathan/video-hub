import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { scanSource } from '@/lib/scanner';
import { rateLimit } from '@/lib/rate-limit';

export async function POST() {
  try {
    const user = await requireUser();
    const rl = rateLimit('scan-all-sources:' + user.id, 4, 60 * 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Scan All rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter), 'Cache-Control': 'no-store' } },
      );
    }

    const sources = await db.source.findMany({
      where: { userId: user.id, enabled: true },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    let cursor = 0;
    const concurrency = Math.max(1, Math.min(3, Number(process.env.SCAN_MAX_CONCURRENCY) || 2));

    async function worker() {
      while (cursor < sources.length) {
        const index = cursor++;
        const source = sources[index];
        try {
          await scanSource(source.id, user.id);
        } catch {
          // Per-source failures are written into that source's scan status and do not stop the batch.
        }
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(concurrency, sources.length) }, () => worker()),
    ).catch(() => {});

    return NextResponse.json(
      { queued: sources.length, sources, concurrency },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scan All failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 400 });
  }
}
