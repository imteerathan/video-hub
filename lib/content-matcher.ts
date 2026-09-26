export type ParsedEpisode = { seriesTitle:string; season:number; episode:number; episodeTitle:string };

const clean = (s:string) => s.replace(/\.(mp4|m3u8|mpd)$/i,'').replace(/[._]+/g,' ').replace(/\s+/g,' ').trim();

export function parseEpisodeTitle(raw:string): ParsedEpisode | null {
  const title=clean(raw);
  let m=title.match(/^(.*?)\s*[\[\(]?S(\d{1,3})\s*E(\d{1,4})(?:\s*[\]\)]?)\s*[-:._ ]*\s*(.*)$/i);
  if(!m) m=title.match(/^(.*?)\s+(\d{1,2})x(\d{1,4})\s*[-:._ ]*\s*(.*)$/i);
  if(!m) return null;
  const season=Number(m[2]), episode=Number(m[3]);
  if(!Number.isFinite(season)||!Number.isFinite(episode)) return null;
  return {seriesTitle:m[1].trim(),season,episode,episodeTitle:(m[4]||`Episode ${episode}`).trim()||`Episode ${episode}`};
}

export function normalizeTitle(s:string){return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
