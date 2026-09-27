'use client';

import { useEffect, useRef, useState } from 'react';

export default function ClipThumbnail({
  src,
  type,
  thumbnail,
}: {
  src?: string | null;
  type?: string | null;
  thumbnail?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(Boolean(thumbnail));

  useEffect(() => {
    if (thumbnail || !host.current || !src) return;
    const node = host.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '220px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbnail, src]);

  const playable = /^(mp4|webm|ogg)$/i.test(type || '') || /\.(mp4|webm|ogg)(?:[?#]|$)/i.test(src || '');

  return (
    <div ref={host} className="clip-thumb">
      {thumbnail ? (
        <img className="poster-img" src={thumbnail} alt="" loading="lazy" />
      ) : visible && playable && src ? (
        <video
          className="poster-img"
          src={src}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            try {
              if (video.duration > 0.15) video.currentTime = 0.15;
            } catch {}
          }}
        />
      ) : (
        <div className="poster-fallback">▶</div>
      )}
    </div>
  );
}
