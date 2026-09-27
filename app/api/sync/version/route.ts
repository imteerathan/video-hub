import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await requireUser();

    const [
      sourceCount,
      contentCount,
      videoSourceCount,
      categoryCount,
      ruleCount,
      latestSource,
      latestContent,
      latestVideoSource,
      latestCategory,
      latestRule,
    ] = await Promise.all([
      db.source.count({ where: { userId: user.id } }),
      db.content.count({ where: { userId: user.id } }),
      db.videoSource.count({ where: { source: { userId: user.id } } }),
      db.category.count({ where: { userId: user.id } }),
      db.searchRule.count({ where: { userId: user.id } }),
      db.source.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      db.content.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      db.videoSource.findFirst({ where: { source: { userId: user.id } }, orderBy: { discoveredAt: 'desc' }, select: { discoveredAt: true } }),
      db.category.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.searchRule.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);

    const stamps = [
      latestSource?.updatedAt?.getTime() || 0,
      latestContent?.updatedAt?.getTime() || 0,
      latestVideoSource?.discoveredAt?.getTime() || 0,
      latestCategory?.createdAt?.getTime() || 0,
      latestRule?.updatedAt?.getTime() || 0,
    ].join('-');

    return NextResponse.json(
      {
        version: [sourceCount, contentCount, videoSourceCount, categoryCount, ruleCount, stamps].join('|'),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync check failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 400 });
  }
}
