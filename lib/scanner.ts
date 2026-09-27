import { db } from '@/lib/db';
import { extractPublicVideoSources } from '@/lib/extractor';
import { createHash } from 'node:crypto';
import { normalizeTitle, parseEpisodeTitle } from '@/lib/content-matcher';
import { logError, logEvent } from '@/lib/logger';
import {
  failScanStatus,
  finishScanStatus,
  setScanStatus,
  startScanStatus,
} from '@/lib/scan-status';

function normalize(s: string) {
  return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function terms(keywords: string) {
  return keywords.split(',').map((x) => normalize(x)).filter(Boolean);
}

function matches(text: string, rule: { mode: string; keywords: string }) {
  const hay = normalize(text);
  const ks = terms(rule.keywords);
  if (!ks.length) return false;
  if (rule.mode === 'PHRASE') return hay.includes(ks[0]);
  if (rule.mode === 'ALL') return ks.every((k) => hay.includes(k));
  return ks.some((k) => hay.includes(k));
}

function fingerprint(sourceId: string, url: string, title: string) {
  return createHash('sha256').update(sourceId + '|' + url + '|' + title).digest('hex');
}

function inferContentType(categoryNames: string[], parsed: boolean) {
  if (parsed) return 'SERIES';
  const movieTerms = ['movie', 'movies', 'หนัง', 'ภาพยนตร์', 'film', 'films', 'ภาพยนตร์จีน', 'movie night'];
  return categoryNames.some((n) => movieTerms.some((t) => normalize(n).includes(normalize(t))))
    ? 'MOVIE'
    : 'CLIP';
}

const activeScans = new Set<string>();

export async function scanSource(sourceId: string, userId: string) {
  const lock = userId + ':' + sourceId;
  if (activeScans.has(lock)) throw new Error('Scan already in progress');

  const source = await db.source.findFirst({
    where: { id: sourceId, userId, enabled: true },
    include: {
      rules: { include: { rule: true } },
      categories: { include: { category: true } },
    },
  });
  if (!source) throw new Error('Source not found or disabled');

  activeScans.add(lock);
  startScanStatus(userId, sourceId, source.name);
  const started = Date.now();

  try {
    logEvent('scan.start', { sourceId, userId });

    setScanStatus(userId, sourceId, {
      phase: 'fetching',
      percent: 8,
      message: 'Opening “' + source.name + '” and downloading the source page…',
    });

    const videos = await extractPublicVideoSources(source.url, ({ phase, message }) => {
      setScanStatus(userId, sourceId, {
        phase: phase === 'fetching' ? 'fetching' : 'extracting',
        percent: phase === 'fetching' ? 18 : 32,
        message,
      });
    });

    let matched = 0;
    let created = 0;
    let updated = 0;
    let skippedByDate = 0;
    let unmatched = 0;
    let duplicates = 0;
    const hasRules = source.rules.length > 0;

    setScanStatus(userId, sourceId, {
      phase: 'matching',
      percent: 38,
      discovered: videos.length,
      message:
        videos.length > 0
          ? 'Found ' + videos.length + ' media source' + (videos.length === 1 ? '' : 's') + '. Checking Search Rules and scan window…'
          : 'Found 0 media sources in the page HTML. Checking the result before finishing…',
    });

    const cutoff = new Date(Date.now() - source.scanWindow * 86400000);
    const total = Math.max(videos.length, 1);

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const title = v.title || 'Video';
      const publishedAt = v.publishedAt ? new Date(v.publishedAt) : null;

      if (publishedAt && publishedAt < cutoff) {
        skippedByDate++;
      } else {
        const hitRules = hasRules
          ? source.rules.filter((x) =>
              matches(title + ' ' + v.url, { mode: x.rule.mode, keywords: x.rule.keywords }),
            )
          : [];

        // A Source with no Search Rules imports every discovered media source.
        // Search Rules are an optional filter, not a prerequisite for Library import.
        if (hasRules && !hitRules.length) {
          unmatched++;
        } else {
          matched++;
          const fp = fingerprint(source.id, v.url, title);
          const existing = await db.videoSource.findFirst({ where: { fingerprint: fp } });

          if (existing) {
            duplicates++;
          } else {
            const parsed = parseEpisodeTitle(title);
            const contentTitle = parsed?.seriesTitle || title;
            const normalized = normalizeTitle(contentTitle);
            const inferredType = inferContentType(
              source.categories.map((x) => x.category.name),
              !!parsed,
            );
            let content = await db.content.findFirst({ where: { userId, normalized } });
            const wasNew = !content;

            if (!content) {
              content = await db.content.create({
                data: {
                  userId,
                  title: contentTitle,
                  originalTitle: contentTitle,
                  englishTitle: contentTitle,
                  displayTitle: contentTitle,
                  titleSource: 'source',
                  normalized,
                  contentType: inferredType,
                  posterUrl: v.thumbnailUrl,
                },
              });
              for (const sc of source.categories) {
                await db.contentCategory
                  .create({ data: { contentId: content.id, categoryId: sc.categoryId } })
                  .catch(() => {});
              }
            } else if (parsed && content.contentType !== 'SERIES') {
              content = await db.content.update({
                where: { id: content.id },
                data: {
                  contentType: 'SERIES',
                  posterUrl: content.posterUrl || v.thumbnailUrl || undefined,
                },
              });
            }

            let episodeId: string | undefined;
            if (parsed) {
              const season = await db.season.upsert({
                where: { contentId_number: { contentId: content.id, number: parsed.season } },
                create: {
                  contentId: content.id,
                  number: parsed.season,
                  title: 'Season ' + parsed.season,
                },
                update: {},
              });
              const episode = await db.episode.upsert({
                where: { seasonId_number: { seasonId: season.id, number: parsed.episode } },
                create: {
                  seasonId: season.id,
                  number: parsed.episode,
                  title: parsed.episodeTitle,
                  originalTitle: parsed.episodeTitle,
                  englishTitle: parsed.episodeTitle,
                  displayTitle: parsed.episodeTitle,
                  thumbnailUrl: v.thumbnailUrl,
                  duration: v.duration,
                  publishedAt,
                },
                update: {
                  title: parsed.episodeTitle,
                  originalTitle: parsed.episodeTitle,
                  englishTitle: parsed.episodeTitle,
                  displayTitle: parsed.episodeTitle,
                  thumbnailUrl: v.thumbnailUrl || undefined,
                  duration: v.duration || undefined,
                  publishedAt: publishedAt || undefined,
                },
              });
              episodeId = episode.id;
            }

            await db.videoSource.create({
              data: {
                sourceId: source.id,
                contentId: content.id,
                episodeId,
                url: v.url,
                type: v.type,
                title,
                sourceTitle: title,
                siteName: source.name,
                siteUrl: source.url,
                thumbnailUrl: v.thumbnailUrl,
                duration: v.duration,
                resolution: v.resolution,
                publishedAt,
                fingerprint: fp,
              },
            });

            await db.content.update({ where: { id: content.id }, data: { updatedAt: new Date() } });
            for (const rr of hitRules) {
              await db.contentRule
                .create({ data: { contentId: content.id, ruleId: rr.ruleId } })
                .catch(() => {});
            }

            if (wasNew) created++;
            else updated++;
          }
        }
      }

      const percent = 40 + Math.round(((i + 1) / total) * 45);
      setScanStatus(userId, sourceId, {
        phase: i + 1 === videos.length ? 'saving' : 'matching',
        percent,
        message:
          i + 1 === videos.length
            ? 'Media analysis finished. Saving scan results…'
            : 'Analyzing media ' + (i + 1) + ' of ' + videos.length + '…',
        discovered: videos.length,
        matched,
        created,
        updated,
        skippedByDate,
        unmatched,
        duplicates,
      });
    }

    setScanStatus(userId, sourceId, {
      phase: 'saving',
      percent: 92,
      message: 'Saving source scan timestamp and Search Rule match state…',
      discovered: videos.length,
      matched,
      created,
      updated,
      skippedByDate,
      unmatched,
      duplicates,
    });

    await db.source.update({
      where: { id: source.id },
      data: {
        lastScannedAt: new Date(),
        lastError: null,
        lastScanCount: videos.length,
      },
    });

    const matchedRuleIds = new Set(source.rules.map((x) => x.ruleId));
    for (const ruleId of matchedRuleIds) {
      await db.searchRule
        .update({ where: { id: ruleId }, data: { lastMatchedAt: new Date() } })
        .catch(() => {});
    }

    const finalMessage =
      videos.length === 0
        ? 'Scan complete. The page returned 0 directly discoverable media sources. The Scanner currently looks for <video>, <source>, and direct MP4/HLS/DASH URLs in the HTML.'
        : source.rules.length === 0
          ? 'Scan complete. Media was found and imported because this Source has no active Search Rules.'
          : matched === 0
            ? 'Scan complete. Media was found, but 0 items matched the active Search Rules or scan window.'
            : 'Scan complete. ' + matched + ' media source' + (matched === 1 ? '' : 's') + ' matched the active Search Rules.';

    const result = {
      sourceId,
      scanned: videos.length,
      discovered: videos.length,
      matched,
      created,
      updated,
      skippedByDate,
      unmatched,
      duplicates,
      durationMs: Date.now() - started,
      finalMessage,
    };

    finishScanStatus(userId, sourceId, result);
    logEvent('scan.complete', result);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scan failed';
    await db.source
      .update({
        where: { id: source.id },
        data: { lastScannedAt: new Date(), lastError: message },
      })
      .catch(() => {});
    failScanStatus(userId, sourceId, message);
    logError('scan.failed', e, { sourceId, userId, durationMs: Date.now() - started });
    throw e;
  } finally {
    activeScans.delete(lock);
  }
}

export async function scanDueSources() {
  const now = Date.now();
  const sources = await db.source.findMany({ where: { enabled: true } });
  const due = sources.filter(
    (s) => !s.lastScannedAt || now - s.lastScannedAt.getTime() >= s.scanIntervalHours * 3600000,
  );
  const results: Array<Record<string, unknown>> = [];
  const concurrency = Math.max(1, Math.min(4, Number(process.env.SCAN_MAX_CONCURRENCY) || 2));
  let cursor = 0;

  async function worker() {
    while (cursor < due.length) {
      const index = cursor++;
      const s = due[index];
      try {
        results[index] = await scanSource(s.id, s.userId);
      } catch (e) {
        results[index] = { sourceId: s.id, error: e instanceof Error ? e.message : 'Scan failed' };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, () => worker()));
  return { due: due.length, results };
}
