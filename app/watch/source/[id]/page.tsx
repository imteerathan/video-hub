import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import Player from '../../[id]/Player';

export default async function WatchSource({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const src = await db.videoSource.findFirst({
    where: { id, source: { userId: user.id } },
    include: {
      source: true,
      content: true,
      tracks: true,
      episode: { include: { season: { include: { content: true } } } },
    },
  });
  if (!src) return notFound();

  const title = src.episode
    ? src.episode.season.content.title + ' · S' + src.episode.season.number + ' E' + src.episode.number + ' · ' + src.episode.title
    : src.title || src.content?.title || 'Video';

  return (
    <main className="container">
      <p className="muted">{src.source.name}</p>
      <Player
        title={title}
        sources={[{
          id: src.id,
          url: src.url,
          type: src.type,
          title: src.title,
          resolution: src.resolution,
          tracks: src.tracks,
        }]}
      />
    </main>
  );
}
