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

function absolute(base: string, value?: string) {
  if (!value) return null;
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
  const escaped = key.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&');
  const patterns = [
    new RegExp("<meta[^>]+(?:property|name)=['\\"]" + escaped + "['\\"][^>]+content=['\\"]([^'\\"]+)['\\"]", 'i'),
    new RegExp("<meta[^>]+content=['\\"]([^'\\"]+)['\\"][^>]+(?:property|name)=['\\"]" + escaped + "['\\"]", 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function getAttr(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^$()|[\\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*["\\']([^"\\']+)["\\']', 'i').exec(tag);
  return m?.[1];
}

function tagTitle(tag: string) {
  return decodeHtml(
    (
      getAttr(tag, 'aria-label') ||
      getAttr(tag, 'data-title') ||
      getAttr(tag, 'data-name') ||
      getAttr(tag, 'title') ||
      ''
    ).trim(),
  );
}

function titleFromUrl(url: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    const cleaned = last
      .replace(/\.(mp4|m3u8|mpd)$/i, '')
      .replace(/[-_.]+/g, ' ')
      .replace(/\b\d{8,}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 3 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

function nearby(html: string, needle: string) {
  const index = html.indexOf(needle);
  if (index < 0) return { title: undefined, thumbnail: undefined };
  const chunk = html.slice(Math.max(0, index - 2200), Math.min(html.length, index + needle.length + 900));
  const labelled =
    /(?:data-title|data-name|aria-label|title)=["']([^"']{3,180})["']/i.exec(chunk)?.[1] ||
    /<h[1-4]\b[^>]*>([\s\S]{3,180}?)<\/h[1-4]>/i.exec(chunk)?.[1];
  const image =
    /<img\b[^>]*?(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/i.exec(chunk)?.[1] ||
    /background-image\s*:\s*url\(["']?([^)"']+)["']?\)/i.exec(chunk)?.[1];
  return {
    title: labelled ? decodeHtml(labelled.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : undefined,
    thumbnail: image,
  };
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
  const push = (url: string, title = '', thumb?: string) => {
    const x = absolute(res.url, url);
    if (!x || out.some((v) => v.url === x)) return;

    const context = nearby(html, url);
    const resolvedThumb =
      absolute(res.url, thumb) ||
      absolute(res.url, context.thumbnail) ||
      absolute(res.url, pageThumbnail);

    const resolvedTitle =
      title.trim() ||
      context.title ||
      titleFromUrl(x) ||
      pageTitle ||
      'Video';

    const lower = x.toLowerCase();
    const type = lower.includes('.m3u8')
      ? 'hls'
      : lower.includes('.mpd')
        ? 'dash'
        : lower.includes('.mp4')
          ? 'mp4'
          : 'unknown';

    out.push({
      title: resolvedTitle,
      url: x,
      type,
      thumbnailUrl: resolvedThumb || undefined,
      publishedAt: pagePublishedAt,
    });
  };

  const videoRe = /<video\b[^>]*?(?:src=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/video>/gi;
  let m: RegExpExecArray | null;
  while ((m = videoRe.exec(html))) {
    const tag = m[0];
    const elementTitle = tagTitle(tag);
    const src = m[1] || /(?:data-src|data-video)=["']([^"']+)["']/i.exec(tag)?.[1];
    const poster = getAttr(tag, 'poster') || pageThumbnail;
    if (src) push(src, elementTitle, poster);
    for (const sm of m[2].matchAll(/<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
      push(sm[1], elementTitle, poster);
    }
  }

  for (const key of ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']) {
    const value = metaContent(html, key);
    if (value) push(value, pageTitle, pageThumbnail);
  }

  for (const sm of html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mpd|mp4)(?:\?[^\s"'<>]*)?/gi)) {
    push(sm[0]);
  }

  return out;
}
