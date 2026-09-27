import { safeFetchText, assertSafeUrl } from '@/lib/security';

export type ExtractedVideo = {
  title: string;
  url: string;
  type: 'mp4' | 'hls' | 'dash' | 'unknown';
  thumbnailUrl?: string;
  duration?: number;
  resolution?: string;
  publishedAt?: string;
};

export type ExtractProgress = (event: {
  phase: 'fetching' | 'extracting';
  message: string;
}) => void;

function absolute(base: string, value: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function dateFromHtml(html: string) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate)["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const r of patterns) {
    const m = r.exec(html);
    if (m && Number.isFinite(Date.parse(m[1]))) return new Date(m[1]).toISOString();
  }
  return undefined;
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + escaped + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
    new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + escaped + '["\']', 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export async function extractPublicVideoSources(
  pageUrl: string,
  onProgress?: ExtractProgress,
): Promise<ExtractedVideo[]> {
  onProgress?.({ phase: 'fetching', message: 'Opening source and downloading HTML…' });
  await assertSafeUrl(pageUrl);
  const res = await safeFetchText(pageUrl);
  if (!res.response.ok) throw new Error('Source returned HTTP ' + res.response.status);
  const html = res.text;
  if (html.length > 8_000_000) throw new Error('Source page is too large');

  onProgress?.({
    phase: 'extracting',
    message: 'HTML loaded. Looking for direct video, HLS, and DASH sources…',
  });

  const pagePublishedAt = dateFromHtml(html);
  const pageTitle =
    metaContent(html, 'og:title') ||
    metaContent(html, 'twitter:title') ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ||
    'Video';
  const pageThumbnail =
    metaContent(html, 'og:image') ||
    metaContent(html, 'twitter:image') ||
    undefined;

  const out: ExtractedVideo[] = [];
  const push = (url: string, title: string, thumb?: string) => {
    const x = absolute(res.url, url);
    if (!x) return;
    const lower = x.toLowerCase();
    const type = lower.includes('.m3u8')
      ? 'hls'
      : lower.includes('.mpd')
        ? 'dash'
        : lower.includes('.mp4')
          ? 'mp4'
          : 'unknown';
    if (!out.some((v) => v.url === x)) {
      out.push({
        title: title || pageTitle || 'Video',
        url: x,
        type,
        thumbnailUrl: absolute(res.url, thumb || '') || pageThumbnail,
        publishedAt: pagePublishedAt,
      });
    }
  };

  const videoRe = /<video\b[^>]*?(?:src=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/video>/gi;
  let m: RegExpExecArray | null;
  while ((m = videoRe.exec(html))) {
    const tag = m[0];
    const src =
      m[1] ||
      /(?:data-src|data-video)["']?\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const poster = /poster=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) push(src, pageTitle, poster || pageThumbnail);
    for (const sm of m[2].matchAll(/<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
      push(sm[1], pageTitle, poster || pageThumbnail);
    }
  }

  for (const key of ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']) {
    const value = metaContent(html, key);
    if (value) push(value, pageTitle, pageThumbnail);
  }

  for (const sm of html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mpd|mp4)(?:\?[^\s"'<>]*)?/gi)) {
    push(sm[0], pageTitle, pageThumbnail);
  }

  return out;
}
