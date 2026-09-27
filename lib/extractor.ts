import { safeFetchText, assertSafeUrl } from '@/lib/security';

export type ExtractedVideo = {
  title: string;
  url: string;
  type: 'mp4' | 'hls' | 'dash' | 'webm' | 'ogg' | 'unknown';
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
  const patterns = [
    new RegExp("<meta[^>]+(?:property|name)=['\\x22]" + key + "['\\x22][^>]+content=['\\x22]([^'\\x22]+)['\\x22]", 'i'),
    new RegExp("<meta[^>]+content=['\\x22]([^'\\x22]+)['\\x22][^>]+(?:property|name)=['\\x22]" + key + "['\\x22]", 'i'),
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


function decodeScriptValue(value: string) {
  return decodeHtml(
    value
      .replace(/\\\//g, '/')
      .replace(/\\u002f/gi, '/')
      .replace(/\\u003a/gi, ':')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003f/gi, '?')
      .replace(/\\u003d/gi, '=')
      .replace(/\\u0025/gi, '%'),
  );
}

function getAttr(tag: string, name: string) {
  const m = new RegExp(name + '\\s*=\\s*[\\x22\\x27]([^\\x22\\x27]+)[\\x22\\x27]', 'i').exec(tag);
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
      .replace(/\.(mp4|m3u8|mpd|webm|ogg)$/i, '')
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
  const values = [needle, decodeScriptValue(needle)];
  let index = -1;
  for (const value of values) {
    index = html.indexOf(value);
    if (index >= 0) break;
  }
  if (index < 0) return { title: undefined, thumbnail: undefined };

  const chunk = html.slice(Math.max(0, index - 4000), Math.min(html.length, index + needle.length + 2200));
  const labelled =
    /(?:data-title|data-name|data-label|aria-label|title|alt)=["']([^"']{3,180})["']/i.exec(chunk)?.[1] ||
    /<h[1-4]\b[^>]*>([\s\S]{3,220}?)<\/h[1-4]>/i.exec(chunk)?.[1] ||
    /["'](?:title|name|label|videoTitle|displayTitle)["']\s*:\s*["']([^"']{3,220})["']/i.exec(chunk)?.[1];
  const image =
    /<img\b[^>]*?(?:src|data-src|data-original|data-lazy-src|data-thumb|data-thumbnail|poster)=["']([^"']+)["'][^>]*>/i.exec(chunk)?.[1] ||
    /["'](?:thumbnail|thumbnailUrl|poster|posterUrl|image|imageUrl|thumb|thumbUrl)["']\s*:\s*["']([^"']+)["']/i.exec(chunk)?.[1];
  return {
    title: labelled ? decodeHtml(labelled.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : undefined,
    thumbnail: image ? decodeScriptValue(image.trim()) : undefined,
  };
}

function mediaType(url: string): ExtractedVideo['type'] {
  const lower = url.toLowerCase();
  if (/\.m3u8(?:$|\?)/i.test(lower)) return 'hls';
  if (/\.mpd(?:$|\?)/i.test(lower)) return 'dash';
  if (/\.mp4(?:$|\?)/i.test(lower)) return 'mp4';
  if (/\.webm(?:$|\?)/i.test(lower)) return 'webm';
  if (/\.ogg(?:$|\?)/i.test(lower)) return 'ogg';
  return 'unknown';
}

function extractMediaUrls(text: string) {
  const out: string[] = [];
  const add = (raw: string) => {
    const value = decodeScriptValue(raw.trim());
    if (/\.(?:m3u8|mpd|mp4|webm|ogg)(?:[?#]|$)/i.test(value)) out.push(value);
  };
  for (const m of text.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mpd|mp4|webm|ogg)(?:\?[^\s"'<>]*)?/gi)) add(m[0]);
  for (const m of text.matchAll(/["']((?:https?:\/\/|\/\/|\/|\.\/|\.\.\/)[^"'<>\\s]+\.(?:m3u8|mpd|mp4|webm|ogg)(?:\?[^"'<>\\s]*)?)/gi)) add(m[1]);
  const decoded = text.replace(/\\\//g, '/');
  if (decoded !== text) {
    for (const m of decoded.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mpd|mp4|webm|ogg)(?:\?[^\s"'<>]*)?/gi)) add(m[0]);
  }
  return [...new Set(out)];
}

function extractScriptUrls(html: string, baseUrl: string) {
  const urls: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(baseUrl, decodeScriptValue(m[1]));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 16);
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

  const texts = [html];
  const pageOrigin = new URL(res.url).origin;

  // Some players, including common HLS demos, pass the manifest in the page URL
  // (for example ?src=<manifest>) and populate the player after JavaScript runs.
  // Treat those explicit media-looking query parameters as scanner inputs too.
  const pageQuery = new URL(res.url).searchParams;
  for (const key of ['src', 'source', 'stream', 'video', 'manifest', 'playlist', 'url']) {
    const value = pageQuery.get(key);
    if (value && /(?:\.m3u8|\.mpd|\.mp4|\.webm|\.ogg)(?:[?#]|$)/i.test(value)) {
      texts.push(value);
    }
  }

  // Follow a small number of same-origin iframes. This covers preview/player
  // pages whose actual <video> element lives inside a nested document.
  const iframeUrls = [...html.matchAll(/<iframe\\b[^>]+src=["']([^"']+)["'][^>]*>/gi)]
    .map((m) => absolute(res.url, decodeScriptValue(m[1])))
    .filter((u): u is string => !!u && new URL(u).origin === pageOrigin)
    .slice(0, 4);

  for (const iframeUrl of iframeUrls) {
    try {
      const frame = await safeFetchText(iframeUrl);
      if (frame.response.ok && frame.text.length <= 4_000_000) {
        texts.push(frame.text);
        const frameQuery = new URL(frame.url).searchParams;
        for (const key of ['src', 'source', 'stream', 'video', 'manifest', 'playlist', 'url']) {
          const value = frameQuery.get(key);
          if (value && /(?:\.m3u8|\.mpd|\.mp4|\.webm|\.ogg)(?:[?#]|$)/i.test(value)) {
            texts.push(value);
          }
        }
      }
    } catch {
      // A broken iframe must not invalidate the parent source scan.
    }
  }

  const scriptUrls = extractScriptUrls(html, res.url);
  for (const scriptUrl of scriptUrls) {
    try {
      if (new URL(scriptUrl).origin !== pageOrigin) continue;
      const script = await safeFetchText(scriptUrl);
      if (script.response.ok && script.text.length <= 2_000_000) texts.push(script.text);
    } catch {}
  }

  const out: ExtractedVideo[] = [];
  const seen = new Set<string>();
  const push = (url: string, title = '', thumb?: string, contextHtml = html) => {
    const x = absolute(res.url, url);
    if (!x || seen.has(x)) return;
    seen.add(x);

    const context = nearby(contextHtml, url);
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
    const poster = getAttr(tag, 'poster') || getAttr(tag, 'data-poster') || pageThumbnail;
    if (src) push(src, elementTitle, poster);
    for (const sm of m[2].matchAll(/<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
      push(sm[1], elementTitle, poster);
    }
  }

  for (const key of ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']) {
    const value = metaContent(html, key);
    if (value) push(value, pageTitle, pageThumbnail);
  }

  for (const text of texts) {
    for (const url of extractMediaUrls(text)) {
      push(url, '', undefined, text);
    }
  }

  return out;
}
